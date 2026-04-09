import Anthropic from "@anthropic-ai/sdk";
import { LinearClient } from "@linear/sdk";
import { getAccessToken } from "./oauth";

const anthropic = new Anthropic();

const CLAUDE_AGENT_ID = process.env.CLAUDE_AGENT_ID!;
const CLAUDE_ENVIRONMENT_ID = process.env.CLAUDE_ENVIRONMENT_ID!;
const LINEAR_API_URL = process.env.LINEAR_API_URL || "https://api.linear.app";

interface AgentSessionEvent {
  action: string;
  agentSession: {
    id: string;
    issue?: {
      id: string;
      identifier: string;
      title: string;
      description?: string | null;
      url: string;
    } | null;
    comment?: {
      id: string;
      body: string;
    } | null;
  };
  agentActivity?: {
    content: { body?: string; type: string };
  } | null;
  organizationId: string;
  promptContext?: string | null;
  previousComments?: Array<{ body: string }> | null;
}

export async function handleAgentSession(event: AgentSessionEvent) {
  const { agentSession, organizationId } = event;
  const sessionId = agentSession.id;

  console.log(`[agent] Processing session ${sessionId}, action=${event.action}`);

  // Get Linear client for this workspace
  const accessToken = await getAccessToken(organizationId);
  const linear = new LinearClient({ accessToken, apiUrl: `${LINEAR_API_URL}/graphql` });

  // Acknowledge quickly with a thought
  await linear.createAgentActivity({
    agentSessionId: sessionId,
    content: { type: "thought", body: "Processing your request..." },
  });

  // Build the prompt from the webhook context
  const prompt = buildPrompt(event);

  try {
    // Create a Claude Managed Agent session
    const claudeSession = await anthropic.beta.sessions.create({
      agent: { type: "agent", id: CLAUDE_AGENT_ID },
      environment_id: CLAUDE_ENVIRONMENT_ID,
      betas: ["managed-agents-2026-04-01"],
    });

    console.log(`[agent] Claude session created: ${claudeSession.id}`);

    // Open stream before sending message
    const stream = await anthropic.beta.sessions.events.stream(claudeSession.id, {
      betas: ["managed-agents-2026-04-01"],
    });

    // Send the user message
    await anthropic.beta.sessions.events.send(claudeSession.id, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: prompt }],
        },
      ],
      betas: ["managed-agents-2026-04-01"],
    });

    // Stream Claude's response and relay to Linear
    let responseText = "";

    for await (const event of stream) {
      if (event.type === "agent.message") {
        for (const block of event.content) {
          if ("text" in block) {
            responseText += block.text;
          }
        }
      } else if (event.type === "agent.tool_use") {
        // Show tool usage as an action in Linear
        await linear.createAgentActivity({
          agentSessionId: sessionId,
          ephemeral: true,
          content: {
            type: "action",
            action: (event as any).name || "Processing",
            parameter: "",
          },
        });
      } else if (event.type === "session.status_idle") {
        break;
      }
    }

    // Post the final response
    if (responseText.trim()) {
      await linear.createAgentActivity({
        agentSessionId: sessionId,
        content: { type: "response", body: responseText.trim() },
      });
    }

    console.log(`[agent] Session ${sessionId} completed`);
  } catch (err) {
    console.error(`[agent] Error in session ${sessionId}:`, err);
    await linear.createAgentActivity({
      agentSessionId: sessionId,
      content: {
        type: "error",
        body: `Agent encountered an error: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
}

function buildPrompt(event: AgentSessionEvent): string {
  // Use Linear's pre-formatted prompt context if available
  if (event.promptContext) {
    return event.promptContext;
  }

  const parts: string[] = [];
  const { agentSession, agentActivity, previousComments } = event;

  if (agentSession.issue) {
    const issue = agentSession.issue;
    parts.push(`Issue: ${issue.identifier} - ${issue.title}`);
    if (issue.description) {
      parts.push(`Description: ${issue.description}`);
    }
  }

  if (previousComments?.length) {
    parts.push(
      "Previous comments:\n" +
        previousComments.map((c) => `- ${c.body}`).join("\n")
    );
  }

  if (agentActivity?.content?.body) {
    parts.push(`User message: ${agentActivity.content.body}`);
  } else if (agentSession.comment?.body) {
    parts.push(`User message: ${agentSession.comment.body}`);
  }

  return parts.join("\n\n") || "Hello! How can I help?";
}
