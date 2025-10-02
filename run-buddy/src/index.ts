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

import { RunBuddyAgent } from "./agents/run-buddy-agent";

export interface Env {
	RunBuddyAgent: DurableObjectNamespace<RunBuddyAgent>;
	CF_ACCOUNT_ID: string;
	CF_GATEWAY_ID: string;
	CF_TOKEN: string;
	AI: any;
	ASSETS?: Fetcher;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
	const url = new URL(request.url);
		if (url.pathname === "/") {
			if (!env.ASSETS) {
				return new Response("Static assets binding missing", { status: 500 });
			}
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/chat" && request.method === "POST") {
			let payload: { email?: string; messages?: unknown } = {};
			try {
				payload = await request.json();
			} catch (error) {
				return new Response("Invalid JSON body", { status: 400 });
			}
			const email = payload.email?.toString().trim().toLowerCase();
			if (!email) {
				return new Response("Email is required", { status: 400 });
			}
			if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
				return new Response("Messages array is required", { status: 400 });
			}
			// Get the Durable Object stub
			const id = env.RunBuddyAgent.idFromName(email);
			const stub = env.RunBuddyAgent.get(id);
			// Forward to the DO's use-chat endpoint
			const forwardRequest = new Request("http://runbuddy/use-chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ messages: payload.messages })
			});
			return stub.fetch(forwardRequest);
		}

		const response = await routeAgentRequest(request, env, { cors: true });
		if (response) {
			return response;
		}
		return new Response("Not Found", { status: 404 });
	}
};

export { RunBuddyAgent };
