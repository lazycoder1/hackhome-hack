import type { EmailTool, SendEmailInput } from "./types.js";
import { bodyWithTags, markdownToHtml } from "./email-rendering.js";

export type GmailCreateDraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  htmlBody?: string;
  replyToMessageId?: string;
};

export type GmailMcpDraft = {
  id?: string;
  threadId?: string;
  thread_id?: string;
  subject?: string;
};

export type GmailMcpSentMessage = {
  id?: string;
  threadId?: string;
  thread_id?: string;
};

export type GmailMcpMessage = Record<string, unknown> & {
  id?: string;
  threadId?: string;
  thread_id?: string;
  snippet?: string;
  subject?: string;
  sender?: string;
  from?: string;
  to?: string | string[];
  toRecipients?: string[];
  ccRecipients?: string[];
  date?: string;
  plaintextBody?: string;
};

export type GmailMcpThread = {
  id: string;
  messages: GmailMcpMessage[];
};

export type GmailMcpGateway = {
  createDraft(input: GmailCreateDraftInput): Promise<GmailMcpDraft>;
  sendMessage?(input: GmailCreateDraftInput): Promise<GmailMcpSentMessage>;
  searchThreads(input: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrash?: boolean;
  }): Promise<{
    threads: GmailMcpThread[];
    nextPageToken?: string;
    next_page_token?: string;
  }>;
  getThread(input: {
    threadId: string;
    messageFormat?: "FULL_CONTENT" | "MINIMAL" | "MESSAGE_FORMAT_UNSPECIFIED";
  }): Promise<GmailMcpThread>;
  labelThread?(input: { threadId: string; labelIds: string[] }): Promise<{ success?: boolean }>;
};

export type GmailMcpEmailToolOptions = {
  gateway: GmailMcpGateway;
  deliveryMode?: "draft" | "send";
  clock?: () => Date;
};

export class GmailMcpEmailTool implements EmailTool {
  private readonly gateway: GmailMcpGateway;
  private readonly deliveryMode: "draft" | "send";
  private readonly clock: () => Date;

  constructor(options: GmailMcpEmailToolOptions) {
    this.gateway = options.gateway;
    this.deliveryMode = options.deliveryMode ?? "draft";
    this.clock = options.clock ?? (() => new Date());
  }

  async sendEmail(
    input: SendEmailInput,
  ): Promise<{ emailId: string; threadId: string; sentAt: string }> {
    const body = bodyWithTags(input.markdownBody, input.tags ?? []);
    const message = {
      to: input.to.map(plainEmail),
      cc: input.cc?.map(plainEmail),
      bcc: input.bcc?.map(plainEmail),
      subject: input.subject,
      body,
      htmlBody: markdownToHtml(body),
      replyToMessageId: input.threadId,
    };

    const result =
      this.deliveryMode === "send"
        ? await this.sendMessage(message)
        : await this.gateway.createDraft(message);

    const emailId = result.id ?? crypto.randomUUID();
    return {
      emailId,
      threadId: result.threadId ?? result.thread_id ?? input.threadId ?? emailId,
      sentAt: this.clock().toISOString(),
    };
  }

  private async sendMessage(input: GmailCreateDraftInput): Promise<GmailMcpSentMessage> {
    if (!this.gateway.sendMessage) {
      throw new Error("Gmail MCP gateway does not support direct send");
    }
    return await this.gateway.sendMessage(input);
  }
}

function plainEmail(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}
