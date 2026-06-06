import { runPostHogMcpSmokeCheck } from "../src/posthog/posthog-mcp-smoke-check.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("runPostHogMcpSmokeCheck", () => {
  it("blocks before MCP calls when required credentials are missing", async () => {
    const calls: string[] = [];
    const toolClient: McpToolClient = {
      async callTool(name) {
        calls.push(name);
        return {};
      },
    };

    const report = await runPostHogMcpSmokeCheck({
      env: {},
      toolClient,
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual([
      {
        id: "required-env",
        name: "Required PostHog MCP environment",
        status: "blocked",
        message:
          "Missing required environment variable(s): POSTHOG_MCP_API_KEY, POSTHOG_PROJECT_ID",
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("runs read-only project, schema, and SQL MCP checks", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "project-get") {
          return { id: "project-1", name: "PoC project" };
        }
        if (name === "read-data-schema") {
          return { events: [] };
        }
        if (name === "execute-sql") {
          return { rows: [{ ok: 1 }] };
        }
        throw new Error(`Unexpected tool: ${name}`);
      },
    };

    const report = await runPostHogMcpSmokeCheck({
      env: {
        POSTHOG_MCP_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "project-1",
        POSTHOG_ORGANIZATION_ID: "org-1",
      },
      toolClient,
      now: () => new Date("2026-06-05T00:00:00.000Z"),
    });

    expect(report.status).toBe("pass");
    expect(report.checkedAt).toBe("2026-06-05T00:00:00.000Z");
    expect(report.endpoint).toContain("tools=project-get,read-data-schema,execute-sql");
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["project-get", "pass"],
      ["read-data-schema", "pass"],
      ["execute-sql", "pass"],
    ]);
    expect(calls).toEqual([
      { name: "project-get", args: { projectId: "project-1" } },
      { name: "read-data-schema", args: { projectId: "project-1" } },
      {
        name: "execute-sql",
        args: {
          projectId: "project-1",
          query: "SELECT 1 AS ok",
        },
      },
    ]);
  });

  it("marks the smoke check as failed when a read-only MCP call fails", async () => {
    const toolClient: McpToolClient = {
      async callTool(name) {
        if (name === "project-get") {
          return { id: "project-1" };
        }
        throw new Error("invalid argument shape");
      },
    };

    const report = await runPostHogMcpSmokeCheck({
      env: {
        POSTHOG_MCP_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "project-1",
      },
      toolClient,
    });

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "project-get", status: "pass" }),
      expect.objectContaining({
        id: "read-data-schema",
        status: "fail",
        error: "invalid argument shape",
      }),
      expect.objectContaining({
        id: "execute-sql",
        status: "fail",
        error: "invalid argument shape",
      }),
    ]);
  });
});
