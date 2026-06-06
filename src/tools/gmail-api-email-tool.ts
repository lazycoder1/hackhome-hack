import type { EmailTool, SendEmailInput } from "./types.js";
import { bodyWithTags, markdownToHtml } from "./email-rendering.js";

const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com";
const DEFAULT_GMAIL_USER_ID = "me";

export type GmailApiEmailToolOptions = {
  accessToken?: string;
  accessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  userId?: string;
  from?: string;
  fromProvider?: () => string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
};

type GmailSendResponse = {
  id?: string;
  threadId?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
};

export class GmailApiEmailTool implements EmailTool {
  private readonly accessToken?: string;
  private readonly accessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  private readonly userId: string;
  private readonly from?: string;
  private readonly fromProvider?: () => string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: GmailApiEmailToolOptions = {}) {
    const env = options.env ?? process.env;
    this.accessToken =
      options.accessToken ?? env.GMAIL_API_ACCESS_TOKEN ?? env.GMAIL_MCP_ACCESS_TOKEN;
    this.accessTokenProvider = options.accessTokenProvider;
    this.userId = options.userId ?? env.GMAIL_API_USER_ID ?? DEFAULT_GMAIL_USER_ID;
    this.from = options.from ?? env.EMAIL_FROM;
    this.fromProvider = options.fromProvider;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? env.GMAIL_API_BASE_URL ?? DEFAULT_GMAIL_API_BASE_URL,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  async sendEmail(
    input: SendEmailInput,
  ): Promise<{ emailId: string; threadId: string; sentAt: string }> {
    const accessToken = (await this.accessTokenProvider?.()) ?? this.accessToken;
    if (!accessToken) {
      throw new Error("GMAIL_API_ACCESS_TOKEN is required for EMAIL_MODE=gmail_api");
    }
    const from = this.fromProvider?.() ?? this.from;
    if (!from) {
      throw new Error("EMAIL_FROM is required for EMAIL_MODE=gmail_api");
    }
    if (input.attachments?.length) {
      throw new Error("Gmail API email attachments are not supported by this PoC sender");
    }

    const sentAt = this.clock();
    const body = bodyWithTags(input.markdownBody, input.tags ?? []);
    const raw = encodeBase64Url(
      buildMimeMessage({
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: body,
        htmlBody: markdownToHtml(body),
        date: sentAt,
      }),
    );

    const response = await this.fetchImpl(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/messages/send`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          raw,
          threadId: input.threadId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gmail API send failed with ${response.status}: ${await response.text()}`);
    }

    const result = (await response.json()) as GmailSendResponse;
    const emailId = result.id ?? crypto.randomUUID();
    return {
      emailId,
      threadId: result.threadId ?? input.threadId ?? emailId,
      sentAt: sentAt.toISOString(),
    };
  }

  async createDraft(
    input: SendEmailInput,
  ): Promise<{ emailId: string; threadId: string; sentAt: string }> {
    const accessToken = (await this.accessTokenProvider?.()) ?? this.accessToken;
    if (!accessToken) {
      throw new Error("GMAIL_API_ACCESS_TOKEN is required to create Gmail API drafts");
    }
    const from = this.fromProvider?.() ?? this.from;
    if (!from) {
      throw new Error("EMAIL_FROM is required to create Gmail API drafts");
    }
    if (input.attachments?.length) {
      throw new Error("Gmail API email attachments are not supported by this PoC sender");
    }

    const sentAt = this.clock();
    const body = bodyWithTags(input.markdownBody, input.tags ?? []);
    const raw = encodeBase64Url(
      buildMimeMessage({
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: body,
        htmlBody: markdownToHtml(body),
        date: sentAt,
      }),
    );

    const response = await this.fetchImpl(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/drafts`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            raw,
            threadId: input.threadId,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gmail API draft failed with ${response.status}: ${await response.text()}`);
    }

    const result = (await response.json()) as GmailSendResponse;
    const emailId = result.id ?? result.message?.id ?? crypto.randomUUID();
    return {
      emailId,
      threadId: result.message?.threadId ?? result.threadId ?? input.threadId ?? emailId,
      sentAt: sentAt.toISOString(),
    };
  }
}

function buildMimeMessage(input: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
  date: Date;
}): string {
  const boundary = `poc-${crypto.randomUUID()}`;
  const headers = [
    ["From", input.from],
    ["To", input.to.join(", ")],
    input.cc?.length ? ["Cc", input.cc.join(", ")] : undefined,
    input.bcc?.length ? ["Bcc", input.bcc.join(", ")] : undefined,
    ["Subject", input.subject],
    ["Date", input.date.toUTCString()],
    ["MIME-Version", "1.0"],
    ["Content-Type", `multipart/alternative; boundary="${boundary}"`],
  ].filter((header): header is string[] => Boolean(header));

  return [
    ...headers.map(([name, value]) => `${name}: ${safeHeaderValue(value)}`),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(input.textBody),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBody(input.htmlBody),
    `--${boundary}--`,
  ].join("\r\n");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function safeHeaderValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Email header values must not contain line breaks");
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
