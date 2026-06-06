import { HttpPostHogEventCaptureTool } from "../src/posthog/posthog-event-capture-tool.js";

describe("HttpPostHogEventCaptureTool", () => {
  it("sends synthetic events to PostHog capture", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const tool = new HttpPostHogEventCaptureTool({
      projectApiKey: "phc_project_key",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      async fetchImpl(url, init) {
        requests.push({
          url: url.toString(),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ status: 1 }), { status: 200 });
      },
    });

    const result = await tool.captureSyntheticEvents({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      hostUrl: "https://us.i.posthog.com",
      events: [
        {
          name: "signup_completed",
          description: "Synthetic signup completion",
          required: true,
          testValues: { plan: "pro" },
        },
      ],
    });

    expect(result).toMatchObject({
      status: "sent",
      requestedEventCount: 1,
      eventsSent: 1,
      eventNames: ["signup_completed"],
    });
    expect(requests).toEqual([
      {
        url: "https://us.i.posthog.com/capture/",
        body: {
          api_key: "phc_project_key",
          event: "signup_completed",
          distinct_id: "poc_123:synthetic-user",
          timestamp: "2026-06-04T00:00:00.000Z",
          properties: {
            plan: "pro",
            poc_id: "poc_123",
            posthog_project_id: "project-1",
            source: "poc-automation",
            synthetic: true,
          },
        },
      },
    ]);
  });

  it("skips capture when no project API key is configured", async () => {
    const tool = new HttpPostHogEventCaptureTool({
      projectApiKey: "",
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      async fetchImpl() {
        throw new Error("fetch should not be called");
      },
    });

    const result = await tool.captureSyntheticEvents({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      hostUrl: "https://us.i.posthog.com",
      events: [
        { name: "signup_completed", description: "Synthetic signup completion", required: true },
      ],
    });

    expect(result).toMatchObject({
      status: "skipped",
      requestedEventCount: 1,
      eventsSent: 0,
      reason: "POSTHOG_PROJECT_API_KEY is not configured.",
    });
  });
});
