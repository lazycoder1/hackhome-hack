import type {
  GmailCreateDraftInput,
  GmailMcpDraft,
  GmailMcpGateway,
  GmailMcpMessage,
  GmailMcpSentMessage,
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

type GmailListResponse = {
  messages?: { id?: string; threadId?: string }[];
  nextPageToken?: string;
};

type GmailThreadResponse = {
  id?: string;
  messages?: GmailMessageResponse[];
};

type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayload;
};

type GmailPayload = {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: GmailPayload[];
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

  async sendMessage(_input: GmailCreateDraftInput): Promise<GmailMcpSentMessage> {
    throw new Error("GmailApiInboxGateway only supports inbox read operations");
  }

  async searchThreads(input: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
    includeTrash?: boolean;
  }): Promise<{ threads: GmailMcpThread[]; nextPageToken?: string; next_page_token?: string }> {
    const url = this.gmailUrl("messages");
    if (input.query) url.searchParams.set("q", input.query);
    if (input.pageSize) url.searchParams.set("maxResults", String(input.pageSize));
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
    if (input.includeTrash) url.searchParams.set("includeSpamTrash", "true");

    const body = await this.requestJson<GmailListResponse>(url);
    const seen = new Set<string>();
    const threads = (body.messages ?? []).flatMap((message) => {
      const id = message.threadId ?? message.id;
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, messages: [] }];
    });

    return {
      threads,
      nextPageToken: body.nextPageToken,
      next_page_token: body.nextPageToken,
    };
  }

  async getThread(input: {
    threadId: string;
    messageFormat?: "FULL_CONTENT" | "MINIMAL" | "MESSAGE_FORMAT_UNSPECIFIED";
  }): Promise<GmailMcpThread> {
    const url = this.gmailUrl(`threads/${input.threadId}`);
    url.searchParams.set("format", input.messageFormat === "MINIMAL" ? "minimal" : "full");

    const body = await this.requestJson<GmailThreadResponse>(url);
    return {
      id: body.id ?? input.threadId,
      messages: (body.messages ?? []).map(toGmailMcpMessage),
    };
  }

  async labelThread(input: {
    threadId: string;
    labelIds: string[];
  }): Promise<{ success?: boolean }> {
    await this.requestJson(this.gmailUrl(`threads/${input.threadId}/modify`), {
      method: "POST",
      body: JSON.stringify({ addLabelIds: input.labelIds }),
    });
    return { success: true };
  }

  private gmailUrl(path: string): URL {
    return new URL(
      `${this.baseUrl}/gmail/v1/users/${encodeURIComponent(this.userId)}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    );
  }

  private async requestJson<T>(url: URL, init: RequestInit = {}): Promise<T> {
    const accessToken = (await this.accessTokenProvider?.()) ?? this.accessToken;
    if (!accessToken) {
      throw new Error("GMAIL_API_ACCESS_TOKEN is required for Gmail API inbox reads");
    }

    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Gmail API inbox request failed with ${response.status}: ${await response.text()}`,
      );
    }
    return (await response.json()) as T;
  }
}

function toGmailMcpMessage(message: GmailMessageResponse): GmailMcpMessage {
  const payload = message.payload;
  const from = header(payload, "From");
  const to = header(payload, "To");
  const cc = header(payload, "Cc");
  const subject = header(payload, "Subject");
  const date = header(payload, "Date") ?? internalDate(message.internalDate);

  return withoutUndefined({
    id: message.id,
    threadId: message.threadId,
    thread_id: message.threadId,
    from,
    sender: from,
    to,
    toRecipients: recipients(to),
    ccRecipients: recipients(cc),
    subject,
    plaintextBody: plainText(payload) ?? message.snippet,
    snippet: message.snippet,
    date,
  });
}

function header(payload: GmailPayload | undefined, name: string): string | undefined {
  return payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value;
}

function recipients(value: string | undefined): string[] | undefined {
  const parts = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts?.length ? parts : undefined;
}

function plainText(payload: GmailPayload | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType?.toLowerCase().startsWith("text/plain") && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const text = plainText(part);
    if (text) return text;
  }
  return payload.body?.data ? decodeBase64Url(payload.body.data) : undefined;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, "base64").toString("utf8");
}

function internalDate(value: string | undefined): string | undefined {
  const millis = Number(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function withoutUndefined(input: Record<string, unknown>): GmailMcpMessage {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
