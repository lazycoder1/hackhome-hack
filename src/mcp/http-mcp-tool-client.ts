import type { McpToolClient } from "./types.js";

type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type HttpMcpToolClientOptions = {
  endpoint: string;
  apiKey?: string;
  apiKeyProvider?: () => string | undefined | Promise<string | undefined>;
  organizationId?: string;
  projectId?: string;
  extraHeaders?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class HttpMcpToolClient implements McpToolClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly apiKeyProvider?: () => string | undefined | Promise<string | undefined>;
  private readonly organizationId?: string;
  private readonly projectId?: string;
  private readonly extraHeaders: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private sessionIdPromise?: Promise<string | undefined>;
  private nextId = 1;

  constructor(options: HttpMcpToolClientOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.apiKeyProvider = options.apiKeyProvider;
    this.organizationId = options.organizationId;
    this.projectId = options.projectId;
    this.extraHeaders = options.extraHeaders ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MCP_TIMEOUT_MS ?? 30000);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const sessionId = await this.ensureSession();
    const id = this.nextId++;
    const response = await this.fetchJsonRpc(`${name} tool call`, {
      method: "POST",
      headers: await this.headers(sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP request failed with ${response.status}: ${await response.text()}`);
    }

    const body = parseJsonRpcResponse(await response.text());
    if (body.error) {
      throw new Error(`MCP tool ${name} failed: ${body.error.message}`);
    }

    return unwrapMcpResult(body.result);
  }

  private async ensureSession(): Promise<string | undefined> {
    this.sessionIdPromise ??= this.initializeSession().catch((error) => {
      this.sessionIdPromise = undefined;
      throw error;
    });
    return this.sessionIdPromise;
  }

  private async initializeSession(): Promise<string | undefined> {
    const id = this.nextId++;
    const response = await this.fetchJsonRpc("initialize", {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "posthog-poc-automation",
            version: "0.1.0",
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `MCP initialize request failed with ${response.status}: ${await response.text()}`,
      );
    }

    const body = parseJsonRpcResponse(await response.text());
    if (body.error) {
      throw new Error(`MCP initialize failed: ${body.error.message}`);
    }

    const sessionId = response.headers.get("mcp-session-id") ?? undefined;
    await this.sendInitializedNotification(sessionId);
    return sessionId;
  }

  private async sendInitializedNotification(sessionId: string | undefined): Promise<void> {
    const response = await this.fetchJsonRpc("initialized notification", {
      method: "POST",
      headers: await this.headers(sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    });

    if (!response.ok) {
      throw new Error(
        `MCP initialized notification failed with ${response.status}: ${await response.text()}`,
      );
    }
  }

  private async headers(sessionId?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    };

    const apiKey = (await this.apiKeyProvider?.()) ?? this.apiKey;
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    if (this.organizationId) {
      headers["x-posthog-organization-id"] = this.organizationId;
    }
    if (this.projectId) {
      headers["x-posthog-project-id"] = this.projectId;
    }
    for (const [key, value] of Object.entries(this.extraHeaders)) {
      if (value) {
        headers[key] = value;
      }
    }

    return headers;
  }

  private async fetchJsonRpc(label: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(this.endpoint, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError" || (error as Error).name === "AbortError") {
        throw new Error(`MCP ${label} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }
}

function parseJsonRpcResponse(raw: string): JsonRpcResponse {
  try {
    return JSON.parse(raw) as JsonRpcResponse;
  } catch {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .find((line) => line.length > 0 && line !== "[DONE]");

    if (!data) {
      throw new Error("MCP HTTP response was neither JSON nor a JSON server-sent event");
    }

    return JSON.parse(data) as JsonRpcResponse;
  }
}

function unwrapMcpResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }

  const toolText = firstTextContent(result);
  if (result.isError === true) {
    throw new Error(typeof toolText === "string" ? toolText : "MCP tool returned an error result");
  }

  const content = result.content;
  if (!Array.isArray(content)) {
    return result;
  }

  if (typeof toolText !== "string") {
    return result;
  }

  try {
    return JSON.parse(toolText);
  } catch {
    return toolText;
  }
}

function firstTextContent(result: Record<string, unknown>): string | undefined {
  const content = result.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const firstText = content.find(
    (item) => isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  return isRecord(firstText) && typeof firstText.text === "string" ? firstText.text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
