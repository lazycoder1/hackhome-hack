import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";
import type { PosthogResourceRef, PosthogUsageSnapshot } from "../contracts.js";
import type { PostHogUsageSnapshotTool } from "../tools/types.js";

export type PostHogMcpUsageSnapshotToolOptions = {
  toolClient?: McpToolClient;
  endpoint?: string;
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
};

export class PostHogMcpUsageSnapshotTool implements PostHogUsageSnapshotTool {
  private readonly toolClient: McpToolClient;

  constructor(options: PostHogMcpUsageSnapshotToolOptions = {}) {
    this.toolClient =
      options.toolClient ??
      new HttpMcpToolClient({
        endpoint: options.endpoint ?? posthogMonitoringMcpEndpoint(),
        apiKey: options.apiKey ?? process.env.POSTHOG_MCP_API_KEY,
        organizationId: options.organizationId ?? process.env.POSTHOG_ORGANIZATION_ID,
        projectId: options.projectId ?? process.env.POSTHOG_PROJECT_ID,
      });
  }

  async collectPosthogUsageSnapshot(input: {
    pocId: string;
    posthogProjectId: string;
    window: {
      from: string;
      to: string;
    };
    expectedEvents: string[];
    resourceRefs: PosthogResourceRef[];
  }): Promise<PosthogUsageSnapshot> {
    const eventRows = rowsFromResult(
      await this.toolClient.callTool("execute-sql", {
        projectId: input.posthogProjectId,
        query: usageSql(input.expectedEvents, input.window),
      }),
    );
    const events = eventRows.map(normalizeEventRow).filter((event) => event.eventName);
    const dashboardActivity = await this.collectDashboardActivity(input);
    const surveyResponses = await this.collectSurveyResponses(input);
    const sessionRecordings = await this.collectSessionRecordings(input);
    const featureFlags = await this.collectFeatureFlagUsage(input);

    return {
      totalEvents: events.reduce((sum, event) => sum + event.count, 0),
      uniqueUsers: sumOptional(events.map((event) => event.uniqueUsers)),
      lastEventAt: latestDate(events.map((event) => event.lastSeenAt)),
      events,
      dashboardActivity,
      ...(surveyResponses.length ? { surveyResponses } : {}),
      ...(sessionRecordings ? { sessionRecordings } : {}),
      ...(featureFlags.length ? { featureFlags } : {}),
    };
  }

  private async collectDashboardActivity(input: {
    posthogProjectId: string;
    resourceRefs: PosthogResourceRef[];
  }): Promise<NonNullable<PosthogUsageSnapshot["dashboardActivity"]>> {
    const dashboards = input.resourceRefs.filter((resource) => resource.type === "dashboard");
    const activity = await Promise.all(
      dashboards.map(async (dashboard) => {
        try {
          await this.toolClient.callTool("dashboard-widgets-run", {
            projectId: input.posthogProjectId,
            dashboardId: dashboard.id,
          });
          return {
            dashboardId: dashboard.id,
            widgetsRunning: true,
          };
        } catch {
          return {
            dashboardId: dashboard.id,
            widgetsRunning: false,
          };
        }
      }),
    );

    return activity;
  }

  private async collectSurveyResponses(input: {
    posthogProjectId: string;
    resourceRefs: PosthogResourceRef[];
  }): Promise<NonNullable<PosthogUsageSnapshot["surveyResponses"]>> {
    const surveys = input.resourceRefs.filter((resource) => resource.type === "survey");
    return Promise.all(
      surveys.map(async (survey) => {
        try {
          const result = await this.toolClient.callTool("survey-stats", {
            projectId: input.posthogProjectId,
            surveyId: survey.id,
          });
          return { surveyId: survey.id, responseCount: responseCountFrom(result) };
        } catch {
          return { surveyId: survey.id, responseCount: 0 };
        }
      }),
    );
  }

  private async collectSessionRecordings(input: {
    posthogProjectId: string;
    window: { from: string; to: string };
  }): Promise<PosthogUsageSnapshot["sessionRecordings"]> {
    try {
      const rows = rowsFromResult(
        await this.toolClient.callTool("query-session-recordings-list", {
          projectId: input.posthogProjectId,
          after: input.window.from,
          before: input.window.to,
        }),
      );
      return {
        count: rows.length,
        latestRecordingAt: latestDate(
          rows.map((row) => stringField(row, "start_time") ?? stringField(row, "startTime")),
        ),
      };
    } catch {
      return undefined;
    }
  }

