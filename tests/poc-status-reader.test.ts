import { PocStatusReader } from "../src/status/poc-status-reader.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import type { PocPlan, PocRecord, PocRequirements, SetupResult } from "../src/contracts.js";

describe("PocStatusReader", () => {
  it("lists recent PoCs without exposing raw source text", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record("poc_old", "2026-06-04T00:00:00.000Z"));
    await store.createPoc(record("poc_new", "2026-06-04T00:10:00.000Z"));
    await store.saveRequirements(requirements("poc_new"));
    await store.savePlan(plan("poc_new"));
    await store.saveSetupResult(setupResult("poc_new"));

    const reader = new PocStatusReader(store);
    const result = await reader.list({ limit: 1 });

    expect(result.pocs).toEqual([
      expect.objectContaining({
        pocId: "poc_new",
        status: "intake_received",
        customerCompany: "Acme",
        hasRequirements: true,
        hasActivePlan: true,
        hasSetupResult: true,
        setupStatus: "succeeded",
        validationStatus: "pass",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Sensitive discovery transcript");
  });

  it("returns full operator detail for a PoC", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record("poc_123", "2026-06-04T00:00:00.000Z"));
    await store.saveRequirements(requirements("poc_123"));
    await store.savePlan(plan("poc_123"));

    const reader = new PocStatusReader(store);
    const result = await reader.detail("poc_123");

    expect(result).toMatchObject({
      pocId: "poc_123",
      customerSlug: "acme",
      objective: "Evaluate signup activation analytics.",
      requirements: {
        businessGoal: "Evaluate signup activation analytics.",
      },
      activePlan: {
        version: 1,
      },
    });
  });
});

function record(pocId: string, updatedAt: string): PocRecord {
  return {
    pocId,
    status: "intake_received",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt,
    sourceText: "Sensitive discovery transcript",
  };
}

function requirements(pocId: string): PocRequirements {
  return {
    pocId,
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

function plan(pocId: string): PocPlan {
  return {
    pocId,
    version: 1,
    status: "sent_for_confirmation",
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

function setupResult(pocId: string): SetupResult {
  return {
    pocId,
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
    validationReport: {
      pocId,
      status: "pass",
      checkedAt: "2026-06-04T00:10:00.000Z",
      checks: [],
      summary: "All checks passed.",
      knownGaps: [],
    },
    auditEventIds: [],
  };
}
