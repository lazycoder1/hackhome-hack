import type { PocMonitoringReport } from "../contracts.js";

/**
 * The DECIDE step of the always-on loop. Pure, deterministic, auditable: it maps a
 * monitoring classification to the action(s) the agent should take. Natural-language drafting
 * happens later (LLM-activated); this layer only decides *what* and *whether a human gates it*.
 *
 * Product-agnostic on purpose — no PostHog-specific fields — so it survives the move to a
 * horizontal TelemetryAdapter.
 *
 * The action vocabulary tracks the PRD §10 recommended-action taxonomy: the status switch
 * drives the primary (often customer-facing) move, and two further sources fill in the
 * lifecycle actions that the status alone can't express —
 *   - `revise_plan` / `schedule_review` come from the sensing layer's `report.recommendedActions`;
 *   - `extend_poc` / `prepare_teardown` are routed from the review/teardown dates via `context`.
 * Everything beyond the primary action here is internal (SE-surfaced, never auto-sent).
 */
export type ProposedActionType =
  | "nudge_customer"
  | "escalate_se"
  | "capture_success"
  | "revise_plan"
  | "schedule_review"
  | "extend_poc"
  | "prepare_teardown"
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

/**
 * Optional temporal context for review/teardown-date routing (PRD §8.12 / §10). When absent,
 * `decide` reduces to the status + recommendations mapping — so callers that have no dates
 * (and the existing tests) see unchanged behavior.
 */
export type DecideContext = {
  now?: Date;
  reviewDate?: string;
  teardownDate?: string;
};

/** A review is "near" once we're within this window of the review date. */
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export function decide(
  report: PocMonitoringReport,
  context: DecideContext = {},
): ProposedAction[] {
  const actions: ProposedAction[] = [primaryAction(report)];

  // Supplementary internal recommendations the sensing layer already computed (PRD §10):
  // revise_plan (observed usage drifts from the plan) and schedule_review (enough evidence
  // for a go/no-go meeting). send_reminder / offer_support / mark_success are already covered
  // by the primary status action, so they are not double-emitted here.
  for (const rec of report.recommendedActions ?? []) {
    const mapped = internalRecommendation(rec);
    if (mapped) {
      actions.push(mapped);
    }
  }

  // Date-driven lifecycle routing (PRD §10): extend_poc / prepare_teardown.
  const lifecycle = lifecycleByDate(report, context);
  if (lifecycle) {
    actions.push(lifecycle);
  }

  return dedupeByType(actions);
}

/** The status-driven primary action — the customer-facing or escalation move for this tick. */
function primaryAction(report: PocMonitoringReport): ProposedAction {
  switch (report.status) {
    case "criteria_met":
      return {
        type: "capture_success",
        customerFacing: false,
        cadenceKey: "capture:success",
        reason: "Success criteria are met — capture the evidence and notify the SE.",
        urgency: "low",
      };
    case "inactive":
      return {
        type: "nudge_customer",
        customerFacing: true,
        cadenceKey: "nudge:inactive",
        reason: "No customer activity in the window — nudge them to run the testing plan.",
        urgency: "high",
      };
    case "at_risk":
      return {
        type: "nudge_customer",
        customerFacing: true,
        cadenceKey: "nudge:at_risk",
        reason: `Expected events missing (${report.planDrift.missingExpectedEvents.join(", ") || "unknown"}) — nudge the customer.`,
        urgency: "medium",
      };
    case "blocked":
      return {
        type: "escalate_se",
        customerFacing: false,
        cadenceKey: "escalate:blocked",
        reason: "Only synthetic traffic is visible — real customer events are blocked. SE help needed.",
        urgency: "high",
      };
    case "unknown":
      return {
        type: "escalate_se",
        customerFacing: false,
        cadenceKey: "escalate:unknown",
        reason: "Monitoring could not read usage data — escalate to the SE.",
        urgency: "medium",
      };
    case "on_track":
    default:
      return {
        type: "keep_monitoring",
        customerFacing: false,
        cadenceKey: "keep_monitoring",
        reason: "Usage is healthy and no intervention is needed.",
        urgency: "low",
      };
  }
}

/**
 * Map the evidence-based recommendations the monitoring agent emits into internal
 * (SE-surfaced) proposed actions. Only the actions the status switch can't already express
 * are mapped; the rest return null so they aren't duplicated.
 */
function internalRecommendation(
  rec: PocMonitoringReport["recommendedActions"][number],
): ProposedAction | null {
  switch (rec.action) {
    case "revise_plan":
      return {
        type: "revise_plan",
        customerFacing: false,
        cadenceKey: "revise:plan",
        reason: rec.reason,
        urgency: rec.urgency,
      };
    case "schedule_review":
      return {
        type: "schedule_review",
        customerFacing: false,
        cadenceKey: "review:schedule",
        reason: rec.reason,
        urgency: rec.urgency,
      };
    default:
      return null;
  }
}

/** Route the pure date-driven lifecycle actions: teardown reached, or review near with progress. */
function lifecycleByDate(
  report: PocMonitoringReport,
  context: DecideContext,
): ProposedAction | null {
  const now = context.now;
  if (!now) {
    return null;
  }

  if (reached(now, context.teardownDate)) {
    return {
      type: "prepare_teardown",
      customerFacing: false,
      cadenceKey: "teardown:prepare",
      reason: "Teardown date reached — prepare to tear the PoC down and record the outcome.",
      urgency: "high",
    };
  }

  if (
    reached(now, context.reviewDate, REVIEW_WINDOW_MS) &&
    report.status !== "criteria_met" &&
    report.usageSummary.hasRealCustomerActivity
  ) {
    return {
      type: "extend_poc",
      customerFacing: false,
      cadenceKey: "extend:poc",
      reason: "Review date is near with partial progress — consider extending the PoC to finish evaluating.",
      urgency: "medium",
    };
  }

  return null;
}

/** True when `now` is at/after `iso` (optionally `leadMs` early). Bad/empty dates are never reached. */
function reached(now: Date, iso: string | undefined, leadMs = 0): boolean {
  if (!iso) {
    return false;
  }
  const target = Date.parse(iso);
  return !Number.isNaN(target) && now.getTime() >= target - leadMs;
}

/** Keep the first action of each type — the primary action wins over later supplements. */
function dedupeByType(actions: ProposedAction[]): ProposedAction[] {
  const seen = new Set<ProposedActionType>();
  const out: ProposedAction[] = [];
  for (const action of actions) {
    if (seen.has(action.type)) {
      continue;
    }
    seen.add(action.type);
    out.push(action);
  }
  return out;
}
