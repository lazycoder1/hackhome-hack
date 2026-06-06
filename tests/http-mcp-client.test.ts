import { HttpMcpToolClient } from "../src/mcp/http-mcp-tool-client.js";

describe("HttpMcpToolClient", () => {
  it("initializes a session and calls MCP tools with auth and PostHog pinning headers", async () => {
    const requests: unknown[] = [];
    const client = new HttpMcpToolClient({
      endpoint: "https://mcp.posthog.com/mcp?tools=project-get",
      apiKey: "phx_test",
      organizationId: "org-1",
      projectId: "project-1",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} },
            }),
            { status: 200, headers: { "mcp-session-id": "session-1" } },
          );
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await client.callTool("project-get", { projectId: "project-1" });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(3);
    const request = requests[2] as { url: string; init: RequestInit };
    expect(request.url).toBe("https://mcp.posthog.com/mcp?tools=project-get");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      accept: "application/json, text/event-stream",
      authorization: "Bearer phx_test",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": "session-1",
      "x-posthog-organization-id": "org-1",
      "x-posthog-project-id": "project-1",
    });
    expect(JSON.parse(String(request.init.body))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "project-get",
        arguments: { projectId: "project-1" },
      },
    });
  });

  it("raises JSON-RPC errors", async () => {
    const client = new HttpMcpToolClient({
      endpoint: "https://mcp.posthog.com/mcp",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
            headers: { "mcp-session-id": "session-1" },
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "Tool not found" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(client.callTool("missing-tool", {})).rejects.toThrow(/Tool not found/);
  });

  it("raises MCP tool-level error results", async () => {
    const client = new HttpMcpToolClient({
      endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "Missing Gmail scope" }],
              isError: true,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(client.callTool("create_draft", {})).rejects.toThrow(/Missing Gmail scope/);
  });

  it("uses a dynamic API key provider for MCP auth headers", async () => {
    const authHeaders: string[] = [];
    const client = new HttpMcpToolClient({
      endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      apiKey: "stale-token",
      apiKeyProvider: () => "fresh-token",
      fetchImpl: async (_url, init) => {
        authHeaders.push(String((init?.headers as Record<string, string>).authorization));
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
        });
      },
    });

    await client.callTool("draft_gmail_message", {});

    expect(authHeaders).toEqual(["Bearer fresh-token", "Bearer fresh-token", "Bearer fresh-token"]);
  });

  it("sends configured extra headers with MCP requests", async () => {
    const requests: RequestInit[] = [];
    const client = new HttpMcpToolClient({
      endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      extraHeaders: {
        "x-goog-user-project": "999302008289",
      },
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
        });
      },
    });

    await client.callTool("create_draft", {});

    expect(requests[0].headers).toMatchObject({
      "x-goog-user-project": "999302008289",
    });
    expect(requests[2].headers).toMatchObject({
      "x-goog-user-project": "999302008289",
    });
  });

  it("parses JSON-RPC responses returned as server-sent events", async () => {
    const client = new HttpMcpToolClient({
      endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === "initialize") {
          return new Response(
            ["event: message", `data: {"jsonrpc":"2.0","id":${body.id},"result":{}}`, ""].join(
              "\n",
            ),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        return new Response(
          [
            "event: message",
            `data: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}}`,
            "",
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    await expect(client.callTool("create_draft", {})).resolves.toEqual({ ok: true });
  });

  it("fails fast when an MCP request times out", async () => {
    const client = new HttpMcpToolClient({
      endpoint: "https://mcp.posthog.com/mcp",
      timeoutMs: 1,
      fetchImpl: async (_url, init) => {
        await new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          setTimeout(resolve, 100);
        });
        return new Response("{}", { status: 200 });
      },
    });

    await expect(client.callTool("project-get", {})).rejects.toThrow(/MCP initialize timed out/);
  });
});
