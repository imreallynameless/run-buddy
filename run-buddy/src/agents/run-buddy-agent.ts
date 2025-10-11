import { z } from "zod";
import { RUN_BUDDY_SYSTEM_PROMPT } from "../prompts/run-buddy";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export interface RunBuddyEnv {
	CF_ACCOUNT_ID: string;
	CF_GATEWAY_ID: string;
	CF_TOKEN: string;
	AI: WorkersAI;
}

interface WorkersAI {
	run(model: string, payload: Record<string, unknown>): Promise<ReadableStream>;
}

type ExperienceLevel = "beginner" | "intermediate" | "advanced";

interface RunLogEntry {
	id: string;
	dateISO: string;
	distanceKm?: number;
	durationMinutes?: number;
	perceivedEffort?: "easy" | "moderate" | "hard";
	notes?: string;
}

interface TrainingPlan {
	id: string;
	createdAt: string;
	title?: string;
	focus?: string;
	summary: string;
	scheduleOutline?: string;
}

interface RunnerProfile {
	email: string;
	createdAt: string;
	updatedAt: string;
	firstName?: string;
	experienceLevel?: ExperienceLevel;
	primaryGoal?: string;
	weeklyAvailability?: string;
	upcomingEvent?: string;
	notes?: string;
	planFeedback?: string;
	recentRuns: RunLogEntry[];
	savedPlans: TrainingPlan[];
}

interface RunBuddyState {
	activeEmail?: string;
	profiles: Record<string, RunnerProfile>;
	usage: Record<string, RateLimitState>;
}

const DEFAULT_STATE: RunBuddyState = {
	profiles: {},
	usage: {}
};

interface RateLimitState {
	count: number;
	windowStart: string;
}

const agentMessageSchema = z.object({
	role: z.string().min(1),
	parts: z
		.array(
			z.object({
				text: z.string().optional()
			})
		)
		.optional(),
	content: z.string().optional()
});

const agentPayloadSchema = z.object({
	email: z.string().trim().toLowerCase().email("Valid email is required"),
	messages: z
		.array(agentMessageSchema)
		.nonempty("messages must not be empty")
		.max(50, "messages must not exceed 50 entries")
});

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_REQUESTS = 10_000;

type AgentPayload = z.infer<typeof agentPayloadSchema>;

type AgentMessage = AgentPayload["messages"][number];

type NormalisedMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

class DurableObjectHttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly issues?: z.ZodIssue[]
	) {
		super(message);
	}
}

export class RunBuddyAgent {
	private readonly storage: DurableObjectStorage;
	private readonly repository: ProfileRepository;
	private readonly aiClient: AiClient;
	private readonly messageBuilder: MessageBuilder;

	constructor(private readonly state: DurableObjectState, private readonly env: RunBuddyEnv) {
		this.storage = state.storage;
		this.repository = new ProfileRepository(this.storage);
		this.aiClient = new AiClient(this.env.AI);
		this.messageBuilder = new MessageBuilder(RUN_BUDDY_SYSTEM_PROMPT);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.endsWith("/use-chat") && request.method === "POST") {
			return this.state.blockConcurrencyWhile(async () => {
				try {
					return await this.handleChat(request);
				} catch (error) {
					return this.handleError(error);
				}
			});
		}

		return new Response("Not Found", { status: 404 });
	}

	private async handleChat(request: Request): Promise<Response> {
		const payload = await parseAgentPayload(request);
		await this.repository.ensureActiveEmail(payload.email);
		await this.repository.assertWithinRateLimit(payload.email, MAX_DAILY_REQUESTS, RATE_LIMIT_WINDOW_MS);
		const context = await this.repository.getContext();
		const messages = this.messageBuilder.build(payload.messages, context?.activeProfile);
		return this.aiClient.streamChat(messages);
	}

	private handleError(error: unknown): Response {
		if (error instanceof DurableObjectHttpError) {
			return new Response(
				JSON.stringify({
					error: error.message,
					issues: error.issues?.map(issue => ({
						path: issue.path,
						message: issue.message
					})) ?? []
				}),
				{
					status: error.status,
					headers: { "Content-Type": "application/json" }
				}
			);
		}

		console.error("RunBuddy chat error", error);
		return new Response(JSON.stringify({ error: "Internal error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" }
		});
	}
}

