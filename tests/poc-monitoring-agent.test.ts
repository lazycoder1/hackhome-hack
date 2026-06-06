import { PocMonitoringAgent } from "../src/monitoring/poc-monitoring-agent.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import { InMemoryAuditTool } from "../src/tools/in-memory-tools.js";
import type { PocPlan, PocRecord, SetupResult, PosthogResourceRef } from "../src/contracts.js";
import type { PostHogUsageSnapshotTool } from "../src/tools/types.js";

describe("PocMonitoringAgent", () => {
  it("marks an active PoC as criteria met when required events have customer activity", async () => {
    const store = new InMemoryPocStore();
    const audit = new InMemoryAuditTool({ clock });
    await seedActivePoc(store);

    const usageSnapshotTool: PostHogUsageSnapshotTool = {
      async collectPosthogUsageSnapshot(input) {
        expect(input).toMatchObject({
          pocId: "poc_123",
          posthogProjectId: "project-1",
          expectedEvents: ["signup_started", "signup_completed"],
        });

        return {
          totalEvents: 18,
          uniqueUsers: 4,
          lastEventAt: "2026-06-05T10:00:00.000Z",
          events: [
            {
              eventName: "signup_started",
              count: 12,
              uniqueUsers: 4,
              firstSeenAt: "2026-06-05T09:00:00.000Z",
              lastSeenAt: "2026-06-05T10:00:00.000Z",
              syntheticCount: 0,
            },
            {
              eventName: "signup_completed",
              count: 6,
              uniqueUsers: 3,
              firstSeenAt: "2026-06-05T09:05:00.000Z",
              lastSeenAt: "2026-06-05T10:00:00.000Z",
              syntheticCount: 0,
            },
          ],
          dashboardActivity: [
            {
              dashboardId: "dashboard-1",
              lastViewedAt: "2026-06-05T09:30:00.000Z",
              widgetsRunning: true,
            },
          ],
        };
      },
    };
    const agent = new PocMonitoringAgent({
      store,
      usageSnapshotTool,
      audit,
      clock,
      runIdGenerator: () => "monitor-run-1",
    });

    const report = await agent.monitor({
      pocId: "poc_123",
      window: {
        from: "2026-06-05T00:00:00.000Z",
        to: "2026-06-05T12:00:00.000Z",
      },
    });

    expect(report).toMatchObject({
      pocId: "poc_123",
      planVersion: 1,
      runId: "monitor-run-1",
      status: "criteria_met",
      riskLevel: "none",
      usageSummary: {
        hasRealCustomerActivity: true,
        syntheticOnly: false,
        totalEvents: 18,
        uniqueUsers: 4,
      },
      planDrift: {
        missingExpectedEvents: [],
      },
    });
    expect(report.successCriteriaProgress).toEqual([
      expect.objectContaining({
        criterion: "Track signup funnel end to end",
        status: "met",
      }),
    ]);
    expect(report.recommendedActions).toContainEqual(
      expect.objectContaining({ owner: "operator", action: "mark_success" }),
    );
    expect((await store.getLatestMonitoringReport("poc_123"))?.runId).toBe("monitor-run-1");
    expect((await store.getPoc("poc_123"))?.status).toBe("monitoring_criteria_met");
    expect(audit.events).toContainEqual(
      expect.objectContaining({
        action: "monitor_poc_success",
        status: "succeeded",
      }),
    );
  });

  it("flags an inactive PoC as at risk when real customer activity is absent", async () => {
    const store = new InMemoryPocStore();
    await seedActivePoc(store);
    const agent = new PocMonitoringAgent({
      store,
      usageSnapshotTool: {
        async collectPosthogUsageSnapshot() {
          return {
            totalEvents: 0,
            uniqueUsers: 0,
            events: [],
          };
        },
      },
      audit: new InMemoryAuditTool({ clock }),
      clock,
      runIdGenerator: () => "monitor-run-2",
    });

    const report = await agent.monitor({ pocId: "poc_123" });

    expect(report.status).toBe("inactive");
    expect(report.riskLevel).toBe("high");
    expect(report.usageSummary).toMatchObject({
      hasRealCustomerActivity: false,
      syntheticOnly: false,
      totalEvents: 0,
      uniqueUsers: 0,
    });
    expect(report.eventProgress).toEqual([
      expect.objectContaining({
        eventName: "signup_started",
        count: 0,
        source: "unknown",
      }),
      expect.objectContaining({
        eventName: "signup_completed",
        count: 0,
        source: "unknown",
      }),
    ]);
    expect(report.successCriteriaProgress).toEqual([
      expect.objectContaining({
        criterion: "Track signup funnel end to end",
        status: "not_met",
      }),
    ]);
    expect(report.planDrift.missingExpectedEvents).toEqual(["signup_started", "signup_completed"]);
    expect(report.recommendedActions).toContainEqual(
      expect.objectContaining({ owner: "customer", action: "send_reminder", urgency: "high" }),
    );
    expect((await store.getPoc("poc_123"))?.status).toBe("monitoring_at_risk");
  });

  it("surfaces survey, recording, and feature-flag signals and notes inactive configured assets", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record());
    await store.savePlan(planWithAssets());
    await store.saveSetupResult(setupResult());
    const agent = new PocMonitoringAgent({
      store,
      usageSnapshotTool: {
        async collectPosthogUsageSnapshot() {
          return {
            totalEvents: 6,
            uniqueUsers: 2,
            events: [{ eventName: "signup_started", count: 6, uniqueUsers: 2, syntheticCount: 0 }],
            surveyResponses: [{ surveyId: "survey-1", responseCount: 0 }],
            sessionRecordings: { count: 0 },
            featureFlags: [{ key: "new-onboarding", evaluations: 0 }],
          };
        },
      },
      audit: new InMemoryAuditTool({ clock }),
      clock,
      runIdGenerator: () => "monitor-run-3",
    });

    const report = await agent.monitor({ pocId: "poc_123" });

    expect(report.usageSummary.surveyResponses).toEqual([
      { surveyId: "survey-1", responseCount: 0 },
    ]);
    expect(report.usageSummary.sessionRecordings).toEqual({ count: 0 });
    expect(report.usageSummary.featureFlags).toEqual([{ key: "new-onboarding", evaluations: 0 }]);
    expect(report.planDrift.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Survey"),
        expect.stringContaining("Session replay"),
        expect.stringContaining("Feature flag"),
      ]),
    );
  });
});

