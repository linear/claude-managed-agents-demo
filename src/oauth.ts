import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID!;
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET!;
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const LINEAR_URL = process.env.LINEAR_URL || "https://linear.app";
const LINEAR_API_URL = process.env.LINEAR_API_URL || "https://api.linear.app";
const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

// Token store persisted to .linear-tokens.json (gitignored)
type TokenEntry = { accessToken: string; refreshToken: string; expiresAt: number };
const TOKEN_FILE = join(import.meta.dir, "..", ".linear-tokens.json");

function loadTokens(): Map<string, TokenEntry> {
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function saveTokens(tokens: Map<string, TokenEntry>) {
  writeFileSync(TOKEN_FILE, JSON.stringify(Object.fromEntries(tokens), null, 2));
}

export const tokenStore = loadTokens();

export function handleOAuthAuthorize(url: URL): Response {
  const params = new URLSearchParams({
    client_id: LINEAR_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "read,write,app:assignable,app:mentionable",
    actor: "app",
  });

  return Response.redirect(
    `${LINEAR_URL}/oauth/authorize?${params.toString()}`
  );
}

export async function handleOAuthCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  console.log(`[oauth] Token response: ${LINEAR_API_URL}/oauth/token`);
  const tokenResponse = await fetch(`${LINEAR_API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: LINEAR_CLIENT_ID,
      client_secret: LINEAR_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error("[oauth] Token exchange failed:", error);
    return new Response(`OAuth token exchange failed: ${error}`, {
      status: 500,
    });
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Query organization ID for multi-tenant token storage
  const orgResponse = await fetch(`${LINEAR_API_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      query: "{ organization { id name } }",
    }),
  });

  const orgData = (await orgResponse.json()) as {
    data: { organization: { id: string; name: string } };
  };
  const org = orgData.data.organization;

  tokenStore.set(org.id, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  saveTokens(tokenStore);

  console.log(
    `[oauth] Installed in workspace "${org.name}" (${org.id})`
  );

  return new Response(
    `<html><body>
      <h1>Agent installed!</h1>
      <p>Workspace: ${org.name}</p>
      <p>You can now @mention the agent in Linear issues.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function getAccessToken(organizationId: string): Promise<string> {
  const stored = tokenStore.get(organizationId);
  if (!stored) {
    throw new Error(`No token for organization ${organizationId}`);
  }

  // Refresh if token expires within 5 minutes
  if (stored.expiresAt - Date.now() < 5 * 60 * 1000) {
    console.log(`[oauth] Refreshing token for ${organizationId}`);
    const tokenResponse = await fetch(`${LINEAR_API_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: LINEAR_CLIENT_ID,
        client_secret: LINEAR_CLIENT_SECRET,
        refresh_token: stored.refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token refresh failed: ${await tokenResponse.text()}`);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    stored.accessToken = tokens.access_token;
    stored.refreshToken = tokens.refresh_token;
    stored.expiresAt = Date.now() + tokens.expires_in * 1000;
    saveTokens(tokenStore);
  }

  return stored.accessToken;
}
