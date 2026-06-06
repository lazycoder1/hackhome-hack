import {
  PostHogMcpSyntheticEventVerifier,
  syntheticEventVisibilityQuery,
  visibleEventNamesFromQueryResult,
} from "../src/posthog/posthog-synthetic-event-verifier.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("PostHogMcpSyntheticEventVerifier", () => {
  it("retries until all synthetic events are visible", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        if (calls.length === 1) {
          return { results: [{ event: "signup_completed", count: 1 }] };
        }
        return {
          results: [
            { event: "signup_completed", count: 1 },
            { event: "checkout_completed", count: "1" },
          ],
        };
      },
    };
    const verifier = new PostHogMcpSyntheticEventVerifier({
      toolClient,
      maxAttempts: 3,
      delayMs: 1,
      sleep: async () => undefined,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const result = await verifier.verifySyntheticEvents({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      eventNames: ["signup_completed", "checkout_completed"],
    });

    expect(result).toMatchObject({
      status: "visible",
      requestedEventCount: 2,
      visibleEventCount: 2,
      attempts: 2,
      missingEventNames: [],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      name: "execute-sql",
      args: {
        projectId: "project-1",
      },
    });
    expect(String(calls[0]?.args.query)).toContain("properties.poc_id = 'poc_123'");
  });

  it("returns not_visible after retry attempts are exhausted", async () => {
    const verifier = new PostHogMcpSyntheticEventVerifier({
      toolClient: {
        async callTool() {
          return { results: [] };
        },
      },
      maxAttempts: 2,
      delayMs: 1,
      sleep: async () => undefined,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const result = await verifier.verifySyntheticEvents({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      eventNames: ["signup_completed"],
    });

    expect(result).toMatchObject({
      status: "not_visible",
      requestedEventCount: 1,
      visibleEventCount: 0,
      missingEventNames: ["signup_completed"],
      attempts: 2,
    });
  });

  it("builds safely quoted visibility queries and parses common result shapes", () => {
    expect(syntheticEventVisibilityQuery("poc_'123", ["signup_completed"])).toContain(
      "properties.poc_id = 'poc_''123'",
    );
    expect(syntheticEventVisibilityQuery("poc_123", ["signup_completed"])).toContain("LIMIT 100");
    expect(
      visibleEventNamesFromQueryResult({
        data: {
          rows: [["signup_completed", 1], { event: "checkout_completed", count_: "2" }],
        },
      }),
    ).toEqual(["signup_completed", "checkout_completed"]);
    expect(
      visibleEventNamesFromQueryResult(
        [
          "Here is the results table of the HogQLQuery insight:",
          "",
          "```",
          "event|count",
          "signup_completed|1",
          "checkout_completed|2",
          "```",
        ].join("\n"),
      ),
    ).toEqual(["signup_completed", "checkout_completed"]);
  });
});
