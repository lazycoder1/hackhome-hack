import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import type { PocStatusReadApi } from "../status/poc-status-reader.js";
import { normalizeGmailMcpInboundEmail } from "../tools/gmail-mcp-inbound-normalizer.js";
import type { EmailTool, SecretsTool } from "../tools/types.js";
import type { WorkflowApi } from "../workflow/workflow-api.js";
import type { NudgeApprovalService } from "../workflow/nudge-approval-service.js";
import {
  HttpError,
  parseBody,
  requirementsBlobSchema,
  approvalCompletionSchema,
  emailReplySchema,
  gmailMcpInboundSchema,
  googleTestDraftSchema,
  monitoringRunSchema,
  retryPocStageSchema,
} from "./request-schemas.js";

export type HttpApiServerOptions = {
  workflow: WorkflowApi;
  statusReader?: PocStatusReadApi;
  secrets?: Pick<SecretsTool, "consumeOneTimeSecretLink">;
  googleOAuth?: Pick<
    GoogleOAuthTestService,
    "status" | "createAuthorizationUrl" | "handleCallback" | "forget"
  >;
  googleTestEmail?: EmailTool;
  googleApiDraftEmail?: Pick<EmailTool, "sendEmail"> & {
    createDraft(input: Parameters<EmailTool["sendEmail"]>[0]): ReturnType<EmailTool["sendEmail"]>;
  };
  nudges?: Pick<NudgeApprovalService, "complete">;
};

