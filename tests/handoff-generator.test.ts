import { HandoffGenerator } from "../src/handoff/handoff-generator.js";
import type { PocPlan, SetupResult } from "../src/contracts.js";

describe("HandoffGenerator", () => {
  it("creates a customer handoff email with testing plan, links, and validation status", () => {
    const generator = new HandoffGenerator();
    const plan = approvedPlan();
    const result = setupResult();

    const handoff = generator.generate({ plan, setupResult: result });

    expect(handoff.recipients).toEqual(["buyer@acme.test"]);
    expect(handoff.subject).toBe("Your PostHog PoC is ready: testing plan and access details");
    expect(handoff.markdownBody).toContain("https://us.posthog.com/project/123");
    expect(handoff.markdownBody).toContain("https://us.posthog.com/dashboard/1");
    expect(handoff.markdownBody).toContain("https://secrets.test/one-time");
    expect(handoff.markdownBody).toContain("Status: pass");
    expect(handoff.markdownBody).toContain("### Test 1: SDK initialization");
    expect(handoff.links.map((link) => link.kind)).toEqual([
      "posthog_project",
      "dashboard",
      "secret",
    ]);
    expect(handoff.securityReview.containsRawSecrets).toBe(false);
  });

  it("rejects handoff bodies that contain raw secret values", () => {
    const generator = new HandoffGenerator();

    expect(() =>
      generator.generate({
        plan: approvedPlan(),
        setupResult: setupResult(),
        forbiddenSecrets: ["raw-secret-value"],
        extraNotes: "Do not do this: raw-secret-value",
      }),
    ).toThrow(/raw secret/i);
  });
});

function approvedPlan(): PocPlan {
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
      projectSettings: {},
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
      reviewDate: "2026-06-10",
      teardownDate: "2026-06-30",
    },
    approval: {
      approvedBy: "buyer@acme.test",
      approvedAt: "2026-06-04T00:00:00.000Z",
      approvalSource: "approval_link",
    },
  };
}

function setupResult(): SetupResult {
  return {
    pocId: "poc_123",
    status: "succeeded",
    posthog: {
      projectId: "123",
      projectName: "Acme PoC",
      projectUrl: "https://us.posthog.com/project/123",
      hostUrl: "https://us.i.posthog.com",
    },
    createdResources: [
      {
        type: "dashboard",
        id: "dashboard-1",
        name: "PoC - Acme",
        url: "https://us.posthog.com/dashboard/1",
      },
    ],
    updatedResources: [],
    skippedResources: [],
    credentialRefs: [
      {
        name: "posthog_project_access",
        secretRef: "secret-1",
        oneTimeLink: "https://secrets.test/one-time",
        expiresAt: "2026-06-11T00:00:00.000Z",
      },
    ],
    sdkInstructions: [
      {
        platform: "web",
        markdown: "Initialize PostHog with host `https://us.i.posthog.com`.",
      },
    ],
    knownGaps: [],
    validationReport: {
      pocId: "poc_123",
      status: "pass",
      checkedAt: "2026-06-04T00:00:00.000Z",
      summary: "All checks passed.",
      checks: [{ id: "dashboard", name: "Dashboard exists", status: "pass" }],
      knownGaps: [],
    },
    auditEventIds: ["audit-1"],
  };
}