async function seedActivePoc(store: InMemoryPocStore): Promise<void> {
  await store.createPoc(record());
  await store.savePlan(plan());
  await store.saveSetupResult(setupResult());
}

function clock(): Date {
  return new Date("2026-06-05T12:00:00.000Z");
}

function record(): PocRecord {
  return {
    pocId: "poc_123",
    status: "active_poc",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:20:00.000Z",
    activePlanVersion: 1,
    sourceText: "Acme wants PostHog.",
  };
}

function plan(): PocPlan {
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
    successCriteria: ["Track signup funnel end to end"],
    assumptions: [],
    openQuestions: [],
    posthogTarget: {
      projectId: "project-1",
      projectName: "Acme PoC",
      projectStrategy: "existing_project",
    },
    setup: {
      projectSettings: {},
      events: [
        {
          name: "signup_started",
          description: "A user starts signup",
          required: true,
        },
        {
          name: "signup_completed",
          description: "A user completes signup",
          required: true,
        },
      ],
      actions: [
        {
          name: "Completed signup",
          description: "User completes signup",
          matchEvents: ["signup_completed"],
        },
      ],
      dashboards: [{ name: "PoC - Acme", tiles: [{ title: "Signup funnel", type: "funnel" }] }],
      cohorts: [],
      featureFlags: [],
      experiments: [],
      surveys: [],
      alerts: [],
    },
    validationPlan: {
      syntheticEvents: [],
      requiredChecks: ["dashboard"],
      acceptanceThreshold: "all_pass",
    },
    handoffPlan: {
      recipients: ["buyer@acme.test"],
      includeSdkInstructions: true,
      includeTestingPlan: true,
      includeCredentialLinks: true,
    },
    approval: {},
  };
}

function planWithAssets(): PocPlan {
  const base = plan();
  return {
    ...base,
    setup: {
      ...base.setup,
      surveys: [
        {
          name: "Onboarding NPS",
          questions: [{ prompt: "How was setup?", type: "rating" }],
          launchDuringPoC: true,
        },
      ],
      featureFlags: [{ key: "new-onboarding", name: "new-onboarding" }],
      sessionReplay: { enabled: true },
    },
  };
}

function setupResult(): SetupResult {
  const dashboard: PosthogResourceRef = {
    type: "dashboard",
    id: "dashboard-1",
    name: "PoC - Acme",
    url: "https://posthog.example.test/project/project-1/dashboard/dashboard-1",
  };

  return {
    pocId: "poc_123",
    status: "succeeded",
    posthog: {
      projectId: "project-1",
      projectName: "Acme PoC",
      projectUrl: "https://posthog.example.test/project/project-1",
      hostUrl: "https://us.i.posthog.com",
    },
    createdResources: [dashboard],
    updatedResources: [],
    skippedResources: [],
    credentialRefs: [],
    sdkInstructions: [],
    knownGaps: [],
    validationReport: {
      pocId: "poc_123",
      status: "pass",
      checkedAt: "2026-06-04T00:15:00.000Z",
      checks: [],
      summary: "All checks passed.",
      knownGaps: [],
    },
    auditEventIds: [],
  };
}
