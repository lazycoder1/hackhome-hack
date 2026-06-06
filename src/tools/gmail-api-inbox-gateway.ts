import type {
  GmailCreateDraftInput,
  GmailMcpDraft,
  GmailMcpGateway,
  GmailMcpMessage,
  GmailMcpThread,
} from "./gmail-mcp-email-tool.js";

const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com";
const DEFAULT_GMAIL_USER_ID = "me";

export type GmailApiInboxGatewayOptions = {
  accessToken?: string;
  accessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  userId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

type GmailMessageListResponse = {
  messages?: { id?: string; threadId?: string }[];
  nextPageToken?: string;
};

type GmailThreadResponse = {
  id?: string;
  messages?: GmailApiMessage[];
};

type GmailApiMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiMessagePart;
};

type GmailApiMessagePart = {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: GmailApiMessagePart[];
};

export class GmailApiInboxGateway implements GmailMcpGateway {
  private readonly accessToken?: string;
  private readonly accessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  private readonly userId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GmailApiInboxGatewayOptions = {}) {
    const env = options.env ?? process.env;
    this.accessToken =
      options.accessToken ?? env.GMAIL_API_ACCESS_TOKEN ?? env.GMAIL_MCP_ACCESS_TOKEN;
    this.accessTokenProvider = options.accessTokenProvider;
    this.userId = options.userId ?? env.GMAIL_API_USER_ID ?? DEFAULT_GMAIL_USER_ID;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? env.GMAIL_API_BASE_URL ?? DEFAULT_GMAIL_API_BASE_URL,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createDraft(_input: GmailCreateDraftInput): Promise<GmailMcpDraft> {
    throw new Error("GmailApiInboxGateway only supports inbox read operations");
  }

  async searchThreads(input: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrash?: boolean;
  }): Promise<{ threads: GmailMcpThread[]; nextPageToken?: string; next_page_token?: string }> {
    const url = new URL(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/messages`,
    );
    if (input.query) url.searchParams.set("q", input.query);
    if (input.pageSize) url.searchParams.set("maxResults", String(input.pageSize));
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
    if (input.includeTrash) url.searchParams.set("includeSpamTrash", "true");

    const result = (await this.getJson(url)) as GmailMessageListResponse;
    const seen = new Set<string>();
    const threads = (result.messages ?? []).flatMap((message) => {
      const id = message.threadId;
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, messages: [] }];
    });

    return {
      threads,
      nextPageToken: result.nextPageToken,
      next_page_token: result.nextPageToken,
    };
  }

  async getThread(input: {
    threadId: string;
    messageFormat?: "FULL_CONTENT" | "MINIMAL" | "MESSAGE_FORMAT_UNSPECIFIED";
  }): Promise<GmailMcpThread> {
    const url = new URL(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/threads/${encodeURIComponent(
        input.threadId,
      )}`,
    );
    url.searchParams.set(
      "format",
      input.messageFormat === "MINIMAL" || input.messageFormat === "MESSAGE_FORMAT_UNSPECIFIED"
        ? "metadata"
        : "full",
    );

    const result = (await this.getJson(url)) as GmailThreadResponse;
    return {
      id: result.id ?? input.threadId,
      messages: (result.messages ?? []).map(toMcpMessage),
    };
  }

  async labelThread(input: {
    threadId: string;
    labelIds: string[];
  }): Promise<{ success?: boolean }> {
    const url = new URL(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/threads/${encodeURIComponent(
        input.threadId,
      )}/modify`,
    );
    await this.fetchJson(url, {
      method: "POST",
      body: JSON.stringify({
        addLabelIds: input.labelIds,
      }),
    });
    return { success: true };
  }

  private async getJson(url: URL): Promise<unknown> {
    return await this.fetchJson(url, { method: "GET" });
  }

  private async fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    const accessToken = (await this.accessTokenProvider?.()) ?? this.accessToken;
    if (!accessToken) {
      throw new Error("GMAIL_API_ACCESS_TOKEN is required for Gmail API inbox access");
    }

    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Gmail API inbox request failed with ${response.status}: ${await response.text()}`,
      );
    }
    if (response.status === 204) return {};
    return await response.json();
  }
}

function toMcpMessage(message: GmailApiMessage): GmailMcpMessage {
  const headers = message.payload?.headers ?? [];
  const date = header(headers, "date") ?? internalDate(message.internalDate);
  const to = header(headers, "to") ?? "";
  const cc = header(headers, "cc");

  return {
    id: message.id,
    threadId: message.threadId,
    thread_id: message.threadId,
    snippet: message.snippet,
    subject: header(headers, "subject"),
    from: header(headers, "from"),
    sender: header(headers, "from"),
    to,
    toRecipients: splitRecipients(to),
    ccRecipients: cc ? splitRecipients(cc) : undefined,
    date,
    plaintextBody: textBody(message.payload) ?? message.snippet,
  };
}

function header(headers: { name?: string; value?: string }[], name: string): string | undefined {
  return headers.find((item) => item.name?.toLowerCase() === name)?.value;
}

function textBody(part: GmailApiMessagePart | undefined): string | undefined {
  if (!part) return undefined;
  const plain = findPartBody(part, "text/plain");
  if (plain) return plain;
  const html = findPartBody(part, "text/html");
  if (html) return html;
  return part.body?.data ? decodeBase64Url(part.body.data) : undefined;
}

function findPartBody(part: GmailApiMessagePart, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const value = findPartBody(child, mimeType);
    if (value) return value;
  }
  return undefined;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, "base64").toString("utf8");
}

function splitRecipients(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function internalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const millis = Number(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
