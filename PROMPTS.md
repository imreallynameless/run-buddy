# AI-Assisted Development Log

This document chronicles the AI-assisted development process of **RunBuddy**, a personalized running coach powered by Cloudflare Workers AI, Durable Objects, and AI Gateway.

## Project Overview

RunBuddy is an intelligent running training assistant that:
- Provides personalized running schedules and training advice
- Maintains per-user state using Cloudflare Durable Objects
- Leverages Cloudflare Workers AI through AI Gateway
- Tracks runner progress over time
- Adapts recommendations as runners improve

## Development Process

### Phase 1: Initial Architecture (30 minutes)

**Initial Prompt:**
```
I want to build an AI agent using import { AIChatAgent } from "agents/ai-chat-agent";

You are supposed to be run-buddy a personalized agent that suggests run training/schedules, 
and has state which can be used to track progress and recommend different schedules as I improve. 
I want to use AI Gateway to get the AI model recommendation on running schedule. 

It should be a llm chat app like the cloudflare llm-chat-app-template and it should have 
some sort of state using durable objects. 

Make sure to have a TODO list broken down into parts first
```

**Key Decisions:**
- Cloudflare Workers for serverless compute
- Durable Objects for stateful user data
- AI Gateway for LLM routing and caching
- Streaming chat interface
- Email-based user identification (no complex auth)

### Phase 2: Core Implementation (45 minutes)

**State Management Strategy:**
```
Q: "you can key durable-object state per email?"
A: Yes, using `env.RUNNER_STATE.idFromName(email)` provides perfect per-user isolation
```

**Architecture Components:**
1. **Worker Entry Point** (`src/index.ts`): Routes requests, serves UI, handles chat endpoints
2. **Durable Object** (`src/agents/run-buddy-agent.ts`): Manages runner state, chat history, progress tracking
3. **Frontend** (`public/index.html`): Chat UI with SSE streaming support
4. **AI Gateway Integration**: Routes LLM requests through Cloudflare's gateway

### Phase 3: Debugging & Refinement (60-90 minutes)

#### Issue 1: SQL Storage Configuration
```
Error: SQL is not enabled for this Durable Object class. 
To enable it, change `new_classes` to `new_sqlite_classes`
```

**Solution:** Updated `wrangler.jsonc` migration configuration:
```json
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["RunnerState"] }
]
```

#### Issue 2: Empty AI Responses
```
RunBuddy finished without returning text.
```

**Root Cause Analysis:**
- Email context not reaching Durable Object
- UI not sending `x-runner-email` header
- Empty response handling missing

**Solutions Applied:**
1. Added email to system messages
2. Fixed UI to include email header
3. Implemented fallback messages
4. Enhanced error logging

#### Issue 3: SDK Compatibility Issues
```
The root cause is that I've been trying to force-fit multiple incompatible patterns together:
- agents SDK (expects specific format)
- Vercel AI SDK (different streaming format)
- Workers AI (raw API)
```

**Resolution:** Simplified to direct Workers AI integration, removing intermediate SDK layers that caused format mismatches.

### Phase 4: Simplification (30 minutes)

**Key Refactoring Decisions:**
- ❌ Removed `agents` SDK wrapper (too opinionated)
- ❌ Removed Vercel AI SDK (format incompatibility)
- ✅ Direct Workers AI API calls (full control)
- ✅ Custom SSE formatting (matches Workers AI output)
- ✅ Simpler request/response flow

## Technical Insights

### 1. Durable Objects as Per-User State
Using `idFromName(email)` provides:
- Deterministic routing (same email → same instance)
- Automatic isolation between users
- Persistent storage with SQL support
- No need for complex auth/session management

### 2. Streaming Response Formats
Different SDKs use incompatible SSE formats:
- **Workers AI**: `{response: "text"}`
- **Vercel AI SDK**: `{type: "text-delta", delta: "text"}`
- **OpenAI**: `{choices: [{delta: {content: "text"}}]}`

**Lesson:** Direct API integration often clearer than SDK abstraction layers.

### 3. Workers AI API Patterns
```typescript
// Correct pattern for streaming
const stream = await env.AI.run(
  '@cf/meta/llama-3.1-8b-instruct',
  { messages, stream: true }
);

// Stream is readable, iterate and format
for await (const chunk of stream) {
  // Process chunk.response
}
```

### 4. Durable Object Error Handling
Errors in Durable Objects return generic "code: 1101" without context unless:
```typescript
async fetch(request: Request) {
  try {
    // handler logic
  } catch (error) {
    console.error("Detailed error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
```

### 5. AI Gateway Configuration
```typescript
const gateway = `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/workers-ai`;
```
Benefits:
- Request logging and analytics
- Caching for repeated queries
- Rate limiting and cost control
- A/B testing different models

## Development Tools & Workflow

**Primary Tools:**
- **AI Assistant**: Claude Sonnet 4.5 via Cursor
- **IDE**: Cursor/VS Code
- **Deployment**: Wrangler CLI (`wrangler dev`, `wrangler deploy`)
- **Testing**: curl, browser DevTools, manual testing

**Debugging Techniques:**
1. Terminal curl tests for API validation
2. Console logging in Durable Objects
3. Browser DevTools for SSE stream monitoring
4. Incremental deployments after each change
5. Format validation of streaming responses

## Time Investment

| Phase | Duration |
|-------|----------|
| Architecture & Planning | 30 min |
| Initial Implementation | 45 min |
| Debugging & Troubleshooting | 60-90 min |
| Simplification & Refactor | 30 min |
| Documentation | 15 min |
| **Total** | **~3 hours** |

## AI vs Human Contributions

### AI Assistant Provided:
- ✅ Rapid code scaffolding and boilerplate
- ✅ Cloudflare API pattern discovery
- ✅ Debugging suggestions and fixes
- ✅ Documentation research and synthesis
- ✅ Refactoring implementation

### Human Developer Provided:
- 🎯 Project vision and requirements
- 🐛 Real-world testing and bug reports
- 🔑 Configuration secrets and deployment
- 🤔 Architecture simplification decisions
- 📝 Final approval and iteration direction

## Key Takeaways

1. **Start Simple**: Complex SDK stacks can hide issues. Direct API calls offer better control and debugging visibility.

2. **Cloudflare Platform Strengths**: Durable Objects + Workers AI + AI Gateway form a powerful, fully-integrated stack for stateful AI applications.

3. **Streaming Complexity**: SSE implementations vary widely. Understanding the exact format expected by your frontend is critical.

4. **Per-User Isolation**: Email-based Durable Object keying provides elegant multi-tenancy without auth complexity (suitable for personal projects).

5. **Iterative Debugging**: Complex distributed systems require methodical testing at each layer (API → Durable Object → Frontend).

## Future Enhancements

Potential improvements for RunBuddy:
- [ ] Add authentication (e.g., Cloudflare Access, Google OAuth)
- [ ] Implement workout data visualization
- [ ] Add file upload for training data (Strava exports)
- [ ] Multi-model support with A/B testing via AI Gateway
- [ ] Mobile-responsive UI improvements
- [ ] Export training schedules to calendar
- [ ] Integration with fitness trackers

## References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [Workers AI Reference](https://developers.cloudflare.com/workers-ai/)
- [AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)

---

*This document serves as both a development log and a reference for building similar AI-powered applications on the Cloudflare platform.*
