import { GmailRemoteMcpGateway } from "../src/tools/gmail-remote-mcp-gateway.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("GmailRemoteMcpGateway", () => {
  it("calls the official create_draft tool and maps the draft result", async () => {
    const calls: unknown[] = [];
    const gateway = new GmailRemoteMcpGateway({
      toolClient: fakeToolClient(calls, {
        id: "draft_123",
        threadId: "thread_123",
        subject: "Please confirm",
      }),
    });

    const result = await gateway.createDraft({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      subject: "Please confirm",
      body: "Approve?",
      htmlBody: "<p>Approve?</p>",
      replyToMessageId: "msg_123",
    });

    expect(result).toEqual({
      id: "draft_123",
      threadId: "thread_123",
      subject: "Please confirm",
    });
    expect(calls).toEqual([
      {
        name: "create_draft",
        args: {
          to: ["buyer@acme.test"],
          cc: ["champion@acme.test"],
          bcc: undefined,
          subject: "Please confirm",
          body: "Approve?",
          htmlBody: "<p>Approve?</p>",
          replyToMessageId: "msg_123",
        },
      },
    ]);
  });

  it("accepts plain text Gmail MCP create_draft success results", async () => {
    const gateway = new GmailRemoteMcpGateway({
      toolClient: fakeToolClient([], "Draft created successfully with id draft_123456"),
    });

    await expect(
      gateway.createDraft({
        to: ["buyer@acme.test"],
        subject: "Please confirm",
        body: "Approve?",
      }),
    ).resolves.toEqual({
      id: "draft_123456",
      subject: "Please confirm",
    });
  });

  it("calls Workspace MCP draft_gmail_message when configured for workspace provider", async () => {
    const calls: unknown[] = [];
    const gateway = new GmailRemoteMcpGateway({
      provider: "workspace",
      toolClient: fakeToolClient(calls, {
        id: "draft_123",
        thread_id: "thread_123",
        subject: "Please confirm",
      }),
    });

    const result = await gateway.createDraft({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      bcc: ["archive@acme.test"],
      subject: "Please confirm",
      body: "Approve?",
      htmlBody: "<p>Approve?</p>",
      replyToMessageId: "msg_123",
    });

    expect(result.thread_id).toBe("thread_123");
    expect(calls).toEqual([
      {
        name: "draft_gmail_message",
        args: {
          to: "buyer@acme.test",
          cc: "champion@acme.test",
          bcc: "archive@acme.test",
          subject: "Please confirm",
          body: "Approve?",
        },
      },
    ]);
  });

  it("calls Workspace MCP send_gmail_message for direct sends", async () => {
    const calls: unknown[] = [];
    const gateway = new GmailRemoteMcpGateway({
      provider: "workspace",
      toolClient: fakeToolClient(calls, {
        message_id: "msg_123",
        thread_id: "thread_123",
      }),
    });

    const result = await gateway.sendMessage({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      subject: "Handoff",
      body: "Ready.",
      replyToMessageId: "thread_existing",
    });

    expect(result).toEqual({ id: "msg_123", thread_id: "thread_123", threadId: undefined });
    expect(calls).toEqual([
      {
        name: "send_gmail_message",
        args: {
          to: "buyer@acme.test",
          cc: "champion@acme.test",
          bcc: undefined,
          subject: "Handoff",
          body: "Ready.",
          body_format: "plain",
          thread_id: "thread_existing",
        },
      },
    ]);
  });

  it("calls search_threads with Gmail query arguments", async () => {
    const calls: unknown[] = [];
    const gateway = new GmailRemoteMcpGateway({
      toolClient: fakeToolClient(calls, {
        threads: [{ id: "thread_123", messages: [] }],
        nextPageToken: "next-token",
      }),
    });

    const result = await gateway.searchThreads({
      query: "in:inbox newer_than:7d -in:draft",
      pageSize: 10,
      pageToken: "page-token",
    });

    expect(result.threads).toHaveLength(1);
    expect(result.nextPageToken).toBe("next-token");
    expect(calls).toEqual([
      {
        name: "search_threads",
        args: {
          query: "in:inbox newer_than:7d -in:draft",
          pageSize: 10,
          pageToken: "page-token",
          includeTrash: undefined,
        },
      },
    ]);
  });

  it("fetches full-content threads and labels processed threads", async () => {
    const calls: unknown[] = [];
    const gateway = new GmailRemoteMcpGateway({
      toolClient: fakeToolClient(calls, { id: "thread_123", messages: [] }),
    });

    await gateway.getThread({ threadId: "thread_123", messageFormat: "FULL_CONTENT" });
    await gateway.labelThread({ threadId: "thread_123", labelIds: ["Label_123"] });

    expect(calls).toEqual([
      {
        name: "get_thread",
        args: {
          threadId: "thread_123",
          messageFormat: "FULL_CONTENT",
        },
      },
      {
        name: "label_thread",
        args: {
          threadId: "thread_123",
          labelIds: ["Label_123"],
        },
      },
    ]);
  });
});

function fakeToolClient(calls: unknown[], result: unknown): McpToolClient {
  return {
    async callTool(name, args) {
      calls.push({ name, args });
      return result;
    },
  };
}
