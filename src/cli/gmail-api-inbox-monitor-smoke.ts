import { config as loadDotenv } from "dotenv";
import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import { GmailApiInboxGateway } from "../tools/gmail-api-inbox-gateway.js";
import { GmailInboxMonitor } from "../workflow/gmail-inbox-monitor.js";

loadDotenv();

const oauth = new GoogleOAuthTestService();
const accessToken = await oauth.freshAccessToken();
const status = oauth.status();
const query =
  process.argv.slice(2).join(" ").trim() ||
  process.env.GMAIL_API_INBOX_SMOKE_QUERY ||
  process.env.GMAIL_INBOX_QUERY ||
  "in:inbox newer_than:7d -in:draft";
const maxThreads = boundedMaxThreads(process.env.GMAIL_API_INBOX_SMOKE_MAX_THREADS ?? "3");
const pocId = process.env.GMAIL_API_INBOX_SMOKE_POC_ID ?? "poc_gmail_api_inbox_smoke";
const requireProcessed = process.env.GMAIL_API_INBOX_SMOKE_REQUIRE_PROCESSED === "1";
const processedMessages: {
  pocId: string;
  id: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
}[] = [];

if (!accessToken) {
  console.log(
    JSON.stringify(
      {
        status: "blocked",
        query,
        check: "google_oauth_token",
        message: "No connected Google OAuth token found. Open /settings and connect Gmail.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const monitor = new GmailInboxMonitor({
  gateway: new GmailApiInboxGateway({
    accessTokenProvider: () => accessToken,
  }),
  workflow: {
    async processEmailReply(input) {
      processedMessages.push({
        pocId: input.pocId,
        id: input.message.id,
        threadId: input.message.threadId,
        from: input.message.from,
        subject: input.message.subject,
        receivedAt: input.message.receivedAt,
      });
      return {
        intent: "unclear",
        completedApproval: false,
        requiresSetup: false,
        changes: [],
      };
    },
  },
});

try {
  const result = await monitor.monitor({
    query,
    maxThreads,
    pocId,
  });
  const blocked = requireProcessed && result.processedMessages === 0;
  console.log(
    JSON.stringify(
      {
        status: blocked ? "blocked" : "pass",
        mode: "dry_run",
        provider: "gmail_api",
        account: status.email,
        query,
        maxThreads,
        result,
        processedMessages,
        message: blocked ? "No processable Gmail messages matched the smoke query." : undefined,
      },
      null,
      2,
    ),
  );
  if (blocked) {
    process.exitCode = 1;
  }
} catch (error) {
  console.log(
    JSON.stringify(
      {
        status: "fail",
        mode: "dry_run",
        provider: "gmail_api",
        account: status.email,
        query,
        error: (error as Error).message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

function boundedMaxThreads(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 3;
}
