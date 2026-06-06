import { PostHogMcpGateway } from "../src/posthog/posthog-mcp-gateway.js";
import type { McpToolClient } from "../src/mcp/types.js";

describe("PostHogMcpGateway", () => {
  it("maps setup-agent project calls to PostHog MCP tools", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "project-get") {
          return {
            id: "project-1",
            name: "Acme PoC",
            url: "https://us.posthog.com/project/project-1",
            hostUrl: "https://us.i.posthog.com",
          };
        }
        if (name === "action-create") {
          return { id: "action-1", name: args.name };
        }
        if (name === "dashboard-create") {
          return { id: "dashboard-1", name: args.name, url: "https://us.posthog.com/dashboard/1" };
        }
        if (name === "insight-create") {
          return { id: "insight-1", name: args.name };
        }
        if (name === "cohorts-create") {
          return { id: "cohort-1", name: args.name };
        }
        if (name === "create-feature-flag") {
          return { id: "flag-1", name: args.name };
        }
        if (name === "experiment-create") {
          return { id: "experiment-1", name: args.name };
        }
        if (name === "survey-create") {
          return { id: "survey-1", name: args.name };
        }
        if (name === "alert-create") {
          return { id: "alert-1", name: args.name };
        }
        return {};
      },
    };
    const gateway = new PostHogMcpGateway({ toolClient });

    const project = await gateway.getProject("project-1");
    await gateway.updateProjectSettings("project-1", { timezone: "UTC" });
    const action = await gateway.createAction({
      projectId: "project-1",
      name: "Completed Signup",
      description: "User completed signup",
      matchEvents: ["signup_completed"],
    });
    const dashboard = await gateway.createDashboard({
      projectId: "project-1",
      name: "PoC - Acme",
    });
    const insight = await gateway.createInsight({
      projectId: "project-1",
      dashboardId: dashboard.id,
      name: "Signup funnel",
      type: "funnel",
      sourceEvents: ["signup_completed"],
    });
    const cohort = await gateway.createCohort({
      projectId: "project-1",
      name: "Activated users",
      criteria: "event = signup_completed",
    });
    const flag = await gateway.createFeatureFlag({
      projectId: "project-1",
      key: "poc-onboarding",
      name: "PoC onboarding",
      rollout: { percentage: 25 },
    });
    const experiment = await gateway.createExperiment({
      projectId: "project-1",
      name: "Signup onboarding test",
      hypothesis: "Guided onboarding increases signup completion.",
      variants: ["control", "guided"],
      primaryMetric: "signup_completed",
      launchDuringPoC: false,
    });
    const survey = await gateway.createSurvey({
      projectId: "project-1",
      name: "PoC feedback",
      questions: [{ prompt: "Was this setup useful?", type: "rating" }],
      launchDuringPoC: true,
    });
    const alert = await gateway.createAlert({
      projectId: "project-1",
      name: "Signup drop alert",
      condition: "signup_completed drops below 10 per day",
      destination: "buyer@acme.test",
    });

    expect(project.name).toBe("Acme PoC");
    expect(action).toMatchObject({ type: "action", id: "action-1" });
    expect(insight).toMatchObject({ type: "insight", id: "insight-1" });
    expect(cohort).toMatchObject({ type: "cohort", id: "cohort-1" });
    expect(flag).toMatchObject({ type: "feature_flag", id: "flag-1" });
    expect(experiment).toMatchObject({ type: "experiment", id: "experiment-1" });
    expect(survey).toMatchObject({ type: "survey", id: "survey-1" });
    expect(alert).toMatchObject({ type: "alert", id: "alert-1" });
    expect(calls.map((call) => call.name)).toEqual([
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
    ]);
  });

  it("parses text-formatted PostHog MCP resource responses", async () => {
    const toolClient: McpToolClient = {
      async callTool(name, args) {
        if (name === "dashboard-create") {
          return [
            "id: 1674173",
            `name: ${args.name}`,
            '_posthogUrl: "https://us.posthog.com/project/212567/dashboard/1674173"',
          ].join("\n");
        }
        if (name === "insight-create") {
          expect(args.dashboards).toEqual([1674173]);
          return [
            "id: 991",
            `name: ${args.name}`,
            '_posthogUrl: "https://us.posthog.com/project/212567/insights/991"',
          ].join("\n");
        }
        return {};
      },
    };
    const gateway = new PostHogMcpGateway({ toolClient });

    const dashboard = await gateway.createDashboard({
      projectId: "212567",
      name: "Widget Adoption",
    });
    const insight = await gateway.createInsight({
      projectId: "212567",
      dashboardId: dashboard.id,
      name: "Widget sessions",
      type: "trend",
      sourceEvents: ["widget_session_started"],
    });

    expect(dashboard).toEqual({
      type: "dashboard",
      id: "1674173",
      name: "Widget Adoption",
      url: "https://us.posthog.com/project/212567/dashboard/1674173",
    });
    expect(insight).toMatchObject({
      type: "insight",
      id: "991",
      url: "https://us.posthog.com/project/212567/insights/991",
    });
  });
});
