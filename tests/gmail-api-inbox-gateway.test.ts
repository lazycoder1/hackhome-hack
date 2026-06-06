import { GmailApiInboxGateway } from "../src/tools/gmail-api-inbox-gateway.js";

describe("GmailApiInboxGateway", () => {
  it("searches messages, deduplicates threads, and fetches full thread content", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const gateway = new GmailApiInboxGateway({
      accessToken: "ya29.test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("/messages?")) {
          return json({
            messages: [
              { id: "msg_1", threadId: "thread_1" },
              { id: "msg_2", threadId: "thread_1" },
              { id: "msg_3", threadId: "thread_2" },
            ],
            nextPageToken: "page_2",
          });
        }
        return json({
          id: "thread_1",
          messages: [
            {
              id: "msg_1",
              threadId: "thread_1",
              snippet: "Approved",
              internalDate: "1780599600000",
              payload: {
                headers: [
                  { name: "From", value: "VGS <vgs@getconvinced.ai>" },
                  { name: "To", value: "poc_123@inbound.example.test, team@example.test" },
                  { name: "Subject", value: "Re: Please confirm your PostHog PoC plan" },
                ],
                parts: [
                  {
                    mimeType: "text/html",
                    body: { data: encodeBase64Url("<p>Approved</p>") },
                  },
                  {
                    mimeType: "text/plain",
                    body: { data: encodeBase64Url("Approved, please proceed.") },
                  },
                ],
              },
            },
          ],
        });
      },
    });

    await expect(
      gateway.searchThreads({
        query: "in:inbox newer_than:7d -in:draft",
        pageSize: 10,
        pageToken: "page_1",
        includeTrash: true,
      }),
    ).resolves.toEqual({
      threads: [
        { id: "thread_1", messages: [] },
        { id: "thread_2", messages: [] },
      ],
      nextPageToken: "page_2",
      next_page_token: "page_2",
    });

    await expect(gateway.getThread({ threadId: "thread_1" })).resolves.toEqual({
      id: "thread_1",
      messages: [
        {
          id: "msg_1",
          threadId: "thread_1",
          thread_id: "thread_1",
          snippet: "Approved",
          subject: "Re: Please confirm your PostHog PoC plan",
          from: "VGS <vgs@getconvinced.ai>",
          sender: "VGS <vgs@getconvinced.ai>",
          to: "poc_123@inbound.example.test, team@example.test",
          toRecipients: ["poc_123@inbound.example.test", "team@example.test"],
          ccRecipients: undefined,
          date: "2026-06-04T19:00:00.000Z",
          plaintextBody: "Approved, please proceed.",
        },
      ],
    });

    expect(requests[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox+newer_than%3A7d+-in%3Adraft&maxResults=10&pageToken=page_1&includeSpamTrash=true",
    );
    expect(requests[0].init.headers).toMatchObject({
      accept: "application/json",
      authorization: "Bearer ya29.test",
    });
    expect(requests[1].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread_1?format=full",
    );
  });

  it("labels processed threads through the Gmail modify endpoint", async () => {
    const requests: RequestInit[] = [];
    const gateway = new GmailApiInboxGateway({
      accessTokenProvider: () => "fresh-token",
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        return json({});
      },
    });

    await expect(
      gateway.labelThread({ threadId: "thread_1", labelIds: ["Label_Processed"] }),
    ).resolves.toEqual({ success: true });

    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers).toMatchObject({
      authorization: "Bearer fresh-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requests[0].body))).toEqual({
      addLabelIds: ["Label_Processed"],
    });
  });

  it("requires a Gmail API token for inbox access", async () => {
    const gateway = new GmailApiInboxGateway();

    await expect(gateway.searchThreads({})).rejects.toThrow(/GMAIL_API_ACCESS_TOKEN/);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
