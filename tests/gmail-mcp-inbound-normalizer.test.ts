import { normalizeGmailMcpInboundEmail } from "../src/tools/gmail-mcp-inbound-normalizer.js";

describe("normalizeGmailMcpInboundEmail", () => {
  it("maps a Gmail MCP read email result to a canonical inbound email", () => {
    const result = normalizeGmailMcpInboundEmail({
      pocId: "poc_123",
      email: {
        id: "msg_123",
        thread_id: "thread_123",
        from: "Buyer <buyer@acme.test>",
        to: "PoC <poc@example.test>",
        subject: "Re: Please confirm",
        body: "Approved",
        timestamp: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      pocId: "poc_123",
      message: {
        id: "msg_123",
        threadId: "thread_123",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: Please confirm",
        textBody: "Approved",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });
  });

  it("can derive the PoC id from a Gmail MCP recipient local part", () => {
    const result = normalizeGmailMcpInboundEmail({
      email: {
        id: "msg_123",
        thread_id: "thread_123",
        from: "buyer@acme.test",
        to: ["poc_123@inbound.example.test"],
        subject: "Approved",
        snippet: "Approved",
      },
    });

    expect(result.pocId).toBe("poc_123");
    expect(result.message.textBody).toBe("Approved");
  });

  it("maps official Gmail MCP message fields from get_thread", () => {
    const result = normalizeGmailMcpInboundEmail({
      email: {
        id: "msg_456",
        threadId: "thread_456",
        sender: "buyer@acme.test",
        toRecipients: ["poc_456@inbound.example.test"],
        ccRecipients: ["champion@acme.test"],
        subject: "Re: PostHog PoC",
        plaintextBody: "Looks good. Approved.",
        date: "2026-06-04T00:10:00Z",
      },
    });

    expect(result).toEqual({
      pocId: "poc_456",
      message: {
        id: "msg_456",
        threadId: "thread_456",
        from: "buyer@acme.test",
        to: ["poc_456@inbound.example.test"],
        subject: "Re: PostHog PoC",
        textBody: "Looks good. Approved.",
        receivedAt: "2026-06-04T00:10:00.000Z",
      },
    });
  });
});
