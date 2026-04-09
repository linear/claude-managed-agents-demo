import { LinearWebhookClient } from "@linear/sdk/webhooks";
import { handleOAuthAuthorize, handleOAuthCallback } from "./oauth";
import { handleAgentSession } from "./agent";

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const webhookSigningSecret = process.env.LINEAR_WEBHOOK_SIGNING_SECRET;
if (!webhookSigningSecret) {
  console.warn(
    "WARNING: LINEAR_WEBHOOK_SIGNING_SECRET not set. Webhook signature verification will be skipped."
  );
}

const webhookClient = webhookSigningSecret
  ? new LinearWebhookClient(webhookSigningSecret)
  : null;

const handler = webhookClient?.createHandler();
handler?.on("AgentSessionEvent", async (event) => {
  console.log(
    `[webhook] AgentSessionEvent: action=${event.action}, session=${event.agentSession.id}`
  );
  // Process asynchronously so we return the webhook response quickly
  handleAgentSession(event).catch((err) => {
    console.error("[agent] Error handling session:", err);
  });
});

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/" && req.method === "GET") {
      return Response.json({ status: "ok", agent: "claude-linear-bridge" });
    }

    // OAuth flow
    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      return handleOAuthAuthorize(url);
    }
    if (url.pathname === "/oauth/callback" && req.method === "GET") {
      return handleOAuthCallback(url);
    }

    // Linear webhook
    if (url.pathname === "/webhook" && req.method === "POST") {
      if (handler) {
        return handler(req);
      }
      // Without signing secret, manually parse and handle
      const body = await req.json();
      if (body.type === "AgentSessionEvent") {
        handleAgentSession(body).catch((err) => {
          console.error("[agent] Error handling session:", err);
        });
      }
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${BASE_URL} (port ${PORT})`);
console.log(`  OAuth:   ${BASE_URL}/oauth/authorize`);
console.log(`  Webhook: ${BASE_URL}/webhook`);
