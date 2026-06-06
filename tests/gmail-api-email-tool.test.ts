import { GmailApiEmailTool } from "../src/tools/gmail-api-email-tool.js";

describe("GmailApiEmailTool", () => {
  it("sends an RFC 2822 MIME message through Gmail users.messages.send", async () => {
    const requests: unknown[] = [];
    const tool = new GmailApiEmailTool({
      accessToken: "ya29.test",
      from: "PoC Team <poc@example.test>",
      clock: () => new Date("2026-06-05T10:00:00.000Z"),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "msg_123", threadId: "thread_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await tool.sendEmail({
      to: ["buyer@acme.test"],
      cc: ["champion@acme.test"],
      bcc: ["archive@acme.test"],
      subject: "Your PostHog PoC is ready",
      markdownBody: "Testing plan attached in the email body.",
      threadId: "thread_existing",
      tags: ["poc:poc_123", "product:posthog"],
    });

    expect(result).toEqual({
      emailId: "msg_123",
      threadId: "thread_123",
      sentAt: "2026-06-05T10:00:00.000Z",
    });
    expect(requests).toHaveLength(1);

    const request = requests[0] as { url: string; init: RequestInit };
    expect(request.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      accept: "application/json",
      authorization: "Bearer ya29.test",
      "content-type": "application/json",
    });

    const body = JSON.parse(String(request.init.body)) as { raw: string; threadId: string };
    expect(body.threadId).toBe("thread_existing");
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("From: PoC Team <poc@example.test>");
    expect(decoded).toContain("To: buyer@acme.test");
    expect(decoded).toContain("Cc: champion@acme.test");
    expect(decoded).toContain("Bcc: archive@acme.test");
    expect(decoded).toContain("Subject: Your PostHog PoC is ready");
    expect(decoded).toContain("Date: Fri, 05 Jun 2026 10:00:00 GMT");
    expect(decoded).toContain("Content-Type: multipart/alternative;");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
    expect(decoded).toContain(
      "Testing plan attached in the email body.\r\n\r\n---\r\nTags: poc:poc_123, product:posthog",
    );
    expect(decoded).toContain("<p>Testing plan attached in the email body.</p>");
  });

  it("requires a Gmail API access token", async () => {
    const tool = new GmailApiEmailTool({
      from: "poc@example.test",
    });

    await expect(
      tool.sendEmail({
        to: ["buyer@acme.test"],
        subject: "Subject",
        markdownBody: "Body",
      }),
    ).rejects.toThrow(/GMAIL_API_ACCESS_TOKEN/);
  });

  it("uses a dynamic access token provider when one is available", async () => {
    const requests: unknown[] = [];
    const tool = new GmailApiEmailTool({
      accessToken: "stale-token",
      accessTokenProvider: () => "fresh-token",
      from: "poc@example.test",
      fetchImpl: async (_url, init) => {
        requests.push(init);
        return new Response(JSON.stringify({ id: "msg_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await tool.sendEmail({
      to: ["buyer@acme.test"],
      subject: "Subject",
      markdownBody: "Body",
    });

    expect((requests[0] as RequestInit).headers).toMatchObject({
      authorization: "Bearer fresh-token",
    });
  });

  it("creates Gmail API drafts without sending them", async () => {
    const requests: unknown[] = [];
    const tool = new GmailApiEmailTool({
      accessToken: "ya29.test",
      from: "PoC Team <poc@example.test>",
      clock: () => new Date("2026-06-05T10:00:00.000Z"),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            id: "draft_123",
            message: { id: "msg_123", threadId: "thread_123" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const result = await tool.createDraft({
      to: ["buyer@acme.test"],
      subject: "Draft subject",
      markdownBody: "Draft body",
    });

    expect(result).toEqual({
      emailId: "draft_123",
      threadId: "thread_123",
      sentAt: "2026-06-05T10:00:00.000Z",
    });
    expect(requests).toHaveLength(1);
    const request = requests[0] as { url: string; init: RequestInit };
    expect(request.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      authorization: "Bearer ya29.test",
    });
  });

  it("raises Gmail API send failures", async () => {
    const tool = new GmailApiEmailTool({
      accessToken: "ya29.test",
      from: "poc@example.test",
      fetchImpl: async () => new Response("invalid grant", { status: 401 }),
    });

    await expect(
      tool.sendEmail({
        to: ["buyer@acme.test"],
        subject: "Subject",
        markdownBody: "Body",
      }),
    ).rejects.toThrow(/Gmail API send failed with 401: invalid grant/);
  });

  it("rejects attachments because the PoC sender only builds text MIME messages", async () => {
    const tool = new GmailApiEmailTool({
      accessToken: "ya29.test",
      from: "poc@example.test",
    });

    await expect(
      tool.sendEmail({
        to: ["buyer@acme.test"],
        subject: "Subject",
        markdownBody: "Body",
        attachments: [
          {
            filename: "plan.pdf",
            contentType: "application/pdf",
            storageRef: "file:plan.pdf",
          },
        ],
      }),
    ).rejects.toThrow(/attachments are not supported/);
  });
});

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, "base64").toString("utf8");
}