class AiClient {
	constructor(private readonly ai: WorkersAI) {}

	async streamChat(messages: NormalisedMessage[]): Promise<Response> {
		const stream = await this.ai.run(MODEL, {
			messages,
			stream: true
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive"
			}
		});
	}
}

class ProfileRepository {
	constructor(private readonly storage: DurableObjectStorage) {}

	async ensureActiveEmail(email: string): Promise<void> {
		const normalisedEmail = normaliseEmail(email);
		const state = await this.getState();
		if (state.activeEmail === normalisedEmail) {
			return;
		}
		const profile = state.profiles[normalisedEmail] ?? this.createEmptyProfile(normalisedEmail);
		const nextState: RunBuddyState = {
			activeEmail: normalisedEmail,
			profiles: {
				...state.profiles,
				[normalisedEmail]: profile
			},
			usage: this.withUsageEntry(state.usage, normalisedEmail)
		};
		await this.setState(nextState);
	}

	async getContext(): Promise<{ activeProfile?: RunnerProfile } | undefined> {
		const state = await this.getState();
		if (!state.activeEmail) {
			return undefined;
		}
		const activeProfile = state.profiles[state.activeEmail];
		if (!activeProfile) {
			return undefined;
		}
		return { activeProfile };
	}

	async getState(): Promise<RunBuddyState> {
		const stored = (await this.storage.get<RunBuddyState>("state")) ?? DEFAULT_STATE;
		return {
			activeEmail: stored.activeEmail,
			profiles: stored.profiles ?? {},
			usage: stored.usage ?? {}
		};
	}

	async setState(state: RunBuddyState): Promise<void> {
		await this.storage.put("state", state);
	}

	async upsertProfile(email: string, mutator: (profile: RunnerProfile | undefined) => RunnerProfile, setActive = true): Promise<RunnerProfile> {
		const state = await this.getState();
		const normalisedEmail = normaliseEmail(email);
		const existing = state.profiles[normalisedEmail];
		const updatedProfile = mutator(existing ?? this.createEmptyProfile(normalisedEmail));
		const nextState: RunBuddyState = {
			activeEmail: setActive ? normalisedEmail : state.activeEmail,
			profiles: {
				...state.profiles,
				[normalisedEmail]: {
					...updatedProfile,
					updatedAt: new Date().toISOString()
				}
			},
			usage: this.withUsageEntry(state.usage, normalisedEmail)
		};
		await this.setState(nextState);
		return nextState.profiles[normalisedEmail];
	}

	private createEmptyProfile(email: string): RunnerProfile {
		const now = new Date().toISOString();
		return {
			email,
			createdAt: now,
			updatedAt: now,
			recentRuns: [],
			savedPlans: []
		};
	}

	withUsageEntry(existingUsage: RunBuddyState["usage"], email: string): RunBuddyState["usage"] {
		const usage = { ...existingUsage };
		if (!usage[email]) {
			usage[email] = {
				count: 0,
				windowStart: new Date().toISOString()
			};
		}
		return usage;
	}

	async assertWithinRateLimit(email: string, limit: number, windowMs: number): Promise<void> {
		const state = await this.getState();
		const normalisedEmail = normaliseEmail(email);
		const usage = this.withUsageEntry(state.usage, normalisedEmail);
		const now = Date.now();
		const entry = usage[normalisedEmail];
		const windowStart = new Date(entry.windowStart).getTime();
		if (now - windowStart >= windowMs) {
			entry.count = 0;
			entry.windowStart = new Date(now).toISOString();
		}
		if (entry.count >= limit) {
			throw new DurableObjectHttpError(429, `Daily request limit reached (${limit} requests)`, [
				{ path: ["messages"], message: "Rate limit exceeded" }
			]);
		}
		entry.count += 1;
		const nextState: RunBuddyState = {
			activeEmail: state.activeEmail,
			profiles: state.profiles,
			usage
		};
		await this.setState(nextState);
	}
}

