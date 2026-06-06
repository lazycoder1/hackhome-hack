import { PostHogMcpValidationTool } from "../src/posthog/posthog-mcp-validation-tool.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("PostHogMcpValidationTool", () => {
  it("passes when PostHog MCP project, schema, and SQL checks succeed", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "read-data-schema") {
          return { events: [{ name: "signup_completed" }] };
        }
        return { ok: true };
      },
    };
    const validator = new PostHogMcpValidationTool({
      toolClient,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validator.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed signup" }],
        dashboards: [{ type: "dashboard", id: "dashboard-1", name: "PoC Dashboard" }],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
    });

    expect(report.status).toBe("pass");
    expect(report.checks.map((check) => check.id)).toEqual([
      "project",
      "actions",
      "dashboards",
      "insights",
      "data-schema",
      "sql-smoke",
    ]);
    expect(calls.map((call) => call.name)).toEqual([
      "project-get",
      "read-data-schema",
      "execute-sql",
    ]);
  });

  it("returns warn when optional MCP checks fail but expected resources exist", async () => {
    const toolClient: McpToolClient = {
      async callTool(name) {
        if (name === "project-get") {
          return { ok: true };
        }
        throw new Error(`${name} unavailable`);
      },
    };
    const validator = new PostHogMcpValidationTool({
      toolClient,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validator.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed signup" }],
        dashboards: [{ type: "dashboard", id: "dashboard-1", name: "PoC Dashboard" }],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
    });

    expect(report.status).toBe("warn");
    expect(report.knownGaps).toEqual([
      "Some live PostHog MCP validation checks could not be completed.",
    ]);
  });

  it("includes synthetic event capture warnings in MCP validation reports", async () => {
    const toolClient: McpToolClient = {
      async callTool() {
        return { ok: true };
      },
    };
    const validator = new PostHogMcpValidationTool({
      toolClient,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validator.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed signup" }],
        dashboards: [],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
      syntheticEventCapture: {
        status: "skipped",
        requestedEventCount: 1,
        eventsSent: 0,
        eventNames: ["signup_completed"],
        capturedAt: "2026-06-04T00:00:00.000Z",
        reason: "POSTHOG_PROJECT_API_KEY is not configured.",
      },
    });

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "synthetic-events",
        status: "warn",
      }),
    );
  });

  it("fails when required created resources are missing", async () => {
    const toolClient: McpToolClient = {
      async callTool() {
        return { ok: true };
      },
    };
    const validator = new PostHogMcpValidationTool({
      toolClient,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validator.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [],
        dashboards: [],
        insights: [],
      },
    });

    expect(report.status).toBe("fail");
    expect(
      report.checks.filter((check) => check.status === "fail").map((check) => check.id),
    ).toEqual(["actions", "dashboards", "insights"]);
  });

  it("adds trends and funnel query-wrapper checks when expected events are provided", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        return { ok: true };
      },
    };
    const validator = new PostHogMcpValidationTool({
      toolClient,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const report = await validator.validatePosthogSetup({
      pocId: "poc_123",
      posthogProjectId: "project-1",
      expectedResources: {
        actions: [{ type: "action", id: "action-1", name: "Completed signup" }],
        dashboards: [],
        insights: [{ type: "insight", id: "insight-1", name: "Signup funnel" }],
      },
      expectedEvents: ["signup_started", "signup_completed"],
    });

    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["trends-query", "funnel-query"]),
    );
    const sqlQueries = calls
      .filter((call) => call.name === "execute-sql")
      .map((call) => String(call.args.query));
    expect(sqlQueries.some((query) => query.includes("windowFunnel"))).toBe(true);
    expect(sqlQueries.some((query) => query.includes("signup_started"))).toBe(true);
  });
});
