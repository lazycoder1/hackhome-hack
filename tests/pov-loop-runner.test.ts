import type {
  PocPlan,
  PocRecord,
  PosthogResourceRef,
  PosthogUsageSnapshot,
  SetupResult,
} from "../src/contracts.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import type { PostHogUsageSnapshotTool } from "../src/tools/types.js";
import { PocMonitoringAgent } from "../src/monitoring/poc-monitoring-agent.js";
import { NudgeDrafter } from "../src/monitoring/nudge-drafter.js";
import { PovLoopRunner } from "../src/monitoring/pov-loop-runner.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import {
  InMemoryApprovalTool,
  InMemoryAuditTool,
  InMemoryEmailTool,
} from "../src/tools/in-memory-tools.js";

const clock = () => new Date("2026-06-05T12:00:00.000Z");

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
    customer: { companyName: "Acme", companySlug: "acme", contacts: [{ email: "buyer@acme.test" }] },
    objective: "Evaluate signup activation analytics.",
    successCriteria: ["Track signup funnel end to end"],
    assumptions: [],
    openQuestions: [],
    posthogTarget: { projectId: "project-1", projectName: "Acme PoC", projectStrategy: "existing_project" },
    setup: {
      projectSettings: {},
      events: [
        { name: "signup_started", description: "starts", required: true },
        { name: "signup_completed", description: "completes", required: true },
      ],
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

function setupResult(): SetupResult {
  const dashboard: PosthogResourceRef = { type: "dashboard", id: "dashboard-1", name: "PoC - Acme" };
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
    auditEventIds: [],
  };
}

function usageTool(snapshot: PosthogUsageSnapshot): PostHogUsageSnapshotTool {
  return { async collectPosthogUsageSnapshot() { return snapshot; } };
}

const INACTIVE: PosthogUsageSnapshot = { totalEvents: 0, uniqueUsers: 0, events: [] };
const ACTIVE: PosthogUsageSnapshot = {
  totalEvents: 18,
  uniqueUsers: 4,
  lastEventAt: "2026-06-05T10:00:00.000Z",
  events: [
    { eventName: "signup_started", count: 12, uniqueUsers: 4, syntheticCount: 0 },
    { eventName: "signup_completed", count: 6, uniqueUsers: 3, syntheticCount: 0 },
  ],
};
const SYNTHETIC_ONLY: PosthogUsageSnapshot = {
  totalEvents: 4,
  uniqueUsers: 1,
  events: [{ eventName: "signup_started", count: 4, uniqueUsers: 1, syntheticCount: 4 }],
};

async function makeRunner(snapshot: PosthogUsageSnapshot) {
  const store = new InMemoryPocStore();
  await store.createPoc(record());
  await store.savePlan(plan());
  await store.saveSetupResult(setupResult());

  const monitoringAgent = new PocMonitoringAgent({
    store,
    usageSnapshotTool: usageTool(snapshot),
    audit: new InMemoryAuditTool({ clock }),
    clock,
    runIdGenerator: () => "run-1",
  });
  const llm: LlmJsonClient = {
    async completeJson() {
      return { subject: "Quick check-in", markdownBody: "Hi Acme, ready to test?" };
    },
  };
  const approval = new InMemoryApprovalTool({ clock });
  const email = new InMemoryEmailTool({ clock });
  let n = 0;
  const runner = new PovLoopRunner({
    store,
    monitoringAgent,
    nudgeDrafter: new NudgeDrafter({ llm }),
    approval,
    email,
    operatorEmails: ["se@poc.test"],
    clock,
    idGenerator: () => `evt_${n++}`,
  });
  return { store, runner };
}

describe("PovLoopRunner (always-on loop)", () => {
  it("inactive PoC: drafts a nudge via the LLM, gates it for SE approval, records activity", async () => {
    const { store, runner } = await makeRunner(INACTIVE);

    const result = await runner.runTick("poc_123");
    expect(result.status).toBe("ran");
    expect(result.reportStatus).toBe("inactive");

    const events = await store.listActivityEvents("poc_123");
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("monitor_tick");
    expect(kinds).toContain("classification");
    expect(kinds).toContain("llm_activated");
    expect(kinds).toContain("action_gated");

    const gated = events.find((event) => event.kind === "action_gated");
    expect(gated?.refs?.approvalTokenId).toBeTruthy();
    expect(gated?.cadenceKey).toBe("nudge:inactive");
  });

  it("does not re-nudge on a second tick within the cooldown", async () => {
    const { store, runner } = await makeRunner(INACTIVE);
    await runner.runTick("poc_123");
    await runner.runTick("poc_123");

    const events = await store.listActivityEvents("poc_123", { limit: 200 });
    const gatedNudges = events.filter(
      (event) => event.kind === "action_gated" && event.cadenceKey === "nudge:inactive",
    );
    expect(gatedNudges).toHaveLength(1);
    expect(
      events.some((event) => event.kind === "skipped" && event.cadenceKey === "nudge:inactive"),
    ).toBe(true);
  });

  it("criteria_met PoC: captures success, no LLM and no customer-facing gate", async () => {
    const { store, runner } = await makeRunner(ACTIVE);
    const result = await runner.runTick("poc_123");
    expect(result.reportStatus).toBe("criteria_met");

    const events = await store.listActivityEvents("poc_123");
    expect(events.some((event) => event.kind === "action_sent")).toBe(true);
    expect(events.some((event) => event.kind === "action_gated")).toBe(false);
    expect(events.some((event) => event.kind === "llm_activated")).toBe(false);
  });

  it("blocked PoC: escalates to the SE by email (internal, ungated)", async () => {
    const { store, runner } = await makeRunner(SYNTHETIC_ONLY);
    const result = await runner.runTick("poc_123");
    expect(result.reportStatus).toBe("blocked");

    const events = await store.listActivityEvents("poc_123");
    const escalation = events.find((event) => event.kind === "escalation");
    expect(escalation?.refs?.emailId).toBeTruthy();
    expect(events.some((event) => event.kind === "action_gated")).toBe(false);
  });
});
