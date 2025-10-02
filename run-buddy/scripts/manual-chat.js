import { fetch } from "undici";

const endpoint = process.argv[2] ?? "https://cloudflare-llm-chat.leiwuhoo.workers.dev/agents/run-buddy-agent/use-chat";

const payload = {
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [
            { type: "text", text: "Hi RunBuddy, outline a half marathon plan." }
          ],
          createdAt: new Date().toISOString()
        }
      ]
    })
  }
};

const options = {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "text/event-stream"
  },
  body: JSON.stringify(payload)
};

const response = await fetch(endpoint, options);
console.log("status", response.status, response.statusText);
console.log("headers", Object.fromEntries(response.headers));

if (!response.body) {
  console.error("No response body");
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const segments = buffer.split("\n\n");
  buffer = segments.pop() ?? "";
  for (const segment of segments) {
    const line = segment.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      console.log("event", data);
    } catch (error) {
      console.error("failed to parse", payload, error);
    }
  }
}

if (buffer) console.log(buffer);
