import { GmailMcpEmailTool } from "../src/tools/gmail-mcp-email-tool.js";
import type { GmailMcpGateway } from "../src/tools/gmail-mcp-email-tool.js";

describe("GmailMcpEmailTool", () => {
  it("creates Gmail drafts through the official Gmail MCP gateway", async () => {
    const calls: unknown[] = [];
    const gateway: GmailMcpGateway = {
      async createDraft(input) {
        calls.push(input);
        return {
          id: "draft_123",
          threadId: "thread_123",
        };
      },
      async searchThreads() {
        return { threads: [] };
      },
      async getThread() {
        return { id: "thread_123", messages: [] };
      },
    };
    const tool = new GmailMcpEmailTool({
      gateway,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const result = await tool.sendEmail({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      subject: "Please confirm",
      markdownBody: "# Confirm\n\nApprove?",
      tags: ["poc:poc_123", "product:posthog"],
      threadId: "reply_msg_123",
    });

    expect(result).toEqual({
      emailId: "draft_123",
      threadId: "thread_123",
      sentAt: "2026-06-04T00:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      bcc: undefined,
      subject: "Please confirm",
      body: "# Confirm\n\nApprove?\n\n---\nTags: poc:poc_123, product:posthog",
      replyToMessageId: "reply_msg_123",
    });
    expect((calls[0] as { htmlBody?: string }).htmlBody).toContain("<h1>Confirm</h1>");
    expect((calls[0] as { htmlBody?: string }).htmlBody).toContain("<p>Approve?</p>");
  });

  it("raises Gmail MCP draft failures", async () => {
    const gateway: GmailMcpGateway = {
      async createDraft() {
        throw new Error("Gmail MCP draft failed");
      },
      async searchThreads() {
        return { threads: [] };
      },
      async getThread() {
        return { id: "thread_123", messages: [] };
      },
    };
    const tool = new GmailMcpEmailTool({ gateway });

    await expect(
      tool.sendEmail({
        to: ["buyer@acme.test"],
        subject: "Please confirm",
        markdownBody: "Approve?",
      }),
    ).rejects.toThrow(/Gmail MCP draft failed/);
  });

  it("sends through the gateway only when direct-send delivery mode is enabled", async () => {
    const calls: unknown[] = [];
    const gateway: GmailMcpGateway = {
      async createDraft() {
        throw new Error("draft path should not be used");
      },
      async sendMessage(input) {
        calls.push(input);
        return { id: "msg_123", thread_id: "thread_123" };
      },
      async searchThreads() {
        return { threads: [] };
      },
      async getThread() {
        return { id: "thread_123", messages: [] };
      },
    };
    const tool = new GmailMcpEmailTool({
      gateway,
      deliveryMode: "send",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const result = await tool.sendEmail({
      to: ["Buyer <buyer@acme.test>"],
      subject: "Handoff",
      markdownBody: "Ready.",
    });

    expect(result).toEqual({
      emailId: "msg_123",
      threadId: "thread_123",
      sentAt: "2026-06-04T00:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: ["buyer@acme.test"],
      cc: undefined,
      bcc: undefined,
      subject: "Handoff",
      body: "Ready.",
      replyToMessageId: undefined,
    });
    expect((calls[0] as { htmlBody?: string }).htmlBody).toContain("<p>Ready.</p>");
  });
});
