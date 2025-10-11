/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { routeAgentRequest } from "agents";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { z } from "zod";

import { RunBuddyAgent } from "./agents/run-buddy-agent";

export interface Env {
	RunBuddyAgent: DurableObjectNamespace<RunBuddyAgent>;
	CF_ACCOUNT_ID: string;
	CF_GATEWAY_ID: string;
	CF_TOKEN: string;
	AI: any;
	ASSETS?: Fetcher;
}

const chatMessageSchema = z.object({
	role: z.string().min(1, "role is required"),
	parts: z
		.array(z.object({ text: z.string() }))
		.optional(),
	content: z.string().optional()
}).refine(
	value => Boolean(value.content) || Boolean(value.parts?.length),
	"Message must include content or parts"
);

const chatPayloadSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email("Valid email is required"),
	messages: z
		.array(chatMessageSchema)
		.nonempty("messages must include at least one item")
		.max(40, "messages must not exceed 40 entries")
		.transform(messages => {
			return messages.map(message => ({
				...message,
				content: message.content?.slice(0, 4000),
				parts: message.parts?.map(part => ({
					...part,
					text: part.text?.slice(0, 4000)
				}))
			}));
		})
});

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

function ensureMaxPayloadSize(rawBody: string): void {
	if (new TextEncoder().encode(rawBody).byteLength > MAX_PAYLOAD_BYTES) {
		throw new HttpError(413, "Payload too large");
	}
}

type ChatPayload = z.infer<typeof chatPayloadSchema>;

class HttpError extends Error {
	public readonly status: number;
	public readonly issues?: z.ZodIssue[];

	constructor(status: number, message: string, issues?: z.ZodIssue[]) {
		super(message);
		this.status = status;
		this.issues = issues;
	}
}

async function handleRootRequest(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return new Response("Static assets binding missing", { status: 500 });
	}
	return env.ASSETS.fetch(request);
}

async function parseChatPayload(request: Request): Promise<ChatPayload> {
	let rawText = "";
	try {
		rawText = await request.text();
		ensureMaxPayloadSize(rawText);
	} catch (error) {
		if (error instanceof HttpError) {
			throw error;
		}
		throw new HttpError(400, "Invalid JSON body");
	}

	let rawBody: unknown;
	try {
		rawBody = JSON.parse(rawText);
	} catch {
		throw new HttpError(400, "Invalid JSON body");
	}

	const result = chatPayloadSchema.safeParse(rawBody);
	if (!result.success) {
		throw new HttpError(400, "Invalid chat payload", result.error.issues);
	}
	return result.data;
}

function formatValidationIssues(issues?: z.ZodIssue[]): string | undefined {
	return issues
		?.map(issue => {
			const path = issue.path.join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ");
}

async function forwardChatToDurableObject(env: Env, email: string, messages: ChatPayload["messages"]): Promise<Response> {
	const id = env.RunBuddyAgent.idFromName(email);
	const stub = env.RunBuddyAgent.get(id);
	const forwardRequest = new Request("http://runbuddy/use-chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, messages })
	});
	return stub.fetch(forwardRequest);
}

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
	try {
		const { email, messages } = await parseChatPayload(request);
		return await forwardChatToDurableObject(env, email, messages);
	} catch (error) {
		if (error instanceof HttpError) {
			const details = formatValidationIssues(error.issues);
			return new Response(details ?? error.message, {
				status: error.status,
				headers: { "Content-Type": "text/plain" }
			});
		}
		console.error("Unhandled /chat error", error);
		return new Response("Internal Server Error", { status: 500 });
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return handleRootRequest(request, env);
		}

		if (url.pathname === "/chat" && request.method === "POST") {
			return handleChatRequest(request, env);
		}

		const response = await routeAgentRequest(request, env, { cors: true });
		if (response) {
			return response;
		}
		return new Response("Not Found", { status: 404 });
	}
};

export { RunBuddyAgent };
