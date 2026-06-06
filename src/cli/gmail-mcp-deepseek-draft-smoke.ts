import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import { DeepSeekClient } from "../llm/deepseek-client.js";
import { GmailRemoteMcpGateway } from "../tools/gmail-remote-mcp-gateway.js";

const DEFAULT_TO = "gautamgsabhahit@gmail.com";

const draftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

type GmailListResponse = {
  messages?: { id?: string; threadId?: string }[];
};

type GmailMessageResponse = {
  id?: string;
  threadId?: string;
  payload?: {
    headers?: { name?: string; value?: string }[];
  };
};

async function main() {
  loadDotenv();

  const to = process.argv[2] ?? process.env.GMAIL_MCP_SMOKE_TO ?? DEFAULT_TO;
  const marker = `poc-pilot-mcp-smoke-${Date.now()}`;
  const config = loadConfig();
  const oauth = new GoogleOAuthTestService();
  const accessToken = oauth.accessToken();
  const status = oauth.status();

  if (!accessToken) {
    throw new Error(
      "No connected Google OAuth token found. Open /settings, connect Gmail, then rerun this script.",
    );
  }

  console.log(
    JSON.stringify(
      {
        step: "oauth_status",
        email: status.email,
        expiresAt: status.expiresAt,
        storage: status.storage,
        scopes: status.scopes,
      },
      null,
      2,
    ),
  );

  const llm = new DeepSeekClient({
    apiKey: config.deepseek.apiKey,
    baseUrl: config.deepseek.baseUrl,
  });
  const draft = draftSchema.parse(
    await llm.completeJson({
      model: config.deepseek.models.pro,
      temperature: 0,
      system:
        "You create concise Gmail draft smoke-test messages. Return only JSON with subject and body.",
      user: [
        `Create a short test draft to ${to}.`,
        `The subject must include this exact marker: ${marker}`,
        "The body should state that DeepSeek generated the text and Gmail MCP created the draft.",
      ].join("\n"),
    }),
  );

  const subject = draft.subject.includes(marker)
    ? draft.subject
    : `${draft.subject} ${marker}`.trim();
  const body = `${draft.body}\n\nMarker: ${marker}`;

  console.log(
    JSON.stringify(
      {
        step: "deepseek_draft_payload",
        model: config.deepseek.models.pro,
        to,
        subject,
      },
      null,
      2,
    ),
  );

  const gateway = new GmailRemoteMcpGateway({
    provider: "google",
    env: process.env,
    accessTokenProvider: () => accessToken,
  });

  let transport = "gmail_mcp";
  try {
    const mcpDraft = await gateway.createDraft({
      to: [to],
      subject,
      body,
    });

    console.log(
      JSON.stringify(
        {
          step: "gmail_mcp_create_draft",
          draft: mcpDraft,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    transport = "gmail_api_fallback";
    console.log(
      JSON.stringify(
        {
          step: "gmail_mcp_create_draft_failed",
          message: (error as Error).message,
        },
        null,
        2,
      ),
    );
    const apiDraft = await createDraftViaGmailApi({
      accessToken,
      from: status.email,
      to,
      subject,
      body,
    });
    console.log(
      JSON.stringify(
        {
          step: "gmail_api_fallback_create_draft",
          draft: apiDraft,
        },
        null,
        2,
      ),
    );
  }

  const verified = await findDraftViaGmailApi({
    accessToken,
    to,
    marker,
  });

  if (!verified) {
    throw new Error(
      `Gmail MCP returned success, but no matching Gmail draft was found for marker ${marker}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        step: "verified_gmail_draft",
        transport,
        message: verified,
      },
      null,
      2,
    ),
  );
}

async function createDraftViaGmailApi(input: {
  accessToken: string;
  from?: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{
  id?: string;
  messageId?: string;
  threadId?: string;
}> {
  if (!input.from) {
    throw new Error("Connected Google account email is required for Gmail API draft fallback");
  }

  const raw = encodeBase64Url(
    [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${safeHeaderValue(input.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body.replace(/\r?\n/g, "\r\n"),
    ].join("\r\n"),
  );

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Gmail API draft fallback failed with ${response.status}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    id?: string;
    message?: {
      id?: string;
      threadId?: string;
    };
  };
  return {
    id: body.id,
    messageId: body.message?.id,
    threadId: body.message?.threadId,
  };
}

async function findDraftViaGmailApi(input: {
  accessToken: string;
  to: string;
  marker: string;
}): Promise<
  | {
      id: string;
      threadId?: string;
      subject?: string;
      to?: string;
    }
  | undefined
> {
  const query = `in:drafts to:${input.to} ${input.marker}`;
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", "10");

  const listResponse = await fetch(listUrl, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
    },
  });
  if (!listResponse.ok) {
    throw new Error(
      `Gmail API draft verification failed with ${listResponse.status}: ${await listResponse.text()}`,
    );
  }

  const listBody = (await listResponse.json()) as GmailListResponse;
  const first = listBody.messages?.find((message) => message.id);
  if (!first?.id) {
    return undefined;
  }

  const getUrl = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(first.id)}`,
  );
  getUrl.searchParams.set("format", "metadata");
  getUrl.searchParams.append("metadataHeaders", "Subject");
  getUrl.searchParams.append("metadataHeaders", "To");

  const getResponse = await fetch(getUrl, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
    },
  });
  if (!getResponse.ok) {
    throw new Error(
      `Gmail API draft metadata read failed with ${getResponse.status}: ${await getResponse.text()}`,
    );
  }

  const message = (await getResponse.json()) as GmailMessageResponse;
  const headers = new Map(
    (message.payload?.headers ?? [])
      .filter((header) => header.name && header.value)
      .map((header) => [header.name!.toLowerCase(), header.value!]),
  );

  return {
    id: message.id ?? first.id,
    threadId: message.threadId ?? first.threadId,
    subject: headers.get("subject"),
    to: headers.get("to"),
  };
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeHeaderValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Email header values must not contain line breaks");
  }
  return value;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        step: "failed",
        message: (error as Error).message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