  private async collectFeatureFlagUsage(input: {
    posthogProjectId: string;
    window: { from: string; to: string };
    resourceRefs: PosthogResourceRef[];
  }): Promise<NonNullable<PosthogUsageSnapshot["featureFlags"]>> {
    const flags = input.resourceRefs.filter((resource) => resource.type === "feature_flag");
    if (!flags.length) {
      return [];
    }
    try {
      const rows = rowsFromResult(
        await this.toolClient.callTool("execute-sql", {
          projectId: input.posthogProjectId,
          query: featureFlagSql(input.window),
        }),
      );
      const byKey = new Map(rows.map((row) => [stringField(row, "flag_key") ?? "", row]));
      return flags.map((flag) => {
        const row = byKey.get(flag.name);
        return {
          key: flag.name,
          evaluations: row ? (numberField(row, "evaluations") ?? 0) : 0,
          lastEvaluatedAt: row ? stringField(row, "last_evaluated_at") : undefined,
        };
      });
    } catch {
      return flags.map((flag) => ({ key: flag.name, evaluations: 0 }));
    }
  }
}

export function posthogMonitoringMcpEndpoint(): string {
  const configured = process.env.POSTHOG_MCP_ENDPOINT;
  if (configured) {
    return configured;
  }

  const tools = [
    "execute-sql",
    "dashboard-widgets-run",
    "query-session-recordings-list",
    "survey-stats",
    "surveys-responses-list",
    "read-data-schema",
  ].join(",");

  return `https://mcp.posthog.com/mcp?tools=${tools}`;
}

function usageSql(
  expectedEvents: string[],
  window: {
    from: string;
    to: string;
  },
): string {
  const eventFilter = expectedEvents.length
    ? `AND event IN (${expectedEvents.map(sqlString).join(", ")})`
    : "AND event NOT LIKE '$%'";

  return `
SELECT
  event,
  count() AS count,
  uniqExact(distinct_id) AS unique_users,
  min(timestamp) AS first_seen_at,
  max(timestamp) AS last_seen_at,
  countIf(
    JSONExtractString(properties, 'poc_source') = 'synthetic'
    OR JSONExtractString(properties, 'source') = 'synthetic'
    OR JSONExtractString(properties, '$lib') = 'posthog-poc-automation'
  ) AS synthetic_count
FROM events
WHERE timestamp >= parseDateTimeBestEffort(${sqlString(window.from)})
  AND timestamp < parseDateTimeBestEffort(${sqlString(window.to)})
  ${eventFilter}
GROUP BY event
ORDER BY count DESC
`.trim();
}

function featureFlagSql(window: { from: string; to: string }): string {
  return `
SELECT
  JSONExtractString(properties, '$feature_flag') AS flag_key,
  count() AS evaluations,
  max(timestamp) AS last_evaluated_at
FROM events
WHERE event = '$feature_flag_called'
  AND timestamp >= parseDateTimeBestEffort(${sqlString(window.from)})
  AND timestamp < parseDateTimeBestEffort(${sqlString(window.to)})
GROUP BY flag_key
`.trim();
}

function responseCountFrom(value: unknown): number {
  const rows = rowsFromResult(value);
  if (rows.length) {
    const first = rows[0];
    return (
      numberField(first, "responses") ??
      numberField(first, "response_count") ??
      numberField(first, "count") ??
      rows.length
    );
  }
  if (isRecord(value)) {
    return numberField(value, "responses") ?? numberField(value, "count") ?? 0;
  }
  return 0;
}

function normalizeEventRow(row: Record<string, unknown>): PosthogUsageSnapshot["events"][number] {
  return {
    eventName: stringField(row, "event") ?? stringField(row, "eventName") ?? "",
    count: numberField(row, "count") ?? 0,
    uniqueUsers: numberField(row, "unique_users") ?? numberField(row, "uniqueUsers"),
    firstSeenAt: stringField(row, "first_seen_at") ?? stringField(row, "firstSeenAt"),
    lastSeenAt: stringField(row, "last_seen_at") ?? stringField(row, "lastSeenAt"),
    syntheticCount: numberField(row, "synthetic_count") ?? numberField(row, "syntheticCount"),
  };
}

function rowsFromResult(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["results", "rows", "data"]) {
    const rows = value[key];
    if (Array.isArray(rows)) {
      return rows.filter(isRecord);
    }
  }

  return [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sumOptional(values: (number | undefined)[]): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  if (!numbers.length) {
    return undefined;
  }
  return numbers.reduce((sum, value) => sum + value, 0);
}

function latestDate(values: (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
