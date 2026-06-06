import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import { GmailApiInboxGateway } from "../tools/gmail-api-inbox-gateway.js";
import type { GmailMcpGateway } from "../tools/gmail-mcp-email-tool.js";
import { GmailRemoteMcpGateway } from "../tools/gmail-remote-mcp-gateway.js";
import { createAgentSystem, type AgentSystem } from "./create-agent-system.js";

export type TriggerSystem = {
  system: AgentSystem;
  gmailToken: () => Promise<string | undefined>;
};

/**
 * Build the Trigger.dev agent system with an auto-refreshing Gmail token.
 *
 * The worker is the process that actually calls Gmail, so it must refresh the
 * stored OAuth access token on demand (via the saved refresh token) instead of
 * reading the static, short-lived token. Without this, Gmail returns 401 once
 * the access token expires (~1h). Mirrors the HTTP server's local-mode wiring.
 */
export function createTriggerSystem(): TriggerSystem {
  const googleOAuth = new GoogleOAuthTestService();
  const gmailToken = () => googleOAuth.freshAccessToken();
  const system = createAgentSystem({
    approvalMode: "trigger",
    gmailAccessTokenProvider: gmailToken,
  });
  return { system, gmailToken };
}

/**
 * Pick the inbox gateway to match how mail is sent. The hosted Gmail MCP is
 * Google Workspace-gated, so a personal @gmail.com account (EMAIL_MODE=gmail_api)
 * must read its inbox over the plain Gmail REST API instead. Both implement the
 * same GmailMcpGateway read interface, so this is a drop-in choice.
 */
export function createInboxGateway(
  gmailToken: () => Promise<string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): GmailMcpGateway {
  const mode = (env.EMAIL_MODE ?? "").toLowerCase();
  return mode === "gmail_api"
    ? new GmailApiInboxGateway({ accessTokenProvider: gmailToken })
    : new GmailRemoteMcpGateway({ accessTokenProvider: gmailToken });
}
