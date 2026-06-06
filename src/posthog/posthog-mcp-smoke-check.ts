import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";

const READ_ONLY_SMOKE_TOOLS = ["project-get", "read-data-schema", "execute-sql"] as const;

export type PostHogMcpSmokeCheckStatus = "pass" | "fail" | "blocked";

export type PostHogMcpSmokeCheckReport = {
  status: PostHogMcpSmokeCheckStatus;
  checkedAt: string;
  endpoint: string;
  projectId?: string;
  organizationId?: string;
  checks: {
    id: string;
    name: string;
    status: PostHogMcpSmokeCheckStatus;
    message?: string;
    error?: string;
  }[];
};

export type PostHogMcpSmokeCheckOptions = {
  env?: Record<string, string | undefined>;
  toolClient?: McpToolClient;
  now?: () => Date;
};

export async function runPostHogMcpSmokeCheck(
  options: PostHogMcpSmokeCheckOptions = {},
): Promise<PostHogMcpSmokeCheckReport> {
  const env = options.env ?? process.env;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const endpoint = posthogMcpSmokeCheckEndpoint(env);
  const missing = requiredEnvMissing(env);
  const projectId = env.POSTHOG_PROJECT_ID;
  const organizationId = env.POSTHOG_ORGANIZATION_ID;

  if (missing.length) {
    return {
      status: "blocked",
      checkedAt,
      endpoint,
      projectId,
      organizationId,
      checks: [
        {
          id: "required-env",
          name: "Required PostHog MCP environment",
          status: "blocked",
          message: `Missing required environment variable(s): ${missing.join(", ")}`,
        },
      ],
    };
  }

  const toolClient =
    options.toolClient ??
    new HttpMcpToolClient({
      endpoint,
      apiKey: env.POSTHOG_MCP_API_KEY,
      organizationId,
      projectId,
    });

  const checks = await Promise.all([
    runToolCheck(toolClient, {
      id: "project-get",
      name: "Read target project",
      tool: "project-get",
      args: { projectId },
    }),
    runToolCheck(toolClient, {
      id: "read-data-schema",
      name: "Read project data schema",
      tool: "read-data-schema",
      args: { projectId },
    }),
    runToolCheck(toolClient, {
      id: "execute-sql",
      name: "Run read-only SQL smoke query",
      tool: "execute-sql",
      args: {
        projectId,
        query: "SELECT 1 AS ok",
      },
    }),
  ]);

  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    checkedAt,
    endpoint,
    projectId,
    organizationId,
    checks,
  };
}

export function posthogMcpSmokeCheckEndpoint(env: Record<string, string | undefined>): string {
  return (
    env.POSTHOG_MCP_ENDPOINT ??
    `https://mcp.posthog.com/mcp?tools=${READ_ONLY_SMOKE_TOOLS.join(",")}`
  );
}

function requiredEnvMissing(env: Record<string, string | undefined>): string[] {
  return ["POSTHOG_MCP_API_KEY", "POSTHOG_PROJECT_ID"].filter((key) => !env[key]);
}

async function runToolCheck(
  toolClient: McpToolClient,
  input: {
    id: string;
    name: string;
    tool: string;
    args: Record<string, unknown>;
  },
): Promise<PostHogMcpSmokeCheckReport["checks"][number]> {
  try {
    await toolClient.callTool(input.tool, input.args);
    return {
      id: input.id,
      name: input.name,
      status: "pass",
      message: "Tool call succeeded.",
    };
  } catch (error) {
    return {
      id: input.id,
      name: input.name,
      status: "fail",
      error: (error as Error).message,
    };
  }
}
