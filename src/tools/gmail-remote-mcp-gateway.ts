import { readFileSync } from "node:fs";
import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";
import type {
  GmailCreateDraftInput,
  GmailMcpDraft,
  GmailMcpGateway,
  GmailMcpMessage,
  GmailMcpSentMessage,
  GmailMcpThread,
} from "./gmail-mcp-email-tool.js";

const DEFAULT_GMAIL_MCP_ENDPOINT = "https://gmailmcp.googleapis.com/mcp/v1";

export type GmailRemoteMcpGatewayOptions = {
  endpoint?: string;
  accessToken?: string;
  accessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  provider?: "google" | "workspace";
  userProject?: string;
  toolClient?: McpToolClient;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export class GmailRemoteMcpGateway implements GmailMcpGateway {
  private readonly toolClient: McpToolClient;
  private readonly provider: "google" | "workspace";

  constructor(options: GmailRemoteMcpGatewayOptions = {}) {
    const env = options.env ?? process.env;
    this.provider = options.provider ?? gmailMcpProviderFromEnv(env.GMAIL_MCP_PROVIDER);
    const accessTokenProvider =
      options.accessTokenProvider ?? (() => storedGoogleOAuthAccessToken(env));
    this.toolClient =
      options.toolClient ??
      new HttpMcpToolClient({
        endpoint: options.endpoint ?? env.GMAIL_MCP_ENDPOINT ?? DEFAULT_GMAIL_MCP_ENDPOINT,
        apiKey: options.accessToken ?? env.GMAIL_MCP_ACCESS_TOKEN,
        apiKeyProvider: accessTokenProvider,
        extraHeaders: {
          "x-goog-user-project": options.userProject ?? env.GMAIL_MCP_USER_PROJECT,
        },
        fetchImpl: options.fetchImpl,
      });
  }

  async createDraft(input: GmailCreateDraftInput): Promise<GmailMcpDraft> {
    const result =
      this.provider === "workspace"
        ? await this.toolClient.callTool("draft_gmail_message", {
            to: input.to.join(", "),
            cc: input.cc?.join(", "),
            bcc: input.bcc?.join(", "),
            subject: input.subject,
            body: input.body,
          })
        : await this.toolClient.callTool("create_draft", {
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            body: input.body,
            htmlBody: input.htmlBody,
            replyToMessageId: input.replyToMessageId,
          });

    return toDraft(result, input.subject);
  }

  async sendMessage(input: GmailCreateDraftInput): Promise<GmailMcpSentMessage> {
    const result = await this.toolClient.callTool("send_gmail_message", {
      to: input.to.join(", "),
      cc: input.cc?.join(", "),
      bcc: input.bcc?.join(", "),
      subject: input.subject,
      body: input.body,
      body_format: input.htmlBody ? "html" : "plain",
      thread_id: input.replyToMessageId,
    });

    return toSentMessage(result);
  }

  async searchThreads(input: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrash?: boolean;
  }): Promise<{ threads: GmailMcpThread[]; nextPageToken?: string; next_page_token?: string }> {
    const result = asRecord(
      await this.toolClient.callTool("search_threads", {
        query: input.query,
        pageSize: input.pageSize,
        pageToken: input.pageToken,
        includeTrash: input.includeTrash,
      }),
    );

    return {
      threads: arrayField(result, "threads").map(toThread),
      nextPageToken: stringField(result, "nextPageToken"),
      next_page_token: stringField(result, "next_page_token"),
    };
  }

  async getThread(input: {
    threadId: string;
    messageFormat?: "FULL_CONTENT" | "MINIMAL" | "MESSAGE_FORMAT_UNSPECIFIED";
  }): Promise<GmailMcpThread> {
    const result = await this.toolClient.callTool("get_thread", {
      threadId: input.threadId,
      messageFormat: input.messageFormat,
    });

    return toThread(result);
  }

  async labelThread(input: {
    threadId: string;
    labelIds: string[];
  }): Promise<{ success?: boolean }> {
    const result = await this.toolClient.callTool("label_thread", {
      threadId: input.threadId,
      labelIds: input.labelIds,
    });
    return isRecord(result)
      ? { success: booleanField(result, "success") ?? true }
      : { success: true };
  }
}

function gmailMcpProviderFromEnv(value: string | undefined): "google" | "workspace" {
  return value?.toLowerCase() === "workspace" ? "workspace" : "google";
}

function storedGoogleOAuthAccessToken(env: NodeJS.ProcessEnv): string | undefined {
  const tokenStorePath = env.GOOGLE_OAUTH_TOKEN_STORE_PATH ?? ".data/google-oauth-token.json";
  try {
    const token = JSON.parse(readFileSync(tokenStorePath, "utf8")) as {
      accessToken?: unknown;
      expiresAt?: unknown;
    };
    if (typeof token.accessToken !== "string") return undefined;
    if (typeof token.expiresAt === "string") {
      const expiresAtMs = Date.parse(token.expiresAt);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + 30_000) return undefined;
    }
    return token.accessToken;
  } catch {
    return undefined;
  }
}

function toDraft(value: unknown, fallbackSubject?: string): GmailMcpDraft {
  if (typeof value === "string") {
    return {
      id: draftIdFromText(value),
      subject: fallbackSubject,
    };
  }

  const record = asRecord(value);
  return {
    id: stringField(record, "id"),
    threadId: stringField(record, "threadId"),
    thread_id: stringField(record, "thread_id"),
    subject: stringField(record, "subject"),
  };
}

function draftIdFromText(value: string): string | undefined {
  const match = /\b(?:draft[_ -]?id|id)\b[^A-Za-z0-9_-]*([A-Za-z0-9_-]{6,})/i.exec(value);
  return match?.[1];
}

function toSentMessage(value: unknown): GmailMcpSentMessage {
  const record = asRecord(value);
  return {
    id: stringField(record, "id") ?? stringField(record, "message_id"),
    threadId: stringField(record, "threadId"),
    thread_id: stringField(record, "thread_id"),
  };
}

function toThread(value: unknown): GmailMcpThread {
  const record = asRecord(value);
  const id = stringField(record, "id");
  if (!id) {
    throw new Error("Gmail MCP thread result is missing id");
  }

  return {
    id,
    messages: arrayField(record, "messages").map(toMessage),
  };
}

function toMessage(value: unknown): GmailMcpMessage {
  return asRecord(value) as GmailMcpMessage;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Gmail MCP tool returned a non-object result");
  }
  return value;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
