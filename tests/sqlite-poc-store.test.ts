import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqlitePocStore } from "../src/state/sqlite-poc-store.js";
import type {
  PocMonitoringReport,
  PocPlan,
  PocRecord,
  PocRequirements,
  SetupResult,
} from "../src/contracts.js";

describe("SqlitePocStore", () => {
  it("persists PoC state across store instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-poc-store-"));
    const path = join(dir, "pocs.sqlite");

    try {
      const first = new SqlitePocStore(path);
      await first.createPoc(record());
      await first.saveRequirements(requirements());
      await first.savePlan(plan());
      await first.saveSetupResult(setupResult());
      await first.saveMonitoringReport(monitoringReport("monitor-run-1", "at_risk"));
      await first.saveMonitoringReport(monitoringReport("monitor-run-2", "criteria_met"));
      await first.updateStatus("poc_123", "handoff_sent", "2026-06-04T00:10:00.000Z");
      first.close();

      const second = new SqlitePocStore(path);

      expect(await second.getPoc("poc_123")).toMatchObject({
        pocId: "poc_123",
        status: "handoff_sent",
        activePlanVersion: 1,
      });
      expect((await second.getRequirements("poc_123"))?.businessGoal).toBe(
        "Evaluate signup activation analytics.",
      );
      expect((await second.getPlan("poc_123", 1))?.posthogTarget.projectId).toBe("project-1");
      expect((await second.getSetupResult("poc_123"))?.posthog.projectId).toBe("project-1");
      expect((await second.getLatestMonitoringReport("poc_123"))?.runId).toBe("monitor-run-2");
      expect((await second.listMonitoringReports("poc_123")).map((report) => report.runId)).toEqual(
        ["monitor-run-2", "monitor-run-1"],
      );
      expect((await second.listPocs()).map((poc) => poc.pocId)).toEqual(["poc_123"]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updates existing monitoring reports by run ID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-poc-store-"));
    const path = join(dir, "pocs.sqlite");

    try {
      const store = new SqlitePocStore(path);
      await store.createPoc(record());
      await store.saveMonitoringReport(monitoringReport("monitor-run-1", "inactive"));
      await store.saveMonitoringReport(monitoringReport("monitor-run-1", "criteria_met"));

      const reports = await store.listMonitoringReports("poc_123");

      expect(reports).toHaveLength(1);
      expect(reports[0]?.status).toBe("criteria_met");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function record(): PocRecord {
  return {
    pocId: "poc_123",
    status: "intake_received",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    sourceText: "Acme wants PostHog.",
  };
}

function monitoringReport(
  runId: string,
  status: PocMonitoringReport["status"],
): PocMonitoringReport {
  return {
    pocId: "poc_123",
    planVersion: 1,
    runId,
    checkedAt:
      runId === "monitor-run-1" && status !== "criteria_met"
        ? "2026-06-05T00:00:00.000Z"
        : "2026-06-05T12:00:00.000Z",
    window: {
      from: "2026-06-05T00:00:00.000Z",
      to: "2026-06-05T12:00:00.000Z",
    },
    status,
    riskLevel: status === "criteria_met" ? "none" : "medium",
    usageSummary: {
      hasRealCustomerActivity: status === "criteria_met",
      syntheticOnly: false,
      totalEvents: status === "criteria_met" ? 5 : 0,
      uniqueUsers: status === "criteria_met" ? 2 : 0,
    },
    eventProgress: [],
    successCriteriaProgress: [],
    planDrift: {
      missingExpectedEvents: [],
      unexpectedObservedEvents: [],
      notes: [],
    },
    recommendedActions: [],
  };
}

function requirements(): PocRequirements {
  return {
    pocId: "poc_123",
    product: "posthog",
    customer: {
      companyName: "Acme",
      companySlug: "acme",
      contacts: [{ email: "buyer@acme.test", isPrimary: true }],
    },
    businessGoal: "Evaluate signup activation analytics.",
    successCriteria: ["Track signup funnel"],
    appContext: { platform: ["web"] },
    analyticsScope: {
      events: [
        { name: "signup_completed", description: "A user completes signup", required: true },
      ],
    },
    assumptions: [],
    openQuestions: [],
    source: {
      sourceKind: "api",
      receivedAt: "2026-06-04T00:00:00.000Z",
    },
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
    successCriteria: ["Track signup funnel"],
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
        { name: "signup_completed", description: "A user completes signup", required: true },
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

function setupResult(): SetupResult {
  return {
    pocId: "poc_123",
    status: "succeeded",
    posthog: {
      projectId: "project-1",
      projectName: "Acme PoC",
      projectUrl: "https://posthog.example.test/project/project-1",
      hostUrl: "https://us.i.posthog.com",
    },
    createdResources: [],
    updatedResources: [],
    skippedResources: [],
    credentialRefs: [],
    sdkInstructions: [],
    knownGaps: [],
    auditEventIds: [],
  };
}
