import { GmailApiEmailTool } from "../tools/gmail-api-email-tool.js";
import type { EmailTool } from "../tools/types.js";

export type GmailApiSendSmokeStatus = "pass" | "fail" | "blocked";

export type GmailApiSendSmokeReport = {
  status: GmailApiSendSmokeStatus;
  checkedAt: string;
  to?: string;
  marker: string;
  checks: {
    id: string;
    name: string;
    status: GmailApiSendSmokeStatus;
    message?: string;
    error?: string;
    emailId?: string;
    threadId?: string;
  }[];
};

export type GmailApiSendSmokeOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  email?: Pick<EmailTool, "sendEmail">;
  to?: string;
  requireToken?: boolean;
  tokenAvailable?: boolean;
  requireSender?: boolean;
  senderAvailable?: boolean;
  now?: () => Date;
};

export async function runGmailApiSendSmoke(
  options: GmailApiSendSmokeOptions = {},
): Promise<GmailApiSendSmokeReport> {
  const env = options.env ?? process.env;
  const checkedAtDate = (options.now ?? (() => new Date()))();
  const checkedAt = checkedAtDate.toISOString();
  const marker = `poc-pilot-gmail-api-send-smoke-${timestampKey(checkedAtDate)}`;
  const to = options.to ?? env.GMAIL_API_SEND_SMOKE_TO;
  const missing = requiredEnvMissing({
    env,
    to,
    requireToken: options.requireToken ?? false,
    tokenAvailable: options.tokenAvailable,
    requireSender: options.requireSender ?? false,
    senderAvailable: options.senderAvailable,
  });

  if (missing.length) {
    return {
      status: "blocked",
      checkedAt,
      to,
      marker,
      checks: [
        {
          id: "required-env",
          name: "Required Gmail API send smoke environment",
          status: "blocked",
          message: `Missing required environment variable(s): ${missing.join(", ")}`,
        },
      ],
    };
  }

  const email =
    options.email ??
    new GmailApiEmailTool({
      env: env as NodeJS.ProcessEnv,
      clock: () => checkedAtDate,
    });

  try {
    const sent = await email.sendEmail({
      to: [requiredRecipient(to)],
      subject: `PostHog PoC Gmail API send smoke ${marker}`,
      markdownBody: [
        "This is a guarded Gmail API direct-send smoke test from the PostHog PoC automation app.",
        "",
        `Marker: ${marker}`,
      ].join("\n"),
      tags: ["test:gmail-api-send", "delivery:send"],
    });

    return {
      status: "pass",
      checkedAt,
      to,
      marker,
      checks: [
        {
          id: "gmail-api-send",
          name: "Send Gmail API smoke email",
          status: "pass",
          message: "Gmail API send succeeded.",
          emailId: sent.emailId,
          threadId: sent.threadId,
        },
      ],
    };
  } catch (error) {
    return {
      status: "fail",
      checkedAt,
      to,
      marker,
      checks: [
        {
          id: "gmail-api-send",
          name: "Send Gmail API smoke email",
          status: "fail",
          error: (error as Error).message,
        },
      ],
    };
  }
}

function requiredEnvMissing(input: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  to?: string;
  requireToken: boolean;
  tokenAvailable?: boolean;
  requireSender: boolean;
  senderAvailable?: boolean;
}): string[] {
  const missing: string[] = [];
  if (input.env.GMAIL_API_SEND_SMOKE !== "1") {
    missing.push("GMAIL_API_SEND_SMOKE=1");
  }
  if (!input.to) {
    missing.push("GMAIL_API_SEND_SMOKE_TO");
  }
  if (
    input.requireToken &&
    !input.tokenAvailable &&
    !input.env.GMAIL_API_ACCESS_TOKEN &&
    !input.env.GMAIL_MCP_ACCESS_TOKEN
  ) {
    missing.push("GMAIL_API_ACCESS_TOKEN or connected Google OAuth token");
  }
  if (input.requireSender && !input.senderAvailable && !input.env.EMAIL_FROM) {
    missing.push("EMAIL_FROM or connected Google OAuth email");
  }
  return missing;
}

function requiredRecipient(to: string | undefined): string {
  if (!to) {
    throw new Error("GMAIL_API_SEND_SMOKE_TO is required");
  }
  return to;
}

function timestampKey(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
}
