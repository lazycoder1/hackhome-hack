import type { JsonCompletionInput, LlmJsonClient } from "../src/llm/types.js";
import type { PocMonitoringReport, PocPlan } from "../src/contracts.js";
import { NudgeDrafter } from "../src/monitoring/nudge-drafter.js";
import { decide } from "../src/monitoring/decide.js";

function plan(): PocPlan {
  return {
    pocId: "poc_1",
    version: 1,
    status: "approved",
    product: "posthog",
    customer: { companyName: "Acme", companySlug: "acme", contacts: [{ email: "buyer@acme.test" }] },
    objective: "Evaluate signup activation.",
    successCriteria: ["Track signup funnel"],
    assumptions: [],
    openQuestions: [],
    posthogTarget: { projectId: "p1", projectName: "Acme PoC", projectStrategy: "existing_project" },
    setup: {
      projectSettings: {},
      events: [],
      actions: [],
      dashboards: [],
      cohorts: [],
      featureFlags: [],
      experiments: [],
      surveys: [],
      alerts: [],
    },
    validationPlan: { syntheticEvents: [], requiredChecks: [], acceptanceThreshold: "all_pass" },
    handoffPlan: {
      recipients: ["buyer@acme.test"],
      includeSdkInstructions: true,
      includeTestingPlan: true,
      includeCredentialLinks: true,
    },
    approval: {},
  };
}

function report(): PocMonitoringReport {
  return {
    pocId: "poc_1",
    planVersion: 1,
    runId: "run_1",
    checkedAt: "2026-06-05T12:00:00.000Z",
    window: { from: "2026-06-04T12:00:00.000Z", to: "2026-06-05T12:00:00.000Z" },
    status: "inactive",
    riskLevel: "high",
    usageSummary: { hasRealCustomerActivity: false, syntheticOnly: false },
    eventProgress: [],
    successCriteriaProgress: [{ criterion: "Track signup funnel", status: "not_met", evidence: [] }],
    planDrift: {
      missingExpectedEvents: ["signup_completed"],
      unexpectedObservedEvents: [],
      notes: [],
    },
    recommendedActions: [],
    followUpDraft: {
      audience: "customer",
      subject: "Deterministic fallback subject",
      markdownBody: "Deterministic fallback body",
    },
  };
}

describe("NudgeDrafter (LLM-activated path)", () => {
  it("drafts a customer nudge with criteria + missing-events + prior-touch context in the prompt", async () => {
    let captured: JsonCompletionInput | undefined;
    const llm: LlmJsonClient = {
      async completeJson(input) {
        captured = input;
        return { subject: "Let's get your test moving", markdownBody: "Hi Acme..." };
      },
    };
    const drafter = new NudgeDrafter({ llm });
    const [action] = decide(report());

    const draft = await drafter.draftCustomerAction({
      plan: plan(),
      report: report(),
      action,
      priorTouches: 2,
    });

    expect(draft.source).toBe("llm");
    expect(draft.subject).toBe("Let's get your test moving");
    expect(captured?.user).toContain("successCriteriaProgress");
    expect(captured?.user).toContain("missingExpectedEvents");
    expect(captured?.user).toContain("priorTouches");
    expect(captured?.user).toContain("2");
  });

  it("falls back to the deterministic draft when the LLM errors", async () => {
    const llm: LlmJsonClient = {
      async completeJson() {
        throw new Error("model down");
      },
    };
    const drafter = new NudgeDrafter({ llm });
    const [action] = decide(report());

    const draft = await drafter.draftCustomerAction({
      plan: plan(),
      report: report(),
      action,
      priorTouches: 0,
    });

    expect(draft.source).toBe("fallback");
    expect(draft.subject).toBe("Deterministic fallback subject");
  });

  it("falls back when the LLM returns a malformed shape", async () => {
    const llm: LlmJsonClient = {
      async completeJson() {
        return { nope: true };
      },
    };
    const drafter = new NudgeDrafter({ llm });
    const [action] = decide(report());
    const draft = await drafter.draftCustomerAction({
      plan: plan(),
      report: report(),
      action,
      priorTouches: 0,
    });
    expect(draft.source).toBe("fallback");
  });
});
