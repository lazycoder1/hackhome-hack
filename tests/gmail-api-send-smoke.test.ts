import { runGmailApiSendSmoke } from "../src/integrations/gmail-api-send-smoke.js";
import type { EmailTool, SendEmailInput } from "../src/tools/types.js";

describe("runGmailApiSendSmoke", () => {
  it("blocks before sending when opt-in or recipient is missing", async () => {
    const sent: SendEmailInput[] = [];
    const report = await runGmailApiSendSmoke({
      env: {},
      email: fakeEmailTool(sent),
      now: () => new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(report).toEqual({
      status: "blocked",
      checkedAt: "2026-06-06T00:00:00.000Z",
      to: undefined,
      marker: "poc-pilot-gmail-api-send-smoke-20260606000000",
      checks: [
        {
          id: "required-env",
          name: "Required Gmail API send smoke environment",
          status: "blocked",
          message:
            "Missing required environment variable(s): GMAIL_API_SEND_SMOKE=1, GMAIL_API_SEND_SMOKE_TO",
        },
      ],
    });
    expect(sent).toEqual([]);
  });

  it("sends a marked Gmail API smoke email through the provided email tool", async () => {
    const sent: SendEmailInput[] = [];
    const report = await runGmailApiSendSmoke({
      env: {
        GMAIL_API_SEND_SMOKE: "1",
        GMAIL_API_SEND_SMOKE_TO: "buyer@example.test",
      },
      email: fakeEmailTool(sent),
      now: () => new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(report).toEqual({
      status: "pass",
      checkedAt: "2026-06-06T00:00:00.000Z",
      to: "buyer@example.test",
      marker: "poc-pilot-gmail-api-send-smoke-20260606000000",
      checks: [
        {
          id: "gmail-api-send",
          name: "Send Gmail API smoke email",
          status: "pass",
          message: "Gmail API send succeeded.",
          emailId: "msg_123",
          threadId: "thread_123",
        },
      ],
    });
    expect(sent).toEqual([
      {
        to: ["buyer@example.test"],
        subject: "PostHog PoC Gmail API send smoke poc-pilot-gmail-api-send-smoke-20260606000000",
        markdownBody: [
          "This is a guarded Gmail API direct-send smoke test from the PostHog PoC automation app.",
          "",
          "Marker: poc-pilot-gmail-api-send-smoke-20260606000000",
        ].join("\n"),
        tags: ["test:gmail-api-send", "delivery:send"],
      },
    ]);
  });

  it("fails when the Gmail API email tool rejects the send", async () => {
    const report = await runGmailApiSendSmoke({
      env: {
        GMAIL_API_SEND_SMOKE: "1",
        GMAIL_API_SEND_SMOKE_TO: "buyer@example.test",
      },
      email: {
        async sendEmail() {
          throw new Error("invalid_grant");
        },
      },
      now: () => new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(report).toMatchObject({
      status: "fail",
      checks: [
        {
          id: "gmail-api-send",
          name: "Send Gmail API smoke email",
          status: "fail",
          error: "invalid_grant",
        },
      ],
    });
  });

  it("requires an available token when asked to validate real Gmail API credentials", async () => {
    const report = await runGmailApiSendSmoke({
      env: {
        GMAIL_API_SEND_SMOKE: "1",
        GMAIL_API_SEND_SMOKE_TO: "buyer@example.test",
      },
      requireToken: true,
      tokenAvailable: false,
      email: fakeEmailTool([]),
    });

    expect(report.status).toBe("blocked");
    expect(report.checks[0]?.message).toContain(
      "GMAIL_API_ACCESS_TOKEN or connected Google OAuth token",
    );
  });

  it("requires a sender address when asked to validate real Gmail API send prerequisites", async () => {
    const report = await runGmailApiSendSmoke({
      env: {
        GMAIL_API_SEND_SMOKE: "1",
        GMAIL_API_SEND_SMOKE_TO: "buyer@example.test",
        GMAIL_API_ACCESS_TOKEN: "ya29.test",
      },
      requireToken: true,
      requireSender: true,
      senderAvailable: false,
      email: fakeEmailTool([]),
    });

    expect(report.status).toBe("blocked");
    expect(report.checks[0]?.message).toContain("EMAIL_FROM or connected Google OAuth email");
  });
});

function fakeEmailTool(sent: SendEmailInput[]): EmailTool {
  return {
    async sendEmail(input) {
      sent.push(input);
      return {
        emailId: "msg_123",
        threadId: "thread_123",
        sentAt: "2026-06-06T00:00:00.000Z",
      };
    },
  };
}