export function createHttpApiServer(options: HttpApiServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, options);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, error.body);
        return;
      }
      sendJson(response, 500, {
        error: "internal_error",
        message: (error as Error).message,
      });
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpApiServerOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const workflow = options.workflow;

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/integrations/google/status") {
    sendJson(response, 200, options.googleOAuth?.status() ?? defaultGoogleOAuthStatus());
    return;
  }

  if (method === "GET" && url.pathname === "/integrations/google/oauth/start") {
    if (!options.googleOAuth) {
      sendJson(response, 503, { error: "google_oauth_not_configured" });
      return;
    }

    try {
      redirect(
        response,
        options.googleOAuth.createAuthorizationUrl({
          origin: safeOAuthOrigin(url.searchParams.get("origin"), requestOrigin(request)),
          returnTo: url.searchParams.get("returnTo") ?? undefined,
        }),
      );
    } catch (error) {
      sendHtml(response, 503, renderGoogleOAuthErrorPage((error as Error).message));
    }
    return;
  }

  if (method === "GET" && url.pathname === "/integrations/google/oauth/callback") {
    if (!options.googleOAuth) {
      sendHtml(response, 503, renderGoogleOAuthErrorPage("Google OAuth is not configured."));
      return;
    }

    try {
      const result = await options.googleOAuth.handleCallback({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      });
      const returnUrl = new URL(result.returnTo);
      returnUrl.searchParams.set("gmail", "connected");
      redirect(response, returnUrl.toString());
    } catch (error) {
      sendHtml(response, 400, renderGoogleOAuthErrorPage((error as Error).message));
    }
    return;
  }

  if (method === "POST" && url.pathname === "/integrations/google/oauth/forget") {
    sendJson(response, 200, options.googleOAuth?.forget() ?? defaultGoogleOAuthStatus());
    return;
  }

  if (method === "POST" && url.pathname === "/integrations/google/test-draft") {
    if (!options.googleTestEmail) {
      sendJson(response, 503, { error: "google_test_email_not_configured" });
      return;
    }

    const body = parseBody(await readRawBody(request), googleTestDraftSchema);
    const draftInput = {
      to: [body.to],
      subject: body.subject ?? "PoC Pilot Gmail OAuth test draft",
      markdownBody:
        body.body ??
        [
          "This is a test draft from the local PostHog PoC automation app.",
          "",
          "If this appears as a Gmail draft, OAuth and the Gmail MCP token path are working.",
        ].join("\n"),
      tags: ["test:gmail-oauth", "delivery:draft"],
    };

    let transport = "gmail_mcp";
    let mcpError: string | undefined;
    let result;
    try {
      result = await options.googleTestEmail.sendEmail(draftInput);
    } catch (error) {
      mcpError = (error as Error).message;
      if (!options.googleApiDraftEmail) {
        throw error;
      }
      transport = "gmail_api_fallback";
      result = await options.googleApiDraftEmail.createDraft(draftInput);
    }

    sendJson(response, 200, {
      ok: true,
      mode: "draft",
      transport,
      mcpError,
      ...result,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/approval") {
    const tokenId = url.searchParams.get("tokenId") ?? "";
    const publicAccessToken = url.searchParams.get("publicAccessToken") ?? "";
    sendHtml(
      response,
      tokenId && publicAccessToken ? 200 : 400,
      renderApprovalPage({
        tokenId,
        publicAccessToken,
        error:
          tokenId && publicAccessToken
            ? undefined
            : "This approval link is missing required token parameters.",
      }),
    );
    return;
  }

  const secretToken = secretTokenFromPath(url.pathname);
  if (method === "GET" && secretToken) {
    if (!options.secrets) {
      sendJson(response, 503, { error: "secrets_not_configured" });
      return;
    }

    const result = await options.secrets.consumeOneTimeSecretLink({ token: secretToken });
    if (result.status !== "consumed") {
      sendHtml(
        response,
        secretStatusCode(result.status),
        renderSecretUnavailablePage(result.status),
      );
      return;
    }

    sendHtml(
      response,
      200,
      renderSecretPage({
        name: result.name,
        value: result.value,
        expiresAt: result.expiresAt,
      }),
    );
    return;
  }

  if (method === "GET" && url.pathname === "/pocs") {
    if (!options.statusReader) {
      sendJson(response, 503, { error: "status_reader_not_configured" });
      return;
    }

    const result = await options.statusReader.list({
      limit: parseLimit(url.searchParams.get("limit")),
    });
    sendJson(response, 200, result);
    return;
  }

  const pocId = pocIdFromPath(url.pathname);
  const monitoringPocId = monitoringPocIdFromPath(url.pathname);
  const monitoringRunPocId = monitoringRunPocIdFromPath(url.pathname);
  const activityPocId = activityPocIdFromPath(url.pathname);
  const retryPocId = retryPocIdFromPath(url.pathname);

  if (method === "GET" && activityPocId) {
    if (!options.statusReader) {
      sendJson(response, 503, { error: "status_reader_not_configured" });
      return;
    }

    const result = await options.statusReader.activity(activityPocId, {
      limit: parseLimit(url.searchParams.get("limit")),
    });
    sendJson(response, 200, result);
    return;
  }

  const nudge = nudgeFromPath(url.pathname);
  if (method === "POST" && nudge) {
    if (!options.nudges) {
      sendJson(response, 503, { error: "nudges_not_configured" });
      return;
    }
    const raw = await readRawBody(request);
    const body = (raw ? JSON.parse(raw) : {}) as {
      decision?: unknown;
      editedBody?: unknown;
      decidedBy?: unknown;
    };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      sendJson(response, 400, { error: "invalid_decision" });
      return;
    }
    const result = await options.nudges.complete({
      pocId: nudge.pocId,
      tokenId: nudge.tokenId,
      decision: body.decision,
      editedBody: typeof body.editedBody === "string" ? body.editedBody : undefined,
      decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : undefined,
    });
    sendJson(response, result.status === "not_found" ? 404 : 200, result);
    return;
  }

  if (method === "GET" && monitoringPocId) {
    if (!options.statusReader) {
      sendJson(response, 503, { error: "status_reader_not_configured" });
      return;
    }

    const result = await options.statusReader.monitoringReports(monitoringPocId, {
      limit: parseLimit(url.searchParams.get("limit")),
    });
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && monitoringRunPocId) {
    const body = parseBody(await readRawBody(request), monitoringRunSchema);
    const result = await workflow.monitorActivePoc({
      pocId: monitoringRunPocId,
      window: body.window,
    });
    sendJson(response, 202, result);
    return;
  }

  if (method === "POST" && retryPocId) {
    const body = parseBody(await readRawBody(request), retryPocStageSchema);
    const result = await workflow.retryPocStage({
      pocId: retryPocId,
      stage: body.stage,
      requestedBy: body.requestedBy,
    });
    sendJson(response, 202, result);
    return;
  }

  if (method === "GET" && pocId) {
    if (!options.statusReader) {
      sendJson(response, 503, { error: "status_reader_not_configured" });
      return;
    }

    const result = await options.statusReader.detail(pocId);
    if (!result) {
      sendJson(response, 404, { error: "poc_not_found" });
      return;
    }
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/requirements") {
    const body = parseBody(await readRawBody(request), requirementsBlobSchema);
    const run = await workflow.startPosthogPocWorkflow(body);
    sendJson(response, 202, run);
    return;
  }

  if (method === "POST" && url.pathname === "/approval/complete") {
    const body = parseBody(await readRawBody(request), approvalCompletionSchema);
    const result = await workflow.completeApproval(body);
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/email/inbound") {
    const body = parseBody(await readRawBody(request), emailReplySchema);
    const result = await workflow.processEmailReply(body);
    sendJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/email/inbound/gmail-mcp") {
    const body = parseBody(await readRawBody(request), gmailMcpInboundSchema);
    const result = await workflow.processEmailReply(normalizeGmailMcpInboundEmail(body));
    sendJson(response, 200, result);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 302;
  response.setHeader("location", location);
  response.setHeader("cache-control", "no-store");
  response.end();
}

function requestOrigin(request: IncomingMessage): string {
  const proto = headerValue(request.headers["x-forwarded-proto"]) ?? "http";
  const host =
    headerValue(request.headers["x-forwarded-host"]) ?? headerValue(request.headers.host);
  return `${proto}://${host ?? "localhost:3000"}`;
}

function safeOAuthOrigin(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  try {
    const origin = new URL(value).origin;
    const hostname = new URL(origin).hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".ngrok-free.app")
    ) {
      return origin;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function defaultGoogleOAuthStatus() {
  return {
    configured: false,
    connected: false,
    scopes: [],
    provider: "workspace",
    deliveryMode: "draft" as const,
    memoryOnly: true as const,
    storage: "memory" as const,
  };
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.min(parsed, 100);
}

function pocIdFromPath(pathname: string): string | undefined {
  const match = /^\/pocs\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function retryPocIdFromPath(pathname: string): string | undefined {
  const match = /^\/pocs\/([^/]+)\/retry$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function monitoringPocIdFromPath(pathname: string): string | undefined {
  const match = /^\/pocs\/([^/]+)\/monitoring$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function monitoringRunPocIdFromPath(pathname: string): string | undefined {
  const match = /^\/pocs\/([^/]+)\/monitoring\/run$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function activityPocIdFromPath(pathname: string): string | undefined {
  const match = /^\/pocs\/([^/]+)\/activity$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function nudgeFromPath(pathname: string): { pocId: string; tokenId: string } | undefined {
  const match = /^\/pocs\/([^/]+)\/nudges\/([^/]+)$/.exec(pathname);
  return match
    ? { pocId: decodeURIComponent(match[1]), tokenId: decodeURIComponent(match[2]) }
    : undefined;
}

function secretTokenFromPath(pathname: string): string | undefined {
  const match = /^\/secrets\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function secretStatusCode(status: "not_found" | "expired" | "used" | "revoked"): number {
  return status === "not_found" ? 404 : 410;
}

function renderApprovalPage(input: {
  tokenId: string;
  publicAccessToken: string;
  error?: string;
}): string {
  const context = safeJsonForScript({
    tokenId: input.tokenId,
    publicAccessToken: input.publicAccessToken,
  });
  const disabled = input.error ? "disabled" : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PostHog PoC Approval</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #182230;
        background: #f7f8fa;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 16px;
      }
      main {
        width: min(100%, 640px);
        background: #ffffff;
        border: 1px solid #d9dee7;
        border-radius: 8px;
        box-shadow: 0 18px 50px rgba(24, 34, 48, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      p {
        margin: 0 0 20px;
        color: #4b5565;
        line-height: 1.55;
      }
      label {
        display: grid;
        gap: 8px;
        margin: 16px 0;
        font-size: 14px;
        font-weight: 650;
      }
      input,
      textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #c8cfda;
        border-radius: 6px;
        padding: 11px 12px;
        font: inherit;
        color: #182230;
        background: #ffffff;
      }
      textarea {
        min-height: 92px;
        resize: vertical;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 20px;
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 11px 14px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .primary {
        background: #1f7a4d;
        color: #ffffff;
      }
      .secondary {
        background: #d9e2ec;
        color: #182230;
      }
      .danger {
        background: #b42318;
        color: #ffffff;
      }
      .message {
        margin-top: 18px;
        padding: 12px;
        border-radius: 6px;
        background: #edf7ed;
        color: #1f6b3a;
        display: none;
      }
      .message.error,
      .banner {
        background: #fff1f0;
        color: #b42318;
      }
      .banner {
        display: block;
        margin-bottom: 18px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>PostHog PoC Approval</h1>
      <p>Confirm whether the PostHog PoC plan can proceed, or send the requested changes back to the workflow.</p>
      ${input.error ? `<div class="message banner">${escapeHtml(input.error)}</div>` : ""}
      <form id="approval-form">
        <label>
          Your email
          <input name="decidedBy" type="email" autocomplete="email" required ${disabled}>
        </label>
        <label>
          Notes
          <textarea name="notes" ${disabled}></textarea>
        </label>
        <label>
          Requested changes
          <textarea name="changes" ${disabled}></textarea>
        </label>
        <div class="actions">
          <button class="primary" type="submit" name="decision" value="approved" ${disabled}>Approve</button>
          <button class="secondary" type="submit" name="decision" value="needs_changes" ${disabled}>Request changes</button>
          <button class="danger" type="submit" name="decision" value="rejected" ${disabled}>Reject</button>
        </div>
      </form>
      <div id="message" class="message" role="status"></div>
    </main>
    <script>
      const approvalContext = ${context};
      const form = document.getElementById("approval-form");
      const message = document.getElementById("message");

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        const formData = new FormData(form);
        const decision = submitter && submitter.value ? submitter.value : "approved";
        const changesText = String(formData.get("changes") || "");
        const changes = changesText
          .split("\\n")
          .map((line) => line.trim())
          .filter(Boolean);

        const response = await fetch("/approval/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tokenId: approvalContext.tokenId,
            publicAccessToken: approvalContext.publicAccessToken,
            decision,
            decidedBy: String(formData.get("decidedBy") || ""),
            notes: String(formData.get("notes") || ""),
            changes,
          }),
        });

        message.style.display = "block";
        if (!response.ok) {
          message.className = "message error";
          message.textContent = "Approval could not be submitted. Please reply to the confirmation email.";
          return;
        }

        message.className = "message";
        message.textContent = decision === "approved" ? "Approved. Setup will start shortly." : "Response recorded.";
        form.querySelectorAll("input, textarea, button").forEach((element) => {
          element.disabled = true;
        });
      });
    </script>
  </body>
</html>`;
}

function renderGoogleOAuthErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google OAuth setup</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8f3e7; color: #151515; }
      main { max-width: 680px; margin: 12vh auto; padding: 28px; border: 2px solid #151515; background: #fff; box-shadow: 4px 4px 0 #151515; }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { line-height: 1.5; }
      a { color: #1d4aff; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <h1>Google OAuth setup failed</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/settings">Back to Settings</a></p>
    </main>
  </body>
</html>`;
}

function renderSecretPage(input: { name: string; value: string; expiresAt?: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>One-time Secret · PoC Pilot</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #151515;
        background: #f3f4ef;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 16px;
      }
      main {
        width: min(100%, 640px);
        background: #ffffff;
        border: 2px solid #151515;
        border-radius: 14px;
        box-shadow: 6px 6px 0 0 #151515;
        overflow: hidden;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 24px;
        background: #eeefe9;
        border-bottom: 2px solid #151515;
        font-weight: 800;
      }
      .brand .chip {
        margin-left: auto;
        border: 1.5px solid #151515;
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 12px;
        font-weight: 700;
        background: #f9bd2b;
      }
      .body { padding: 24px; }
      h1 {
        margin: 0 0 6px;
        font-size: 24px;
        line-height: 1.2;
        letter-spacing: -0.02em;
      }
      p { color: #4b5565; line-height: 1.55; margin: 0 0 14px; }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #151515;
        color: #f5f5f0;
        border: 2px solid #151515;
        border-radius: 10px;
        padding: 16px;
        overflow: auto;
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .meta { margin-top: 14px; font-size: 13px; font-weight: 700; color: #6b7066; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden><rect x="3" y="3" width="58" height="58" rx="14" fill="#1d4aff" stroke="#151515" stroke-width="4"/><path d="M20 44V20h10c6 0 10 4 10 9s-4 9-10 9h-4v6z" fill="#fff"/><circle cx="44" cy="24" r="5" fill="#f9bd2b" stroke="#151515" stroke-width="3"/></svg>
        PoC Pilot
        <span class="chip">One-time secret</span>
      </div>
      <div class="body">
        <h1>${escapeHtml(input.name)}</h1>
        <p>This secret has now been consumed and won’t be shown again. Store it in an approved password manager.</p>
        <pre>${escapeHtml(input.value)}</pre>
        <p class="meta">Expires: ${escapeHtml(input.expiresAt ?? "Not set")}</p>
      </div>
    </main>
  </body>
</html>`;
}

function renderSecretUnavailablePage(status: "not_found" | "expired" | "used" | "revoked"): string {
  const message =
    status === "not_found"
      ? "This secret link was not found."
      : status === "expired"
        ? "This secret link has expired."
        : status === "used"
          ? "This secret link has already been used."
          : "This secret has been revoked.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Secret unavailable · PoC Pilot</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #151515;
        background: #f3f4ef;
      }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; }
      main {
        width: min(100%, 520px);
        background: #ffffff;
        border: 2px solid #151515;
        border-radius: 14px;
        box-shadow: 6px 6px 0 0 #151515;
        padding: 28px;
        text-align: center;
      }
      h1 { margin: 14px 0 6px; font-size: 22px; letter-spacing: -0.02em; }
      p { color: #4b5565; line-height: 1.55; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden><rect x="3" y="3" width="58" height="58" rx="14" fill="#1d4aff" stroke="#151515" stroke-width="4"/><path d="M20 44V20h10c6 0 10 4 10 9s-4 9-10 9h-4v6z" fill="#fff"/><circle cx="44" cy="24" r="5" fill="#f9bd2b" stroke="#151515" stroke-width="3"/></svg>
      <h1>Secret unavailable</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