class MessageBuilder {
	constructor(private readonly basePrompt: string) {}

	build(messages: AgentMessage[], profile?: RunnerProfile): NormalisedMessage[] {
		const system = this.composeSystemPrompt(profile);
		const normalised = messages.map(this.normaliseMessage).filter((msg): msg is NormalisedMessage => Boolean(msg));
		return [system, ...normalised];
	}

	private composeSystemPrompt(profile?: RunnerProfile): NormalisedMessage {
		if (!profile) {
			return { role: "system", content: this.basePrompt };
		}

		const summary = summariseProfile(profile);
		return {
			role: "system",
			content: `${this.basePrompt}\n\nActive runner profile:\n${summary}`
		};
	}

	private normaliseMessage(message: AgentMessage): NormalisedMessage | undefined {
		const role = normaliseRole(message.role);
		if (!role) {
			return undefined;
		}

		const content = extractContent(message);
		if (!content) {
			return undefined;
		}

		return { role, content };
	}
}

async function parseAgentPayload(request: Request): Promise<AgentPayload> {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		throw new DurableObjectHttpError(400, "Invalid JSON body received by RunBuddy Durable Object");
	}

	const result = agentPayloadSchema.safeParse(rawBody);
	if (!result.success) {
		throw new DurableObjectHttpError(400, "Invalid chat payload", result.error.issues);
	}
	return result.data;
}

function normaliseEmail(email: string): string {
	return email.trim().toLowerCase();
}

function normaliseRole(role?: string): NormalisedMessage["role"] | undefined {
	if (!role) return undefined;
	const lowered = role.toLowerCase();
	if (lowered === "system" || lowered === "user" || lowered === "assistant") {
		return lowered;
	}
	return undefined;
}

function extractContent(message: AgentMessage): string | undefined {
	if (message.content && message.content.trim()) {
		return message.content.trim();
	}

	const parts = message.parts?.map(part => part.text?.trim()).filter(Boolean) ?? [];
	return parts.length ? parts.join("\n") : undefined;
}

function summariseProfile(profile: RunnerProfile): string {
	const lines: string[] = [
		`Email: ${profile.email}`,
		profile.firstName ? `Name: ${profile.firstName}` : undefined,
		profile.experienceLevel ? `Experience: ${profile.experienceLevel}` : undefined,
		profile.primaryGoal ? `Goal: ${profile.primaryGoal}` : undefined,
		profile.weeklyAvailability ? `Availability: ${profile.weeklyAvailability}` : undefined,
		profile.upcomingEvent ? `Upcoming Event: ${profile.upcomingEvent}` : undefined,
		profile.notes ? `Notes: ${profile.notes}` : undefined,
		profile.planFeedback ? `Feedback: ${profile.planFeedback}` : undefined,
		profile.recentRuns.length ? `Recent runs logged: ${profile.recentRuns.length}` : undefined,
		profile.savedPlans.length ? `Saved training plans: ${profile.savedPlans.length}` : undefined
	].filter(Boolean) as string[];

	if (profile.recentRuns.length) {
		const lastRun = profile.recentRuns[profile.recentRuns.length - 1];
		lines.push(
			`Most recent run: ${lastRun.dateISO} ${lastRun.distanceKm ? `- ${lastRun.distanceKm}km` : ""} ${lastRun.durationMinutes ? `in ${lastRun.durationMinutes} minutes` : ""}`.trim()
		);
	}

	if (profile.savedPlans.length) {
		const lastPlan = profile.savedPlans[profile.savedPlans.length - 1];
		lines.push(`Latest plan: ${lastPlan.title ?? lastPlan.focus ?? "Untitled"} (${lastPlan.createdAt})`);
	}

	return lines.join("\n");
}

