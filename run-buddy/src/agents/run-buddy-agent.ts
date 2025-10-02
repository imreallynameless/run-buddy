import { z } from "zod";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

const systemPrompt = `You are RunBuddy, a dedicated running coach.

Responsibilities:
- Learn and remember the runner's email, experience, goals, availability, and upcoming events.
- Keep a running profile updated using the available tools.
- Record completed workouts to track progress over time.
- Save new training plans (especially weekly plans) so future chats can build on them.
- Regularly review history and adapt plans based on progress.

Tool usage expectations:
- Always call **set_runner_profile** after you collect or confirm profile details (including the email).
- Use **log_completed_run** whenever the runner reports a workout.
- Call **save_training_plan** after you deliver a structured plan so it is stored for later reference.
- Invoke **get_runner_snapshot** to refresh your understanding before making new recommendations.
- Capture athlete reactions using **record_plan_feedback** to improve future suggestions.

Tone: encouraging, concise, and focused on actionable guidance.`;

export interface RunBuddyEnv {
	CF_ACCOUNT_ID: string;
	CF_GATEWAY_ID: string;
	CF_TOKEN: string;
	AI: any;
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
}

const DEFAULT_STATE: RunBuddyState = {
	profiles: {}
};

export class RunBuddyAgent {
	private state: DurableObjectState;
	private env: RunBuddyEnv;
	private storage: DurableObjectStorage;

	constructor(state: DurableObjectState, env: RunBuddyEnv) {
		this.state = state;
		this.env = env;
		this.storage = state.storage;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		
		if (url.pathname.endsWith("/use-chat") && request.method === "POST") {
			try {
				const { messages } = await request.json() as { messages: any[] };
				
				// Get current profile state
				const currentState = await this.storage.get<RunBuddyState>("state") ?? DEFAULT_STATE;
				const email = currentState.activeEmail;
				
				// Add system prompt
				const aiMessages = [
					{ role: "system", content: systemPrompt },
					...messages.map((m: any) => ({
						role: m.role,
						content: m.parts?.map((p: any) => p.text).join("") ?? m.content
					}))
				];
				
				// Call Workers AI
				const aiResponse = await this.env.AI.run(MODEL, {
					messages: aiMessages,
					stream: true
				});
				
				return new Response(aiResponse, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"Connection": "keep-alive"
					}
				});
			} catch (error) {
				console.error("Chat error:", error);
				return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { 
					status: 500,
					headers: { "Content-Type": "application/json" }
				});
			}
		}
		
		return new Response("Not Found", { status: 404 });
	}

	private async getState(): Promise<RunBuddyState> {
		return await this.storage.get<RunBuddyState>("state") ?? DEFAULT_STATE;
	}
	
	private async setState(state: RunBuddyState): Promise<void> {
		await this.storage.put("state", state);
	}

	private normaliseEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	private async resolveEmail(explicitEmail?: string): Promise<string> {
		const state = await this.getState();
		const email = explicitEmail?.trim() || state.activeEmail;
		if (!email) {
			throw new Error(
				"Runner email is not known yet. Capture it with set_runner_profile before logging runs or plans."
			);
		}
		return this.normaliseEmail(email);
	}

	private async ensureProfile(email: string): Promise<RunnerProfile> {
		const state = await this.getState();
		const existing = state.profiles[email];
		if (existing) {
			return existing;
		}
		const now = new Date().toISOString();
		const profile: RunnerProfile = {
			email,
			createdAt: now,
			updatedAt: now,
			recentRuns: [],
			savedPlans: []
		};
		const updatedState: RunBuddyState = {
			activeEmail: email,
			profiles: {
				...state.profiles,
				[email]: profile
			}
		};
		await this.setState(updatedState);
		return profile;
	}

	private async persistProfile(email: string, profile: RunnerProfile, setActive = true): Promise<void> {
		const state = await this.getState();
		const nextState: RunBuddyState = {
			activeEmail: setActive ? email : state.activeEmail,
			profiles: {
				...state.profiles,
				[email]: {
					...profile,
					updatedAt: new Date().toISOString()
				}
			}
		};
		await this.setState(nextState);
	}


}

