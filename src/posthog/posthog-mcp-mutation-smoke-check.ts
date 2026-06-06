import type { PosthogResourceRef } from "../contracts.js";
import type { PostHogToolGateway } from "../tools/types.js";
import { PostHogMcpGateway } from "./posthog-mcp-gateway.js";

const MUTATION_SMOKE_TOOLS = [
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
] as const;

export type PostHogMcpMutationSmokeCheckStatus = "pass" | "fail" | "blocked";

export type PostHogMcpMutationSmokeCheckReport = {
  status: PostHogMcpMutationSmokeCheckStatus;
  checkedAt: string;
  endpoint: string;
  projectId?: string;
  organizationId?: string;
  prefix: string;
  checks: {
    id: string;
    name: string;
    status: PostHogMcpMutationSmokeCheckStatus;
    message?: string;
    error?: string;
    resource?: PosthogResourceRef;
  }[];
  createdResources: PosthogResourceRef[];
};

export type PostHogMcpMutationSmokeCheckOptions = {
  env?: Record<string, string | undefined>;
  posthog?: PostHogToolGateway;
  now?: () => Date;
};

type MutationCheck = PostHogMcpMutationSmokeCheckReport["checks"][number];

export async function runPostHogMcpMutationSmokeCheck(
  options: PostHogMcpMutationSmokeCheckOptions = {},
): Promise<PostHogMcpMutationSmokeCheckReport> {
  const env = options.env ?? process.env;
  const checkedAtDate = (options.now ?? (() => new Date()))();
  const checkedAt = checkedAtDate.toISOString();
  const endpoint = posthogMcpMutationSmokeCheckEndpoint(env);
  const projectId = env.POSTHOG_PROJECT_ID;
  const organizationId = env.POSTHOG_ORGANIZATION_ID;
  const prefix = mutationPrefix(env, checkedAtDate);
  const missing = requiredEnvMissing(env);

  if (missing.length) {
    return {
      status: "blocked",
      checkedAt,
      endpoint,
      projectId,
      organizationId,
      prefix,
      checks: [
        {
          id: "required-env",
          name: "Required PostHog MCP mutation smoke environment",
          status: "blocked",
          message: `Missing required environment variable(s): ${missing.join(", ")}`,
        },
      ],
      createdResources: [],
    };
  }

  const posthog =
    options.posthog ??
    new PostHogMcpGateway({
      endpoint,
      apiKey: env.POSTHOG_MCP_API_KEY,
      organizationId,
      projectId,
    });

  const createdResources: PosthogResourceRef[] = [];
  const checks: MutationCheck[] = [];

  checks.push(
    await runMutationCheck({
      id: "project-get",
      name: "Read target project",
      run: async () => {
        const project = await posthog.getProject(requiredProjectId(projectId));
        return { type: "project", id: project.id, name: project.name, url: project.url };
      },
    }),
  );

  checks.push(
    await runMutationCheck({
      id: "project-settings-update",
      name: "Update project settings with smoke payload",
      run: async () => {
        await posthog.updateProjectSettings(
          requiredProjectId(projectId),
          projectSettingsPayload(env),
        );
      },
    }),
  );

  checks.push(
    await runMutationCheck({
      id: "action-create",
      name: "Create action",
      run: async () =>
        await posthog.createAction({
          projectId: requiredProjectId(projectId),
          name: `${prefix} Action`,
          description: "Temporary PostHog MCP mutation smoke action. Safe to delete.",
          matchEvents: [eventName(prefix)],
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  const dashboardCheck = await runMutationCheck({
    id: "dashboard-create",
    name: "Create dashboard",
    run: async () =>
      await posthog.createDashboard({
        projectId: requiredProjectId(projectId),
        name: `${prefix} Dashboard`,
        description: "Temporary PostHog MCP mutation smoke dashboard. Safe to delete.",
        tags: smokeTags(prefix),
      }),
    createdResources,
  });
  checks.push(dashboardCheck);

  const dashboardId = dashboardCheck.resource?.id;
  if (dashboardCheck.status === "pass" && dashboardId) {
    checks.push(
      await runMutationCheck({
        id: "insight-create",
        name: "Create insight",
        run: async () =>
          await posthog.createInsight({
            projectId: requiredProjectId(projectId),
            dashboardId,
            name: `${prefix} Insight`,
            type: "trend",
            sourceEvents: [eventName(prefix)],
            tags: smokeTags(prefix),
          }),
        createdResources,
      }),
    );
  } else {
    checks.push({
      id: "insight-create",
      name: "Create insight",
      status: "blocked",
      message: "Skipped because dashboard-create did not pass.",
    });
  }

  checks.push(
    await runOptionalMutationCheck({
      id: "cohort-create",
      name: "Create cohort",
      methodExists: Boolean(posthog.createCohort),
      run: async () =>
        await posthog.createCohort?.({
          projectId: requiredProjectId(projectId),
          name: `${prefix} Cohort`,
          description: "Temporary PostHog MCP mutation smoke cohort. Safe to delete.",
          criteria: `event = ${eventName(prefix)}`,
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  checks.push(
    await runOptionalMutationCheck({
      id: "feature-flag-create",
      name: "Create feature flag",
      methodExists: Boolean(posthog.createFeatureFlag),
      run: async () =>
        await posthog.createFeatureFlag?.({
          projectId: requiredProjectId(projectId),
          key: resourceKey(prefix, "flag"),
          name: `${prefix} Flag`,
          description: "Temporary PostHog MCP mutation smoke flag. Safe to delete.",
          rollout: { percentage: 0 },
          testUsers: [],
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  checks.push(
    await runOptionalMutationCheck({
      id: "experiment-create",
      name: "Create experiment",
      methodExists: Boolean(posthog.createExperiment),
      run: async () =>
        await posthog.createExperiment?.({
          projectId: requiredProjectId(projectId),
          name: `${prefix} Experiment`,
          hypothesis: "Temporary MCP mutation smoke experiment validates tool argument shape.",
          variants: ["control", "variant"],
          primaryMetric: eventName(prefix),
          launchDuringPoC: false,
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  checks.push(
    await runOptionalMutationCheck({
      id: "survey-create",
      name: "Create survey",
      methodExists: Boolean(posthog.createSurvey),
      run: async () =>
        await posthog.createSurvey?.({
          projectId: requiredProjectId(projectId),
          name: `${prefix} Survey`,
          questions: [
            {
              prompt: "Temporary smoke survey question. Safe to delete.",
              type: "rating",
            },
          ],
          launchDuringPoC: false,
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  checks.push(
    await runOptionalMutationCheck({
      id: "alert-create",
      name: "Create alert",
      methodExists: Boolean(posthog.createAlert),
      run: async () =>
        await posthog.createAlert?.({
          projectId: requiredProjectId(projectId),
          name: `${prefix} Alert`,
          condition: `${eventName(prefix)} count > 0`,
          tags: smokeTags(prefix),
        }),
      createdResources,
    }),
  );

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasBlocked = checks.some((check) => check.status === "blocked");

  return {
    status: hasFailure ? "fail" : hasBlocked ? "blocked" : "pass",
    checkedAt,
    endpoint,
    projectId,
    organizationId,
    prefix,
    checks,
    createdResources,
  };
}

export function posthogMcpMutationSmokeCheckEndpoint(
  env: Record<string, string | undefined>,
): string {
  return (
    env.POSTHOG_MCP_MUTATION_ENDPOINT ??
    env.POSTHOG_MCP_ENDPOINT ??
    `https://mcp.posthog.com/mcp?tools=${MUTATION_SMOKE_TOOLS.join(",")}`
  );
}

function requiredEnvMissing(env: Record<string, string | undefined>): string[] {
  const missing = ["POSTHOG_MCP_API_KEY", "POSTHOG_PROJECT_ID"].filter((key) => !env[key]);
  if (env.POSTHOG_MCP_MUTATION_SMOKE !== "1") {
    missing.push("POSTHOG_MCP_MUTATION_SMOKE=1");
  }
  return missing;
}

async function runMutationCheck(input: {
  id: string;
  name: string;
  run: () => Promise<PosthogResourceRef | void>;
  createdResources?: PosthogResourceRef[];
}): Promise<MutationCheck> {
  try {
    const result = await input.run();
    const resource = result ?? undefined;
    if (resource && resource.type !== "project") {
      input.createdResources?.push(resource);
    }
    return {
      id: input.id,
      name: input.name,
      status: "pass",
      message: "Tool call succeeded.",
      resource,
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

async function runOptionalMutationCheck(input: {
  id: string;
  name: string;
  methodExists: boolean;
  run: () => Promise<PosthogResourceRef | undefined>;
  createdResources: PosthogResourceRef[];
}): Promise<MutationCheck> {
  if (!input.methodExists) {
    return {
      id: input.id,
      name: input.name,
      status: "blocked",
      message: "PostHog gateway does not expose this method.",
    };
  }

  return await runMutationCheck({
    id: input.id,
    name: input.name,
    run: input.run,
    createdResources: input.createdResources,
  });
}

function requiredProjectId(projectId: string | undefined): string {
  if (!projectId) {
    throw new Error("POSTHOG_PROJECT_ID is required");
  }
  return projectId;
}

function projectSettingsPayload(env: Record<string, string | undefined>): Record<string, unknown> {
  const raw = env.POSTHOG_MCP_MUTATION_SMOKE_PROJECT_SETTINGS_JSON;
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("POSTHOG_MCP_MUTATION_SMOKE_PROJECT_SETTINGS_JSON must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function mutationPrefix(env: Record<string, string | undefined>, date: Date): string {
  return env.POSTHOG_MCP_MUTATION_SMOKE_PREFIX?.trim() || `poc-smoke-${timestampKey(date)}`;
}

function timestampKey(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
}

function eventName(prefix: string): string {
  return `${resourceKey(prefix, "event")}_completed`;
}

function resourceKey(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function smokeTags(prefix: string): string[] {
  return ["source:poc-automation-smoke", `smoke:${prefix}`];
}
