import { HttpMcpToolClient } from "../mcp/http-mcp-tool-client.js";
import type { McpToolClient } from "../mcp/types.js";
import type { PosthogResourceRef } from "../contracts.js";
import type { PostHogProject, PostHogToolGateway } from "../tools/types.js";

export type PostHogMcpGatewayOptions = {
  toolClient?: McpToolClient;
  endpoint?: string;
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
};

export class PostHogMcpGateway implements PostHogToolGateway {
  private readonly toolClient: McpToolClient;

  constructor(options: PostHogMcpGatewayOptions = {}) {
    this.toolClient =
      options.toolClient ??
      new HttpMcpToolClient({
        endpoint: options.endpoint ?? posthogMcpEndpoint(),
        apiKey: options.apiKey ?? process.env.POSTHOG_MCP_API_KEY,
        organizationId: options.organizationId ?? process.env.POSTHOG_ORGANIZATION_ID,
        projectId: options.projectId ?? process.env.POSTHOG_PROJECT_ID,
      });
  }

  async getProject(projectId: string): Promise<PostHogProject> {
    const result = asRecord(
      await this.toolClient.callTool("project-get", { id: projectIdArg(projectId) }),
    );

    return {
      id: stringField(result, "id", projectId),
      name: stringField(result, "name", `Project ${projectId}`),
      url: stringField(result, "url", `https://app.posthog.com/project/${projectId}`),
      hostUrl: stringField(result, "hostUrl", "https://us.i.posthog.com"),
      organizationId: optionalStringField(result, "organizationId"),
    };
  }

  async updateProjectSettings(projectId: string, settings: Record<string, unknown>): Promise<void> {
    await this.toolClient.callTool("project-settings-update", {
      id: projectIdArg(projectId),
      ...settings,
    });
  }

  async createAction(input: {
    projectId: string;
    name: string;
    description: string;
    matchEvents: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("action-create", {
        name: input.name,
        description: input.description,
        steps: input.matchEvents.map((event) => ({ event })),
        tags: input.tags,
      }),
    );

    return resourceRef("action", result, input.name);
  }

  async createDashboard(input: {
    projectId: string;
    name: string;
    description?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("dashboard-create", {
        name: input.name,
        description: input.description,
        tags: input.tags,
      }),
    );

    return resourceRef("dashboard", result, input.name);
  }

  async createInsight(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    description?: string;
    type: string;
    sourceEvents?: string[];
    query?: Record<string, unknown>;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("insight-create", {
        name: input.name,
        description: input.description,
        dashboards: dashboardIds(input.dashboardId),
        query: input.query ?? insightQuery(input),
        tags: input.tags,
      }),
    );

    return resourceRef("insight", result, input.name);
  }

  async readDataSchema(input: {
    projectId: string;
    query?: Record<string, unknown>;
  }): Promise<unknown> {
    return await this.toolClient.callTool("read-data-schema", {
      query: input.query ?? { kind: "events" },
    });
  }

  async executeSql(input: { projectId: string; query: string }): Promise<unknown> {
    return await this.toolClient.callTool("execute-sql", {
      query: input.query,
    });
  }

  async createCohort(input: {
    projectId: string;
    name: string;
    description?: string;
    criteria: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("cohorts-create", {
        name: input.name,
        description: input.description,
        criteria: input.criteria,
        tags: input.tags,
      }),
    );

    return resourceRef("cohort", result, input.name);
  }

  async createFeatureFlag(input: {
    projectId: string;
    key: string;
    name: string;
    description?: string;
    rollout?: {
      percentage?: number;
      conditions?: string;
    };
    testUsers?: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("create-feature-flag", {
        key: input.key,
        name: input.name,
        description: input.description,
        rollout: input.rollout,
        testUsers: input.testUsers,
        tags: input.tags,
      }),
    );

    return resourceRef("feature_flag", result, input.name);
  }

  async createExperiment(input: {
    projectId: string;
    name: string;
    hypothesis: string;
    variants: string[];
    primaryMetric: string;
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("experiment-create", {
        name: input.name,
        hypothesis: input.hypothesis,
        variants: input.variants,
        primaryMetric: input.primaryMetric,
        launchDuringPoC: input.launchDuringPoC,
        tags: input.tags,
      }),
    );

    return resourceRef("experiment", result, input.name);
  }

  async createSurvey(input: {
    projectId: string;
    name: string;
    questions: {
      prompt: string;
      type: "open_text" | "rating" | "single_choice" | "multiple_choice";
      options?: string[];
    }[];
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("survey-create", {
        name: input.name,
        questions: input.questions,
        launchDuringPoC: input.launchDuringPoC,
        tags: input.tags,
      }),
    );

    return resourceRef("survey", result, input.name);
  }

  async createAlert(input: {
    projectId: string;
    name: string;
    condition: string;
    destination?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    const result = asRecord(
      await this.toolClient.callTool("alert-create", {
        name: input.name,
        condition: input.condition,
        destination: input.destination,
        tags: input.tags,
      }),
    );

    return resourceRef("alert", result, input.name);
  }
}

export function posthogMcpEndpoint(): string {
  const configured = process.env.POSTHOG_MCP_ENDPOINT;
  if (configured) {
    return configured;
  }

  const tools = [
    "project-get",
    "project-settings-update",
    "action-create",
    "dashboard-create",
    "insight-create",
    "cohorts-create",
    "create-feature-flag",
    "experiment-create",
    "survey-create",
    "alert-create",
    "read-data-schema",
    "execute-sql",
  ].join(",");

  return `https://mcp.posthog.com/mcp?tools=${tools}`;
}

function resourceRef(
  type: PosthogResourceRef["type"],
  result: Record<string, unknown>,
  fallbackName: string,
): PosthogResourceRef {
  return {
    type,
    id: idField(result, `${type}:unknown`),
    name: stringField(result, "name", fallbackName),
    url: optionalStringField(result, "url") ?? optionalStringField(result, "_posthogUrl"),
    tags: Array.isArray(result.tags)
      ? result.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
  };
}

function projectIdArg(projectId: string): number | "@current" {
  return projectId === "@current" ? "@current" : Number(projectId);
}

function dashboardIds(dashboardId: string): Array<string | number> {
  const numeric = Number(dashboardId);
  return Number.isFinite(numeric) ? [numeric] : [dashboardId];
}

function insightQuery(input: {
  name: string;
  type: string;
  sourceEvents?: string[];
}): Record<string, unknown> {
  const event = input.sourceEvents?.[0] ?? "$pageview";
  return {
    kind: "InsightVizNode",
    source: {
      kind: "TrendsQuery",
      series: [
        {
          kind: "EventsNode",
          event,
          name: input.name,
        },
      ],
      interval: "day",
      dateRange: {
        date_from: "-30d",
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return parseMcpTextRecord(value);
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseMcpTextRecord(value: string): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const line of value.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const rawValue = match[2].trim();
    record[match[1]] = /^-?\d+$/.test(rawValue)
      ? Number(rawValue)
      : rawValue.replace(/^"(.*)"$/, "$1");
  }
  return record;
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

function idField(record: Record<string, unknown>, fallback: string): string {
  const direct = stringField(record, "id", "");
  if (direct) {
    return direct;
  }
  return stringField(record, "short_id", fallback);
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
