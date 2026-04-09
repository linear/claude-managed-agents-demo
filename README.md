# Claude + Linear Agent Bridge

**_This is an example project not meant for production use._**

A bridge server that connects [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) to [Linear's Agent Platform](https://linear.app/developers/agents). When users @mention or assign the agent in Linear, the server forwards the request to a Claude Managed Agent session and streams the response back as Linear agent activities.

## How it works

1. A user @mentions your agent in a Linear issue or comment
2. Linear sends an `AgentSessionEvent` webhook to your server
3. The server acknowledges with a "thinking" activity (required within 10s)
4. A Claude Managed Agent session is created with the issue context
5. Claude's streamed response is relayed back to Linear as agent activities

## Prerequisites

- [Bun](https://bun.sh) runtime
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- A Claude Managed Agent (agent ID and environment ID)
- A Linear workspace with admin access

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Create a Linear OAuth Application

Go to [Linear API Settings](https://linear.app/settings/api/applications) and create a new application:

- **Redirect URL**: `<your BASE_URL>/oauth/callback`
- **Webhook URL**: `<your BASE_URL>/webhook`
- **Webhook events**: Subscribe to **Agent session events**

Copy the **Client ID**, **Client Secret**, and **Webhook Signing Secret**.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in your credentials in `.env.local`:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `CLAUDE_AGENT_ID` | Claude Managed Agent ID |
| `CLAUDE_ENVIRONMENT_ID` | Claude environment ID |
| `LINEAR_CLIENT_ID` | From Linear OAuth app settings |
| `LINEAR_CLIENT_SECRET` | From Linear OAuth app settings |
| `LINEAR_WEBHOOK_SIGNING_SECRET` | From Linear OAuth app settings |
| `PORT` | Server port (default: `3000`) |
| `BASE_URL` | Public URL of your server |
| `LINEAR_URL` | Linear app URL (default: `https://linear.app`) |
| `LINEAR_API_URL` | Linear API URL (default: `https://api.linear.app`) |

### 4. Start the server

```bash
bun run dev
```

### 5. Install the agent in your workspace

Visit `<your BASE_URL>/oauth/authorize` in your browser. This initiates the OAuth flow with `actor=app`, which installs the agent as an app user in your Linear workspace (requires workspace admin).

### 6. Use it

@mention the agent in any Linear issue — it will forward the context to your Claude Managed Agent and post the response back.

## Project structure

```
src/
  main.ts    Server with webhook, OAuth, and health check routes
  oauth.ts   Linear OAuth flow (actor=app) with token refresh
  agent.ts   Claude Managed Agent session bridge
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/oauth/authorize` | Starts Linear OAuth installation flow |
| `GET` | `/oauth/callback` | OAuth callback, exchanges code for token |
| `POST` | `/webhook` | Receives Linear agent session webhooks |
