import {
  runPostHogMcpMutationSmokeCheck,
  posthogMcpMutationSmokeCheckEndpoint,
} from "../src/posthog/posthog-mcp-mutation-smoke-check.js";
import type { PostHogToolGateway } from "../src/tools/types.js";

describe("runPostHogMcpMutationSmokeCheck", () => {
  it("blocks before MCP calls when mutation opt-in or required credentials are missing", async () => {
    const calls: string[] = [];
    const posthog = fakePosthogGateway(calls);

    const report = await runPostHogMcpMutationSmokeCheck({
      env: {},
      posthog,
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual([
      {
        id: "required-env",
        name: "Required PostHog MCP mutation smoke environment",
        status: "blocked",
        message:
          "Missing required environment variable(s): POSTHOG_MCP_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_MCP_MUTATION_SMOKE=1",
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("runs guarded mutating PostHog MCP checks against a target project", async () => {
    const calls: string[] = [];
    const posthog = fakePosthogGateway(calls);

    const report = await runPostHogMcpMutationSmokeCheck({
      env: {
        POSTHOG_MCP_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "project-1",
        POSTHOG_ORGANIZATION_ID: "org-1",
        POSTHOG_MCP_MUTATION_SMOKE: "1",
        POSTHOG_MCP_MUTATION_SMOKE_PREFIX: "poc-smoke-test",
      },
      posthog,
      now: () => new Date("2026-06-05T00:00:00.000Z"),
    });

    expect(report).toMatchObject({
      status: "pass",
      checkedAt: "2026-06-05T00:00:00.000Z",
      projectId: "project-1",
      organizationId: "org-1",
      prefix: "poc-smoke-test",
    });
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["project-get", "pass"],
      ["project-settings-update", "pass"],
      ["action-create", "pass"],
      ["dashboard-create", "pass"],
      ["insight-create", "pass"],
      ["cohort-create", "pass"],
      ["feature-flag-create", "pass"],
      ["experiment-create", "pass"],
      ["survey-create", "pass"],
      ["alert-create", "pass"],
    ]);
    expect(report.createdResources.map((resource) => resource.type)).toEqual([
      "action",
      "dashboard",
      "insight",
      "cohort",
      "feature_flag",
      "experiment",
      "survey",
      "alert",
    ]);
    expect(calls).toEqual([
      "getProject:project-1",
      "updateProjectSettings:project-1:{}",
      "createAction:poc-smoke-test Action",
      "createDashboard:poc-smoke-test Dashboard",
      "createInsight:poc-smoke-test Insight",
      "createCohort:poc-smoke-test Cohort",
      "createFeatureFlag:poc-smoke-test Flag",
      "createExperiment:poc-smoke-test Experiment",
      "createSurvey:poc-smoke-test Survey",
      "createAlert:poc-smoke-test Alert",
    ]);
  });

  it("uses timestamped resource names when the env prefix is blank", async () => {
    const calls: string[] = [];

    const report = await runPostHogMcpMutationSmokeCheck({
      env: {
        POSTHOG_MCP_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "project-1",
        POSTHOG_MCP_MUTATION_SMOKE: "1",
        POSTHOG_MCP_MUTATION_SMOKE_PREFIX: "",
      },
      posthog: fakePosthogGateway(calls),
      now: () => new Date("2026-06-05T12:34:56.000Z"),
    });

    expect(report.prefix).toBe("poc-smoke-20260605123456");
    expect(calls).toContain("createAction:poc-smoke-20260605123456 Action");
  });

  it("marks the report failed when a mutating check fails and skips dependent checks", async () => {
    const posthog = fakePosthogGateway([], {
      failOn: "createDashboard",
    });

    const report = await runPostHogMcpMutationSmokeCheck({
      env: {
        POSTHOG_MCP_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "project-1",
        POSTHOG_MCP_MUTATION_SMOKE: "1",
      },
      posthog,
    });

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "project-get", status: "pass" }),
        expect.objectContaining({ id: "project-settings-update", status: "pass" }),
        expect.objectContaining({ id: "action-create", status: "pass" }),
        expect.objectContaining({
          id: "dashboard-create",
          status: "fail",
          error: "dashboard shape rejected",
        }),
        expect.objectContaining({
          id: "insight-create",
          status: "blocked",
          message: "Skipped because dashboard-create did not pass.",
        }),
        expect.objectContaining({ id: "cohort-create", status: "pass" }),
      ]),
    );
  });

  it("uses a mutation-capable MCP endpoint by default", () => {
    expect(posthogMcpMutationSmokeCheckEndpoint({})).toContain(
      "tools=project-get,project-settings-update,action-create,dashboard-create,insight-create",
    );
  });
});

function fakePosthogGateway(
  calls: string[],
  options: {
    failOn?: keyof PostHogToolGateway;
  } = {},
): PostHogToolGateway {
  const maybeFail = (method: keyof PostHogToolGateway, message: string) => {
    if (options.failOn === method) {
      throw new Error(message);
    }
  };

  return {
    async getProject(projectId) {
      calls.push(`getProject:${projectId}`);
      maybeFail("getProject", "project shape rejected");
      return {
        id: projectId,
        name: "Smoke Project",
        url: `https://app.posthog.com/project/${projectId}`,
        hostUrl: "https://us.i.posthog.com",
      };
    },
    async updateProjectSettings(projectId, settings) {
      calls.push(`updateProjectSettings:${projectId}:${JSON.stringify(settings)}`);
      maybeFail("updateProjectSettings", "settings shape rejected");
    },
    async createAction(input) {
      calls.push(`createAction:${input.name}`);
      maybeFail("createAction", "action shape rejected");
      return { type: "action", id: "action-1", name: input.name };
    },
    async createDashboard(input) {
      calls.push(`createDashboard:${input.name}`);
      maybeFail("createDashboard", "dashboard shape rejected");
      return { type: "dashboard", id: "dashboard-1", name: input.name };
    },
    async createInsight(input) {
      calls.push(`createInsight:${input.name}`);
      maybeFail("createInsight", "insight shape rejected");
      return { type: "insight", id: "insight-1", name: input.name };
    },
    async createCohort(input) {
      calls.push(`createCohort:${input.name}`);
      maybeFail("createCohort", "cohort shape rejected");
      return { type: "cohort", id: "cohort-1", name: input.name };
    },
    async createFeatureFlag(input) {
      calls.push(`createFeatureFlag:${input.name}`);
      maybeFail("createFeatureFlag", "feature flag shape rejected");
      return { type: "feature_flag", id: "flag-1", name: input.name };
    },
    async createExperiment(input) {
      calls.push(`createExperiment:${input.name}`);
      maybeFail("createExperiment", "experiment shape rejected");
      return { type: "experiment", id: "experiment-1", name: input.name };
    },
    async createSurvey(input) {
      calls.push(`createSurvey:${input.name}`);
      maybeFail("createSurvey", "survey shape rejected");
      return { type: "survey", id: "survey-1", name: input.name };
    },
    async createAlert(input) {
      calls.push(`createAlert:${input.name}`);
      maybeFail("createAlert", "alert shape rejected");
      return { type: "alert", id: "alert-1", name: input.name };
    },
  };
}
