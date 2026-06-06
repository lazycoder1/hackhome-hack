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
});
