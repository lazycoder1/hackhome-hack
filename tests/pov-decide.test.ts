import type { PocMonitoringReport } from "../src/contracts.js";
import { decide } from "../src/monitoring/decide.js";

function report(status: PocMonitoringReport["status"]): PocMonitoringReport {
  return {
    pocId: "poc_1",
    planVersion: 1,
    runId: "run_1",
    checkedAt: "2026-06-05T12:00:00.000Z",
    window: { from: "2026-06-04T12:00:00.000Z", to: "2026-06-05T12:00:00.000Z" },
    status,
    riskLevel: "medium",
    usageSummary: { hasRealCustomerActivity: false, syntheticOnly: false },
    eventProgress: [],
    successCriteriaProgress: [],
    planDrift: { missingExpectedEvents: ["signup_completed"], unexpectedObservedEvents: [], notes: [] },
    recommendedActions: [],
  };
}

describe("decide (deterministic DECIDE layer)", () => {
  const cases: {
    status: PocMonitoringReport["status"];
    type: string;
    customerFacing: boolean;
  }[] = [
    { status: "criteria_met", type: "capture_success", customerFacing: false },
    { status: "inactive", type: "nudge_customer", customerFacing: true },
    { status: "at_risk", type: "nudge_customer", customerFacing: true },
    { status: "blocked", type: "escalate_se", customerFacing: false },
    { status: "unknown", type: "escalate_se", customerFacing: false },
    { status: "on_track", type: "keep_monitoring", customerFacing: false },
  ];

  for (const { status, type, customerFacing } of cases) {
    it(`maps ${status} → ${type}`, () => {
      const [action] = decide(report(status));
      expect(action.type).toBe(type);
      expect(action.customerFacing).toBe(customerFacing);
      expect(action.cadenceKey).toBeTruthy();
    });
  }

  it("only customer-facing actions are gated", () => {
    const gatedTypes = cases
      .filter((entry) => entry.customerFacing)
      .map((entry) => entry.type);
    expect(gatedTypes).toEqual(["nudge_customer", "nudge_customer"]);
  });

  it("with no recommendations or dates, returns exactly the status action", () => {
    expect(decide(report("inactive"))).toHaveLength(1);
    expect(decide(report("on_track"))).toEqual([
      expect.objectContaining({ type: "keep_monitoring", customerFacing: false }),
    ]);
  });
});

describe("decide — PRD §10 lifecycle actions (recommendations + date routing)", () => {
  function reportWith(overrides: Partial<PocMonitoringReport>): PocMonitoringReport {
    return { ...report("at_risk"), ...overrides };
  }

  it("maps the agent's revise_plan recommendation into an internal action", () => {
    const result = decide(
      reportWith({
        status: "at_risk",
        recommendedActions: [
          { owner: "operator", action: "offer_support", reason: "needs help", urgency: "medium" },
          { owner: "operator", action: "revise_plan", reason: "usage drifted from the plan", urgency: "medium" },
        ],
      }),
    );
    const revise = result.find((a) => a.type === "revise_plan");
    expect(revise).toBeDefined();
    expect(revise?.customerFacing).toBe(false);
    expect(revise?.reason).toBe("usage drifted from the plan");
    // offer_support is already covered by the primary status nudge — not double-emitted.
    expect(result.filter((a) => a.customerFacing)).toHaveLength(1);
  });

  it("maps schedule_review alongside the criteria_met capture", () => {
    const result = decide(
      reportWith({
        status: "criteria_met",
        recommendedActions: [
          { owner: "operator", action: "mark_success", reason: "all signals present", urgency: "low" },
          { owner: "operator", action: "schedule_review", reason: "evidence is fresh", urgency: "medium" },
        ],
      }),
    );
    expect(result.map((a) => a.type)).toEqual(
      expect.arrayContaining(["capture_success", "schedule_review"]),
    );
    expect(result.every((a) => a.customerFacing === false)).toBe(true);
  });

  it("routes prepare_teardown once the teardown date has passed", () => {
    const result = decide(reportWith({ status: "at_risk" }), {
      now: new Date("2026-06-10T00:00:00.000Z"),
      teardownDate: "2026-06-09T00:00:00.000Z",
    });
    expect(result.some((a) => a.type === "prepare_teardown" && a.urgency === "high")).toBe(true);
  });

  it("routes extend_poc when the review date is near and there is real progress", () => {
    const result = decide(
      reportWith({
        status: "at_risk",
        usageSummary: { hasRealCustomerActivity: true, syntheticOnly: false },
      }),
      { now: new Date("2026-06-09T06:00:00.000Z"), reviewDate: "2026-06-09T18:00:00.000Z" },
    );
    expect(result.some((a) => a.type === "extend_poc")).toBe(true);
  });

  it("does not extend when there is no real activity yet", () => {
    const result = decide(
      reportWith({
        status: "inactive",
        usageSummary: { hasRealCustomerActivity: false, syntheticOnly: false },
      }),
      { now: new Date("2026-06-09T06:00:00.000Z"), reviewDate: "2026-06-09T18:00:00.000Z" },
    );
    expect(result.some((a) => a.type === "extend_poc")).toBe(false);
  });

  it("never emits two actions of the same type", () => {
    const result = decide(
      reportWith({
        status: "criteria_met",
        recommendedActions: [
          { owner: "operator", action: "schedule_review", reason: "one", urgency: "medium" },
          { owner: "operator", action: "schedule_review", reason: "two", urgency: "medium" },
        ],
      }),
    );
    const types = result.map((a) => a.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
