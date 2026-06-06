import { PostHogPocSetupAgent } from "../src/posthog/posthog-poc-setup-agent.js";
import type {
  PostHogEventCaptureTool,
  PostHogSyntheticEventVerifier,
  PostHogToolGateway,
  SecretsTool,
  ValidationTool,
  AuditTool,
} from "../src/tools/types.js";
import type { PocPlan, PosthogResourceRef } from "../src/contracts.js";
import type { LlmJsonClient } from "../src/llm/types.js";

type OptionalAssetGateway = PostHogToolGateway & {
  createCohort(input: {
    projectId: string;
    name: string;
    description?: string;
    criteria: string;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createFeatureFlag(input: {
    projectId: string;
    key: string;
    name: string;
    description?: string;
    rollout?: { percentage?: number; conditions?: string };
    testUsers?: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createExperiment(input: {
    projectId: string;
    name: string;
    hypothesis: string;
    variants: string[];
    primaryMetric: string;
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createSurvey(input: {
    projectId: string;
    name: string;
    questions: PocPlan["setup"]["surveys"][number]["questions"];
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createAlert(input: {
    projectId: string;
    name: string;
    condition: string;
    destination?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
};

describe("PostHogPocSetupAgent", () => {
  it("creates approved PostHog resources and validates the setup", async () => {
    const calls: string[] = [];
    const posthog: OptionalAssetGateway = {
      async getProject(projectId) {
        calls.push(`getProject:${projectId}`);
        return {
          id: projectId,
          name: "Acme PoC",
          url: "https://us.posthog.com/project/123",
          hostUrl: "https://us.i.posthog.com",
        };
      },
      async updateProjectSettings() {
        calls.push("updateProjectSettings");
      },
      async createAction(input) {
        calls.push(`createAction:${input.name}`);
        return { type: "action", id: "action-1", name: input.name };
      },
      async createDashboard(input) {
        calls.push(`createDashboard:${input.name}`);
        return {
          type: "dashboard",
          id: "dashboard-1",
          name: input.name,
          url: "https://us.posthog.com/dashboard/1",
        };
      },
      async createInsight(input) {
        calls.push(`createInsight:${input.name}`);
        return { type: "insight", id: "insight-1", name: input.name };
      },
      async createCohort(input) {
        calls.push(`createCohort:${input.name}`);
        return { type: "cohort", id: "cohort-1", name: input.name };
      },
      async createFeatureFlag(input) {
        calls.push(`createFeatureFlag:${input.key}`);
        return { type: "feature_flag", id: "flag-1", name: input.name };
      },
      async createExperiment(input) {
        calls.push(`createExperiment:${input.name}`);
        return { type: "experiment", id: "experiment-1", name: input.name };
      },
      async createSurvey(input) {
        calls.push(`createSurvey:${input.name}`);
        return { type: "survey", id: "survey-1", name: input.name };
      },
      async createAlert(input) {
        calls.push(`createAlert:${input.name}`);
        return { type: "alert", id: "alert-1", name: input.name };
      },
    };
    const secrets: SecretsTool = {
      async createSecret(input) {
        calls.push(`createSecret:${input.name}`);
        return { secretRef: "secret-1", expiresAt: "2026-06-11T00:00:00.000Z" };
      },
      async createOneTimeSecretLink() {
        calls.push("createOneTimeSecretLink");
        return {
          url: "https://secrets.test/one-time",
          expiresAt: "2026-06-11T00:00:00.000Z",
        };
      },
      async consumeOneTimeSecretLink() {
        return { status: "not_found" };
      },
      async rotateOrRevokeSecret() {
        return { success: true };
      },
    };
    const validation: ValidationTool = {
      async validatePosthogSetup(input) {
        calls.push(`validate:${input.pocId}`);
        expect(input.syntheticEventCapture).toMatchObject({
          status: "sent",
          eventsSent: 1,
          eventNames: ["signup_completed"],
        });
        expect(input.syntheticEventVisibility).toMatchObject({
          status: "visible",
          visibleEventNames: ["signup_completed"],
        });
        return {
          pocId: input.pocId,
          status: "pass",
          checkedAt: "2026-06-04T00:00:00.000Z",
          summary: "All checks passed.",
          checks: [{ id: "dashboard", name: "Dashboard exists", status: "pass" }],
          knownGaps: [],
        };
      },
    };
    const eventCapture: PostHogEventCaptureTool = {
      async captureSyntheticEvents(input) {
        calls.push(`captureSyntheticEvents:${input.events.map((event) => event.name).join(",")}`);
        return {
          status: "sent",
          requestedEventCount: input.events.length,
          eventsSent: input.events.length,
          eventNames: input.events.map((event) => event.name),
          capturedAt: "2026-06-04T00:00:00.000Z",
        };
      },
    };
    const syntheticEventVerifier: PostHogSyntheticEventVerifier = {
      async verifySyntheticEvents(input) {
        calls.push(`verifySyntheticEvents:${input.eventNames.join(",")}`);
        return {
          status: "visible",
          requestedEventCount: input.eventNames.length,
          visibleEventCount: input.eventNames.length,
          missingEventNames: [],
          visibleEventNames: input.eventNames,
          attempts: 1,
          checkedAt: "2026-06-04T00:00:00.000Z",
        };
      },
    };
    const audit: AuditTool = {
      async writeAuditLog() {
        return { auditEventId: "audit-1" };
      },
    };

    const agent = new PostHogPocSetupAgent({
      posthog,
      secrets,
      validation,
      eventCapture,
      syntheticEventVerifier,
      audit,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const plan: PocPlan = {
      pocId: "poc_123",
      version: 1,
      status: "approved",
      product: "posthog",
      customer: {
        companyName: "Acme",
        companySlug: "acme",
        contacts: [{ email: "buyer@acme.test", isPrimary: true }],
      },
      objective: "Evaluate signup activation analytics.",
      successCriteria: ["Track signup funnel"],
      assumptions: [],
      openQuestions: [],
      posthogTarget: {
        projectId: "123",
        projectName: "Acme PoC",
        projectStrategy: "precreated_blank_project",
      },
      setup: {
        projectSettings: { timezone: "UTC" },
        events: [
          {
            name: "signup_completed",
            description: "A user completes signup",
            required: true,
          },
        ],
        actions: [
          {
            name: "Completed signup",
            description: "User completed signup",
            matchEvents: ["signup_completed"],
          },
        ],
        dashboards: [
          {
            name: "PoC - Acme - poc_123",
            tiles: [{ title: "Signup funnel", type: "funnel", sourceEvents: ["signup_completed"] }],
          },
        ],
        cohorts: [
          {
            name: "Activated users",
            description: "Users who completed signup",
            criteria: "event = signup_completed",
          },
        ],
        featureFlags: [
          {
            key: "poc-onboarding",
            name: "PoC onboarding",
            description: "Enable onboarding variant for PoC testers",
            rollout: { percentage: 25, conditions: "email domain is acme.test" },
            testUsers: ["buyer@acme.test"],
          },
        ],
        experiments: [
          {
            name: "Signup onboarding test",
            hypothesis: "Guided onboarding increases signup completion.",
            variants: ["control", "guided"],
            primaryMetric: "signup_completed",
            launchDuringPoC: false,
          },
        ],
        surveys: [
          {
            name: "PoC feedback",
            questions: [{ prompt: "Was this setup useful?", type: "rating" }],
            launchDuringPoC: true,
          },
        ],
        alerts: [
          {
            name: "Signup drop alert",
            condition: "signup_completed drops below 10 per day",
            destination: "buyer@acme.test",
          },
        ],
      },
      validationPlan: {
        syntheticEvents: [
          {
            name: "signup_completed",
            description: "Synthetic signup completion",
            required: true,
          },
        ],
        requiredChecks: ["dashboard"],
        acceptanceThreshold: "all_pass",
      },
      handoffPlan: {
        recipients: ["buyer@acme.test"],
        includeSdkInstructions: true,
        includeTestingPlan: true,
        includeCredentialLinks: true,
      },
      approval: {
        approvedBy: "buyer@acme.test",
        approvedAt: "2026-06-04T00:00:00.000Z",
        approvalSource: "email_reply",
      },
    };

    const result = await agent.setup(plan);

    expect(result.status).toBe("succeeded");
    expect(result.posthog.projectUrl).toBe("https://us.posthog.com/project/123");
    expect(result.createdResources.map((resource) => resource.type)).toEqual([
      "action",
      "dashboard",
      "insight",
      "cohort",
      "feature_flag",
      "experiment",
      "survey",
    ]);
    expect(result.skippedResources).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining("Alert creation requires"),
        resource: { type: "alert", name: "Signup drop alert" },
      }),
    ]);
    expect(result.credentialRefs[0]).toMatchObject({
      name: "posthog_project_access",
      oneTimeLink: "https://secrets.test/one-time",
    });
    expect(result.validationReport?.status).toBe("pass");
    expect(calls).toContain("captureSyntheticEvents:signup_completed");
    expect(calls).toContain("verifySyntheticEvents:signup_completed");
    expect(calls).toContain("validate:poc_123");
    expect(calls).toContain("createCohort:Activated users");
    expect(calls).toContain("createFeatureFlag:poc-onboarding");
    expect(calls).toContain("createExperiment:Signup onboarding test");
    expect(calls).toContain("createSurvey:PoC feedback");
    expect(calls).not.toContain("createAlert:Signup drop alert");
  });

  it("returns a failed setup result when a PostHog MCP call fails", async () => {
    const auditEvents: unknown[] = [];
    const agent = new PostHogPocSetupAgent({
      posthog: {
        async getProject() {
          throw new Error("MCP tool project-get failed: forbidden");
        },
        async updateProjectSettings() {
          throw new Error("should not update settings");
        },
        async createAction() {
          throw new Error("should not create actions");
        },
        async createDashboard() {
          throw new Error("should not create dashboards");
        },
        async createInsight() {
          throw new Error("should not create insights");
        },
      },
      secrets: {
        async createSecret() {
          throw new Error("should not create secrets");
        },
        async createOneTimeSecretLink() {
          throw new Error("should not create secret links");
        },
        async consumeOneTimeSecretLink() {
          return { status: "not_found" };
        },
        async rotateOrRevokeSecret() {
          return { success: true };
        },
      },
      validation: {
        async validatePosthogSetup() {
          throw new Error("should not run validation after project read failure");
        },
      },
      audit: {
        async writeAuditLog(input) {
          auditEvents.push(input);
          return { auditEventId: `audit-${auditEvents.length}` };
        },
      },
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const result = await agent.setup(minimalApprovedPlan());

    expect(result).toMatchObject({
      pocId: "poc_123",
      status: "failed",
      posthog: {
        projectId: "123",
        projectName: "Acme PoC",
        projectUrl: "",
        hostUrl: "",
      },
      createdResources: [],
      updatedResources: [],
      skippedResources: [],
      credentialRefs: [],
      sdkInstructions: [],
      knownGaps: ["PostHog setup failed: MCP tool project-get failed: forbidden"],
      validationReport: {
        status: "fail",
        summary: "PostHog setup failed before validation could complete.",
      },
    });
    expect(result.validationReport?.checks).toEqual([
      expect.objectContaining({
        id: "setup-exception",
        status: "fail",
        error: "MCP tool project-get failed: forbidden",
      }),
    ]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: "setup_failed",
        status: "failed",
        error: "MCP tool project-get failed: forbidden",
      }),
    );
  });

  it("asks DeepSeek for an agentic dashboard and writes only SQL-validated tiles", async () => {
    const calls: string[] = [];
    const insightQueries: unknown[] = [];
    const posthog: PostHogToolGateway = {
      async getProject(projectId) {
        calls.push(`getProject:${projectId}`);
        return {
          id: projectId,
          name: "Widget PoC",
          url: "https://us.posthog.com/project/123",
          hostUrl: "https://us.i.posthog.com",
        };
      },
      async updateProjectSettings() {
        calls.push("updateProjectSettings");
      },
      async createAction(input) {
        calls.push(`createAction:${input.name}`);
        return { type: "action", id: "action-1", name: input.name };
      },
      async createDashboard(input) {
        calls.push(`createDashboard:${input.name}`);
        return { type: "dashboard", id: "dashboard-1", name: input.name };
      },
      async createInsight(input) {
        calls.push(`createInsight:${input.name}`);
        insightQueries.push(input.query);
        return { type: "insight", id: `insight-${insightQueries.length}`, name: input.name };
      },
      async readDataSchema() {
        calls.push("readDataSchema");
        return { events: ["widget_session_started", "widget_email_captured"] };
      },
      async executeSql(input) {
        calls.push(`executeSql:${input.query}`);
        if (input.query.includes("bad_metric")) {
          throw new Error("Unknown identifier bad_metric");
        }
        return { rows: [] };
      },
    };
    const llm: LlmJsonClient = {
      async completeJson(input) {
        calls.push(`llm:${input.model}`);
        expect(input.user).toContain("widget_session_started");
        return {
          dashboardName: "Widget PM Adoption",
          dashboardDescription: "PM adoption dashboard generated from live evidence.",
          clarificationRequired: false,
          clarificationQuestions: [],
          notes: ["Uses live event evidence."],
          tiles: [
            {
              title: "Sessions by landing page",
              description: "Shows where visitors start widget sessions.",
              validationSql:
                "SELECT properties['$current_url'] AS url, count() AS sessions FROM events WHERE event = 'widget_session_started' GROUP BY url",
              insightQuery: {
                kind: "DataVisualizationNode",
                source: {
                  kind: "HogQLQuery",
                  query:
                    "SELECT properties['$current_url'] AS url, count() AS sessions FROM events WHERE event = 'widget_session_started' GROUP BY url",
                },
              },
            },
            {
              title: "Daily widget sessions",
              description: "Shows session volume over time.",
              validationSql:
                "SELECT toDate(timestamp) AS day, count() AS sessions FROM events WHERE event = 'widget_session_started' GROUP BY day ORDER BY day",
              insightQuery: {
                kind: "DataVisualizationNode",
                source: {
                  kind: "HogQLQuery",
                  query:
                    "SELECT toDate(timestamp) AS day, count() AS sessions FROM events WHERE event = 'widget_session_started' GROUP BY day ORDER BY day",
                },
              },
            },
            {
              title: "Bad generated metric",
              validationSql: "SELECT bad_metric FROM events",
              insightQuery: {
                kind: "DataVisualizationNode",
                source: { kind: "HogQLQuery", query: "SELECT bad_metric FROM events" },
              },
            },
          ],
        };
      },
    };

    const agent = new PostHogPocSetupAgent({
      posthog,
      llm,
      secrets: memorySecrets(calls),
      validation: passValidation(),
      audit: memoryAudit(),
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
    });
    const plan = {
      ...minimalApprovedPlan(),
      objective: "Measure widget adoption by landing page.",
      setup: {
        ...minimalApprovedPlan().setup,
        dashboards: [
          {
            name: "Widget Adoption",
            description: "PM dashboard",
            tiles: [],
          },
        ],
      },
    };

    const result = await agent.setup(plan);

    expect(result.status).toBe("succeeded");
    expect(calls).toContain("llm:deepseek-v4-flash");
    expect(calls).toContain("createDashboard:Widget PM Adoption");
    expect(calls).toContain("createInsight:poc_123: Sessions by landing page");
    expect(calls).toContain("createInsight:poc_123: Daily widget sessions");
    expect(calls).not.toContain("createInsight:poc_123: Bad generated metric");
    expect(insightQueries).toEqual([
      expect.objectContaining({
        kind: "DataVisualizationNode",
        display: "ActionsBar",
        chartSettings: expect.objectContaining({
          xAxis: { column: "url" },
          yAxis: [{ column: "sessions" }],
        }),
      }),
      expect.objectContaining({
        kind: "DataVisualizationNode",
        display: "ActionsLineGraph",
        chartSettings: expect.objectContaining({
          xAxis: { column: "day" },
          yAxis: [{ column: "sessions" }],
        }),
      }),
    ]);
    expect(result.skippedResources).toContainEqual(
      expect.objectContaining({
        resource: { type: "insight", name: "poc_123: Bad generated metric" },
        reason: expect.stringContaining("Unknown identifier bad_metric"),
      }),
    );
  });
});

function memorySecrets(calls: string[]): SecretsTool {
  return {
    async createSecret(input) {
      calls.push(`createSecret:${input.name}`);
      return { secretRef: "secret-1", expiresAt: "2026-06-11T00:00:00.000Z" };
    },
    async createOneTimeSecretLink() {
      calls.push("createOneTimeSecretLink");
      return {
        url: "https://secrets.test/one-time",
        expiresAt: "2026-06-11T00:00:00.000Z",
      };
    },
    async consumeOneTimeSecretLink() {
      return { status: "not_found" };
    },
    async rotateOrRevokeSecret() {
      return { success: true };
    },
  };
}

function passValidation(): ValidationTool {
  return {
    async validatePosthogSetup(input) {
      return {
        pocId: input.pocId,
        status: "pass",
        checkedAt: "2026-06-04T00:00:00.000Z",
        summary: "All checks passed.",
        checks: [{ id: "dashboard", name: "Dashboard exists", status: "pass" }],
        knownGaps: [],
      };
    },
  };
}

function memoryAudit(): AuditTool {
  return {
    async writeAuditLog() {
      return { auditEventId: "audit-1" };
    },
  };
}

function minimalApprovedPlan(): PocPlan {
  return {
    pocId: "poc_123",
    version: 1,
    status: "approved",
    product: "posthog",
    customer: {
      companyName: "Acme",
      companySlug: "acme",
      contacts: [{ email: "buyer@acme.test", isPrimary: true }],
    },
    objective: "Evaluate signup activation analytics.",
    successCriteria: ["Track signup funnel"],
    assumptions: [],
    openQuestions: [],
    posthogTarget: {
      projectId: "123",
      projectName: "Acme PoC",
      projectStrategy: "precreated_blank_project",
    },
    setup: {
      projectSettings: { timezone: "UTC" },
      events: [
        {
          name: "signup_completed",
          description: "A user completes signup",
          required: true,
        },
      ],
      actions: [
        {
          name: "Completed signup",
          description: "User completed signup",
          matchEvents: ["signup_completed"],
        },
      ],
      dashboards: [],
      cohorts: [],
      featureFlags: [],
      experiments: [],
      surveys: [],
      alerts: [],
    },
    validationPlan: {
      syntheticEvents: [],
      requiredChecks: ["project"],
      acceptanceThreshold: "all_pass",
    },
    handoffPlan: {
      recipients: ["buyer@acme.test"],
      includeSdkInstructions: true,
      includeTestingPlan: true,
      includeCredentialLinks: true,
    },
    approval: {
      approvedBy: "buyer@acme.test",
      approvedAt: "2026-06-04T00:00:00.000Z",
      approvalSource: "email_reply",
    },
  };
}
