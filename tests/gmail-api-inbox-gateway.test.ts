import { GmailApiInboxGateway } from "../src/tools/gmail-api-inbox-gateway.js";

describe("GmailApiInboxGateway", () => {
  it("searches Gmail messages and returns unique thread refs", async () => {
    const requests: unknown[] = [];
    const gateway = new GmailApiInboxGateway({
      accessToken: "ya29.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return jsonResponse({
          messages: [
            { id: "msg_1", threadId: "thread_1" },
            { id: "msg_2", threadId: "thread_1" },
            { id: "msg_3", threadId: "thread_2" },
          ],
          nextPageToken: "next-token",
        });
      },
    });

    const result = await gateway.searchThreads({
      query: "in:inbox newer_than:1d",
      pageSize: 10,
      pageToken: "page-token",
      includeTrash: true,
    });

    expect(result).toEqual({
      threads: [
        { id: "thread_1", messages: [] },
        { id: "thread_2", messages: [] },
      ],
      nextPageToken: "next-token",
      next_page_token: "next-token",
    });
    const request = requests[0] as { url: string; init: RequestInit };
    expect(request.url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox+newer_than%3A1d&maxResults=10&pageToken=page-token&includeSpamTrash=true",
    );
    expect(request.init.headers).toMatchObject({
      authorization: "Bearer ya29.test",
    });
  });

  it("fetches a full Gmail thread and maps messages into Gmail MCP-compatible fields", async () => {
    const gateway = new GmailApiInboxGateway({
      accessTokenProvider: () => "fresh-token",
      fetchImpl: async () =>
        jsonResponse({
          id: "thread_1",
          messages: [
            {
              id: "msg_1",
              threadId: "thread_1",
              internalDate: "1780686400000",
              snippet: "Approved",
              payload: {
                headers: [
                  { name: "From", value: "Buyer <buyer@acme.test>" },
                  { name: "To", value: "PoC <poc_123@inbound.example.test>" },
                  { name: "Cc", value: "Champion <champion@acme.test>" },
                  { name: "Subject", value: "Re: Please confirm your PostHog PoC plan" },
                  { name: "Date", value: "Sat, 06 Jun 2026 01:00:00 +0530" },
                ],
                parts: [
                  {
                    mimeType: "text/plain",
                    body: { data: base64Url("Approved, please proceed.\n") },
                  },
                ],
              },
            },
          ],
        }),
    });

    await expect(
      gateway.getThread({ threadId: "thread_1", messageFormat: "FULL_CONTENT" }),
    ).resolves.toEqual({
      id: "thread_1",
      messages: [
        {
          id: "msg_1",
          threadId: "thread_1",
          thread_id: "thread_1",
          from: "Buyer <buyer@acme.test>",
          sender: "Buyer <buyer@acme.test>",
          to: "PoC <poc_123@inbound.example.test>",
          toRecipients: ["PoC <poc_123@inbound.example.test>"],
          ccRecipients: ["Champion <champion@acme.test>"],
          subject: "Re: Please confirm your PostHog PoC plan",
          plaintextBody: "Approved, please proceed.\n",
          snippet: "Approved",
          date: "Sat, 06 Jun 2026 01:00:00 +0530",
        },
      ],
    });
  });

  it("adds labels to a Gmail thread", async () => {
    const requests: unknown[] = [];
    const gateway = new GmailApiInboxGateway({
      accessToken: "ya29.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return jsonResponse({});
      },
    });

    await expect(
      gateway.labelThread({ threadId: "thread_1", labelIds: ["Label_123"] }),
    ).resolves.toEqual({ success: true });

    const request = requests[0] as { url: string; init: RequestInit };
    expect(request.url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread_1/modify",
    );
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(String(request.init.body))).toEqual({ addLabelIds: ["Label_123"] });
  });

  it("requires a Gmail API access token", async () => {
    const gateway = new GmailApiInboxGateway({});

    await expect(gateway.searchThreads({ query: "in:inbox" })).rejects.toThrow(
      /GMAIL_API_ACCESS_TOKEN/,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
