import { TriggerWorkflowClient } from "../src/workflow/trigger-workflow-client.js";

describe("TriggerWorkflowClient", () => {
  it("starts the PostHog PoC Trigger workflow", async () => {
    const triggered: unknown[] = [];
    const client = new TriggerWorkflowClient({
      posthogPocWorkflowTask: {
        async trigger(payload, options) {
          triggered.push({ payload, options });
          return { id: "run_123" };
        },
      },
    });

    const result = await client.startPosthogPocWorkflow({
      source: "api",
      text: "Acme wants PostHog.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "requirements-1" },
    });

    expect(result).toEqual({ runId: "run_123" });
    expect(triggered).toEqual([
      {
        payload: {
          source: "api",
          text: "Acme wants PostHog.",
          participants: [{ email: "buyer@acme.test", company: "Acme" }],
          sourceMetadata: { sourceId: "requirements-1" },
        },
        options: {
          tags: ["product:posthog", "stage:intake"],
        },
      },
    ]);
  });

  it("completes waitpoint tokens through Trigger's public completion endpoint", async () => {
    const requests: unknown[] = [];
    const client = new TriggerWorkflowClient({
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.completeApproval({
      tokenId: "waitpoint_123",
      publicAccessToken: "public-token",
      decision: "approved",
      decidedBy: "buyer@acme.test",
    });

    expect(result).toEqual({ success: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://api.trigger.dev/api/v1/waitpoints/tokens/waitpoint_123/complete",
    });
    const init = (requests[0] as { init: RequestInit }).init;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer public-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        decision: "approved",
        decidedBy: "buyer@acme.test",
      },
    });
  });

  it("starts the email reply processing task when inbound email arrives", async () => {
    const triggered: unknown[] = [];
    const client = new TriggerWorkflowClient({
      processEmailReplyTask: {
        async trigger(payload, options) {
          triggered.push({ payload, options });
          return { id: "run_reply_123" };
        },
      },
    });

    const result = await client.processEmailReply({
      pocId: "poc_123",
      message: {
        id: "inbound-1",
        threadId: "thread-1",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: Please confirm",
        textBody: "Approved",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      intent: "unclear",
      completedApproval: false,
      requiresSetup: false,
      changes: ["Triggered email reply processing run run_reply_123"],
    });
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      options: {
        tags: ["poc:poc_123", "product:posthog", "stage:inbound-email"],
      },
    });
  });

  it("starts the active PoC monitoring task", async () => {
    const triggered: unknown[] = [];
    const client = new TriggerWorkflowClient({
      monitorActivePocTask: {
        async trigger(payload, options) {
          triggered.push({ payload, options });
          return { id: "run_monitor_123" };
        },
      },
    });

    const result = await client.monitorActivePoc({
      pocId: "poc_123",
      window: {
        from: "2026-06-05T00:00:00.000Z",
        to: "2026-06-05T12:00:00.000Z",
      },
    });

    expect(result).toMatchObject({
      pocId: "poc_123",
      runId: "run_monitor_123",
      status: "unknown",
      riskLevel: "medium",
    });
    expect(triggered).toEqual([
      {
        payload: {
          pocId: "poc_123",
          window: {
            from: "2026-06-05T00:00:00.000Z",
            to: "2026-06-05T12:00:00.000Z",
          },
        },
        options: {
          tags: ["poc:poc_123", "product:posthog", "stage:monitoring"],
        },
      },
    ]);
  });

  it("starts a retry task for a persisted PoC stage", async () => {
    const triggered: unknown[] = [];
    const client = new TriggerWorkflowClient({
      retryPocStageTask: {
        async trigger(payload, options) {
          triggered.push({ payload, options });
          return { id: "run_retry_123" };
        },
      },
    });

    const result = await client.retryPocStage({
      pocId: "poc_123",
      stage: "handoff",
      requestedBy: "operator@example.test",
    });

    expect(result).toEqual({
      pocId: "poc_123",
      stage: "handoff",
      status: "setup_queued",
    });
    expect(triggered).toEqual([
      {
        payload: {
          pocId: "poc_123",
          stage: "handoff",
          requestedBy: "operator@example.test",
        },
        options: {
          tags: ["poc:poc_123", "product:posthog", "stage:retry-handoff"],
        },
      },
    ]);
  });
});
