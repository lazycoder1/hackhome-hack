import type { PocMonitoringReport } from "../contracts.js";

/**
 * The DECIDE step of the always-on loop. Pure, deterministic, auditable: it maps a
 * monitoring classification to the action(s) the agent should take. Natural-language drafting
 * happens later (LLM-activated); this layer only decides *what* and *whether a human gates it*.
 *
 * Product-agnostic on purpose — no PostHog-specific fields — so it survives the move to a
 * horizontal TelemetryAdapter.
 */
export type ProposedActionType =
  | "nudge_customer"
  | "escalate_se"
  | "capture_success"
  | "keep_monitoring";

export type ProposedAction = {
  type: ProposedActionType;
  /** Customer-facing actions must pass the SE-approval gate before sending. */
  customerFacing: boolean;
  /** Stable key used to rate-limit/dedup repeated actions of the same intent. */
  cadenceKey: string;
  reason: string;
  urgency: "low" | "medium" | "high";
};

export function decide(report: PocMonitoringReport): ProposedAction[] {
  switch (report.status) {
    case "criteria_met":
      return [
        {
          type: "capture_success",
          customerFacing: false,
          cadenceKey: "capture:success",
          reason: "Success criteria are met — capture the evidence and notify the SE.",
          urgency: "low",
        },
      ];
    case "inactive":
      return [
        {
          type: "nudge_customer",
          customerFacing: true,
          cadenceKey: "nudge:inactive",
          reason: "No customer activity in the window — nudge them to run the testing plan.",
          urgency: "high",
        },
      ];
    case "at_risk":
      return [
        {
          type: "nudge_customer",
          customerFacing: true,
          cadenceKey: "nudge:at_risk",
          reason: `Expected events missing (${report.planDrift.missingExpectedEvents.join(", ") || "unknown"}) — nudge the customer.`,
          urgency: "medium",
        },
      ];
    case "blocked":
      return [
        {
          type: "escalate_se",
          customerFacing: false,
          cadenceKey: "escalate:blocked",
          reason: "Only synthetic traffic is visible — real customer events are blocked. SE help needed.",
          urgency: "high",
        },
      ];
    case "unknown":
      return [
        {
          type: "escalate_se",
          customerFacing: false,
          cadenceKey: "escalate:unknown",
          reason: "Monitoring could not read usage data — escalate to the SE.",
          urgency: "medium",
        },
      ];
    case "on_track":
    default:
      return [
        {
          type: "keep_monitoring",
          customerFacing: false,
          cadenceKey: "keep_monitoring",
          reason: "Usage is healthy and no intervention is needed.",
          urgency: "low",
        },
      ];
  }
}
