import { config as loadDotenv } from "dotenv";
import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import { runGmailApiSendSmoke } from "../integrations/gmail-api-send-smoke.js";
import { GmailApiEmailTool } from "../tools/gmail-api-email-tool.js";

loadDotenv();

const oauth = new GoogleOAuthTestService();
const accessToken = await oauth.freshAccessToken();
const status = oauth.status();
const to = process.argv[2] ?? process.env.GMAIL_API_SEND_SMOKE_TO;

const report = await runGmailApiSendSmoke({
  to,
  requireToken: true,
  tokenAvailable: Boolean(accessToken),
  requireSender: true,
  senderAvailable: Boolean(status.email),
  email: new GmailApiEmailTool({
    accessTokenProvider: () => accessToken,
    fromProvider: () => status.email,
  }),
});

console.log(JSON.stringify(report, null, 2));

if (report.status !== "pass") {
  process.exitCode = 1;
}
