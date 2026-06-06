import { PostHogMcpUsageSnapshotTool } from "../src/posthog/posthog-mcp-usage-snapshot-tool.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("PostHogMcpUsageSnapshotTool", () => {
  it("collects events, dashboards, surveys, recordings, and flag usage via read-only MCP tools", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "execute-sql") {
          if (String(args.query).includes("$feature_flag_called")) {
            return {
              results: [
                {
                  flag_key: "Beta flag",
                  evaluations: 7,
                  last_evaluated_at: "2026-06-05T10:00:00.000Z",
                },
              ],
            };
          }
          return {
            results: [
              {
                event: "signup_completed",
                count: 5,
                unique_users: 3,
                first_seen_at: "2026-06-05T09:00:00.000Z",
                last_seen_at: "2026-06-05T10:00:00.000Z",
                synthetic_count: 0,
              },
            ],
          };
        }
        if (name === "dashboard-widgets-run") {
          return { status: "ok" };
        }
        if (name === "survey-stats") {
          return { results: [{ responses: 4 }] };
        }
        if (name === "query-session-recordings-list") {
          return { results: [{ start_time: "2026-06-05T11:00:00.000Z" }] };
        }
        throw new Error(`Unexpected tool call: ${name}`);
      },
    };
    const tool = new PostHogMcpUsageSnapshotTool({ toolClient });

    const snapshot = await tool.collectPosthogUsageSnapshot({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      window: {
        from: "2026-06-05T00:00:00.000Z",
        to: "2026-06-05T12:00:00.000Z",
      },
      expectedEvents: ["signup_completed"],
      resourceRefs: [
        { type: "dashboard", id: "dashboard-1", name: "PoC - Acme" },
        { type: "survey", id: "survey-1", name: "Onboarding NPS" },
        { type: "feature_flag", id: "flag-1", name: "Beta flag" },
      ],
    });

    expect(new Set(calls.map((call) => call.name))).toEqual(
      new Set([
        "execute-sql",
        "dashboard-widgets-run",
        "survey-stats",
        "query-session-recordings-list",
      ]),
    );
    expect(snapshot).toMatchObject({
      totalEvents: 5,
      uniqueUsers: 3,
      lastEventAt: "2026-06-05T10:00:00.000Z",
      events: [{ eventName: "signup_completed", count: 5 }],
      dashboardActivity: [{ dashboardId: "dashboard-1", widgetsRunning: true }],
      surveyResponses: [{ surveyId: "survey-1", responseCount: 4 }],
      sessionRecordings: { count: 1, latestRecordingAt: "2026-06-05T11:00:00.000Z" },
      featureFlags: [
        { key: "Beta flag", evaluations: 7, lastEvaluatedAt: "2026-06-05T10:00:00.000Z" },
      ],
    });
  });
});
