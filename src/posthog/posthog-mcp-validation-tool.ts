import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";
import type { PosthogResourceRef, ValidationCheck, ValidationReport } from "../contracts.js";
import type {
  SyntheticEventCaptureResult,
  SyntheticEventVisibilityResult,
  ValidationTool,
} from "../tools/types.js";
import { posthogMcpEndpoint } from "./posthog-mcp-gateway.js";

export type PostHogMcpValidationToolOptions = {
  toolClient?: McpToolClient;
  endpoint?: string;
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
  clock?: () => Date;
};

export class PostHogMcpValidationTool implements ValidationTool {
  private readonly toolClient: McpToolClient;
  private readonly clock: () => Date;

  constructor(options: PostHogMcpValidationToolOptions = {}) {
    this.toolClient =
      options.toolClient ??
      new HttpMcpToolClient({
        endpoint: options.endpoint ?? posthogMcpEndpoint(),
        apiKey: options.apiKey ?? process.env.POSTHOG_MCP_API_KEY,
        organizationId: options.organizationId ?? process.env.POSTHOG_ORGANIZATION_ID,
        projectId: options.projectId ?? process.env.POSTHOG_PROJECT_ID,
      });
    this.clock = options.clock ?? (() => new Date());
  }

  async validatePosthogSetup(input: {
    pocId: string;
    posthogProjectId: string;
    expectedResources: {
      actions: PosthogResourceRef[];
      dashboards: PosthogResourceRef[];
      insights: PosthogResourceRef[];
    };
    syntheticEventCapture?: SyntheticEventCaptureResult;
    syntheticEventVisibility?: SyntheticEventVisibilityResult;
    expectedEvents?: string[];
  }): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [
      await this.liveCheck("project", "Project is readable", () =>
        this.toolClient.callTool("project-get", { id: projectIdArg(input.posthogProjectId) }),
      ),
      resourceGroupCheck("actions", "Actions created", input.expectedResources.actions),
      resourceGroupCheck("dashboards", "Dashboards created", input.expectedResources.dashboards),
      resourceGroupCheck("insights", "Insights created", input.expectedResources.insights),
    ];

    if (input.expectedResources.dashboards[0]) {
      checks.push(
        await this.liveCheck("dashboard-widgets", "Dashboard widgets run", () =>
          this.toolClient.callTool("dashboard-widgets-run", {
            id: dashboardIdArg(input.expectedResources.dashboards[0]?.id),
          }),
        ),
      );
    }

    checks.push(
      await this.liveCheck("data-schema", "Data schema is readable", () =>
        this.toolClient.callTool("read-data-schema", {
          query: "events",
        }),
      ),
    );
    checks.push(
      await this.liveCheck("sql-smoke", "SQL smoke query runs", () =>
        this.toolClient.callTool("execute-sql", {
          query: "SELECT 1",
        }),
      ),
    );
    if (input.expectedEvents?.length) {
      checks.push(
        await this.liveCheck("trends-query", "Trends query runs", () =>
          this.toolClient.callTool("execute-sql", {
            query: trendsQuery(input.expectedEvents ?? []),
          }),
        ),
      );
    }
    if ((input.expectedEvents?.length ?? 0) >= 2) {
      checks.push(
        await this.liveCheck("funnel-query", "Funnel query runs", () =>
          this.toolClient.callTool("execute-sql", {
            query: funnelQuery(input.expectedEvents ?? []),
          }),
        ),
      );
    }
    const syntheticCheck = syntheticEventCaptureCheck(input.syntheticEventCapture);
    if (syntheticCheck) {
      checks.push(syntheticCheck);
    }
    const visibilityCheck = syntheticEventVisibilityCheck(input.syntheticEventVisibility);
    if (visibilityCheck) {
      checks.push(visibilityCheck);
    }

    const hasFailures = checks.some((check) => check.status === "fail");
    const hasWarnings = checks.some((check) => check.status === "warn");
    const status = hasFailures ? "fail" : hasWarnings ? "warn" : "pass";

    return {
      pocId: input.pocId,
      status,
      checkedAt: this.clock().toISOString(),
      checks,
      summary:
        status === "pass"
          ? "All PostHog MCP validation checks passed."
          : status === "warn"
            ? "Required resources exist, but some live PostHog MCP checks warned."
            : "One or more required PostHog resources are missing.",
      knownGaps:
        status === "warn"
          ? ["Some live PostHog MCP validation checks could not be completed."]
          : status === "fail"
            ? ["One or more expected PostHog resource groups are missing."]
            : [],
    };
  }

  private async liveCheck(
    id: string,
    name: string,
    fn: () => Promise<unknown>,
  ): Promise<ValidationCheck> {
    try {
      await fn();
      return {
        id,
        name,
        status: "pass",
      };
    } catch (error) {
      return {
        id,
        name,
        status: "warn",
        error: (error as Error).message,
      };
    }
  }
}

function projectIdArg(projectId: string): number | "@current" {
  return projectId === "@current" ? "@current" : Number(projectId);
}

function dashboardIdArg(dashboardId: string | undefined): number | string | undefined {
  if (!dashboardId) {
    return dashboardId;
  }
  const numeric = Number(dashboardId);
  return Number.isFinite(numeric) ? numeric : dashboardId;
}

function resourceGroupCheck(
  id: string,
  name: string,
  resources: PosthogResourceRef[],
): ValidationCheck {
  return {
    id,
    name,
    status: resources.length > 0 ? "pass" : "fail",
    evidence: `${resources.length} resource(s) found.`,
  };
}

function trendsQuery(events: string[]): string {
  return `
SELECT toDate(timestamp) AS day, event, count() AS count
FROM events
WHERE event IN (${events.map(sqlQuote).join(", ")})
  AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY day, event
ORDER BY day
`.trim();
}

function funnelQuery(events: string[]): string {
  const steps = events.map((event) => `event = ${sqlQuote(event)}`).join(", ");
  return `
SELECT level, count() AS users
FROM (
  SELECT person_id, windowFunnel(86400)(timestamp, ${steps}) AS level
  FROM events
  WHERE event IN (${events.map(sqlQuote).join(", ")})
    AND timestamp >= now() - INTERVAL 7 DAY
  GROUP BY person_id
)
GROUP BY level
ORDER BY level
`.trim();
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function syntheticEventCaptureCheck(
  capture: SyntheticEventCaptureResult | undefined,
): ValidationCheck | undefined {
  if (!capture || capture.requestedEventCount === 0) {
    return undefined;
  }

  return {
    id: "synthetic-events",
    name: "Synthetic events captured",
    status: capture.status === "sent" ? "pass" : "warn",
    evidence: `${capture.eventsSent}/${capture.requestedEventCount} synthetic event(s) sent: ${capture.eventNames.join(", ")}`,
    error: capture.error ?? capture.reason,
  };
}

function syntheticEventVisibilityCheck(
  visibility: SyntheticEventVisibilityResult | undefined,
): ValidationCheck | undefined {
  if (!visibility || visibility.requestedEventCount === 0) {
    return undefined;
  }

  return {
    id: "synthetic-event-visibility",
    name: "Synthetic events visible in PostHog",
    status: visibility.status === "visible" ? "pass" : "warn",
    evidence: `${visibility.visibleEventCount}/${visibility.requestedEventCount} synthetic event type(s) visible after ${visibility.attempts} attempt(s).`,
    error: visibility.error ?? visibility.reason,
  };
}
