# RunBuddy - AI Running Coach

An AI-powered running coach built on Cloudflare's platform that provides personalized training plans, tracks progress, and adapts recommendations as you improve.

## Features

- 🤖 **AI-Powered Coaching**: Uses Llama 3.1 8B on Cloudflare Workers AI for intelligent conversation
- 💾 **Persistent State**: Durable Objects maintain runner profiles, workout logs, and training plans per user email
- 💬 **Real-time Chat**: Streaming responses provide immediate, interactive feedback
- 📊 **Progress Tracking**: Stores workout history, training plans, and runner feedback
- 🎯 **Personalized Plans**: Adapts training recommendations based on your goals, experience level, and progress

## Architecture

### Components

1. **LLM**: Cloudflare Workers AI with Llama 3.1 8B (`@cf/meta/llama-3.1-8b-instruct`)
2. **Workflow/Coordination**: Durable Objects for stateful coordination and data persistence
3. **User Input**: Interactive chat interface via Cloudflare Pages with server-sent events streaming
4. **Memory/State**: Durable Object storage maintains runner profiles, workout logs, and training plans keyed by email

### Stack

- **Backend**: Cloudflare Workers + Durable Objects
- **AI**: Workers AI (Llama 3.1 8B) via AI Gateway
- **Frontend**: Vanilla JavaScript with SSE streaming
- **State**: Durable Object SQL storage
- **Deployment**: Cloudflare Workers & Pages

## Project Structure

```
run-buddy/
├── src/
│   ├── index.ts              # Main Worker entry point
│   └── agents/
│       └── run-buddy-agent.ts # Durable Object with AI logic
├── public/
│   └── index.html            # Chat UI
├── wrangler.jsonc            # Cloudflare Workers configuration
└── package.json
```

## Setup & Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Cloudflare account (free tier works)
- Wrangler CLI

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/cf_ai_run-buddy.git
   cd cf_ai_run-buddy/run-buddy
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Cloudflare secrets**:
   ```bash
   # Create .dev.vars file for local development
   cat > .dev.vars << EOF
   CF_ACCOUNT_ID=your_account_id
   CF_GATEWAY_ID=your_gateway_id
   CF_TOKEN=your_cloudflare_api_token
   EOF
   ```

   To get these values:
   - `CF_ACCOUNT_ID`: Found in Cloudflare Dashboard → Workers & Pages → Account ID
   - `CF_GATEWAY_ID`: Create an AI Gateway in Cloudflare Dashboard → AI → AI Gateway
   - `CF_TOKEN`: Create an API token with Workers AI permissions

4. **Run locally**:
   ```bash
   npm run dev
   ```

   Visit `http://localhost:8787` to test the chat interface.

### Deployment

1. **Configure production secrets**:
   ```bash
   npx wrangler secret put CF_TOKEN
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_GATEWAY_ID
   ```

2. **Deploy**:
   ```bash
   npm run deploy
   ```

3. **Access your deployed app**:
   Your app will be available at `https://your-worker-name.your-subdomain.workers.dev`

## Usage

### Getting Started

1. Visit the deployed URL or run locally
2. Enter your email address to create/access your runner profile
3. Start chatting with RunBuddy!

### Example Conversations

- **Create a profile**: "I'm training for the NYC marathon on November 3rd and can run 5 days a week"
- **Log a workout**: "I ran 10km today at moderate effort in 55 minutes"
- **Request a plan**: "Can you create a 12-week half marathon training plan for me?"
- **Get advice**: "What should my long run distance be this week?"
- **Track progress**: "Show me my recent running history"

### State Management

RunBuddy maintains state per email including:
- Runner profile (name, experience level, goals, availability)
- Workout history (up to 30 recent runs)
- Training plans (up to 12 saved plans)
- Feedback on training effectiveness

## API Endpoints

### `POST /chat`
Main chat endpoint that routes to the appropriate Durable Object instance.

**Request**:
```json
{
  "email": "runner@example.com",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "parts": [{ "type": "text", "text": "Hi RunBuddy!" }],
      "createdAt": "2025-10-02T00:00:00.000Z"
    }
  ]
}
```

**Response**: Server-sent events stream with AI-generated text

## Technical Details

### Durable Objects

Each runner gets their own Durable Object instance (keyed by email) which maintains:
- SQLite-backed persistent storage
- Runner profile data
- Workout logs and training plans
- Active conversation context

### AI Integration

- **Model**: Llama 3.1 8B Instruct via Workers AI
- **Streaming**: Real-time token-by-token responses
- **System Prompt**: Specialized coaching persona with structured output guidance
- **Context**: Full conversation history maintained in Durable Object state

### Performance

- **Cold start**: ~50-70ms (Workers + DO initialization)
- **Response latency**: Streaming starts within 200-400ms
- **Global availability**: Runs on Cloudflare's edge network
- **Scalability**: Durable Objects handle millions of concurrent users

## Development

### Running Tests

```bash
npm test
```

### Type Checking

```bash
npm run cf-typegen
```

### Code Structure

- `src/index.ts`: Main Worker that routes requests to Durable Objects
- `src/agents/run-buddy-agent.ts`: Durable Object containing AI logic and state management
- `public/index.html`: Single-page chat application with SSE parsing

## Limitations & Future Enhancements

### Current Limitations
- No authentication (email-based identification only)
- Basic UI (functional but minimal styling)
- No tool calling / function execution (planned)
- Simple state schema (no relations or advanced queries)

### Planned Features
- 🔧 Function calling for structured data updates
- 📅 Calendar integration for race scheduling
- 📈 Advanced analytics and visualizations
- 🏃‍♀️ Multi-user group training features
- 🌐 Mobile app via PWA
- 🎯 Integration with Strava/Garmin
- 🧠 RAG for running knowledge base

## Contributing

This is a demonstration project for the Cloudflare AI assignment. Feel free to fork and extend!

## License

MIT

## Links

- **Live Demo**: https://cloudflare-llm-chat.leiwuhoo.workers.dev
- **Cloudflare Docs**: https://developers.cloudflare.com/
- **Workers AI**: https://developers.cloudflare.com/workers-ai/
- **Durable Objects**: https://developers.cloudflare.com/durable-objects/

## Assignment Checklist

- ✅ **LLM**: Llama 3.1 8B on Workers AI
- ✅ **Workflow/Coordination**: Durable Objects for state and coordination
- ✅ **User Input**: Chat interface with streaming responses
- ✅ **Memory/State**: Persistent profile, workouts, and plans per user
- ✅ **Documentation**: README.md with setup instructions
- ✅ **AI Prompts**: PROMPTS.md with development conversation

