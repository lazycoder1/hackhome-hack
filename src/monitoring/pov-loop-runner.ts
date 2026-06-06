import type {
  ActivityEvent,
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
} from "../contracts.js";
import type { PocStore } from "../state/types.js";
import type { ApprovalTool, EmailTool } from "../tools/types.js";
import { decide, type ProposedAction } from "./decide.js";
import type { NudgeDrafter } from "./nudge-drafter.js";
import type { PocMonitoringAgent } from "./poc-monitoring-agent.js";

/**
 * The always-on loop. One `runTick(pocId)` is the single seam invoked by BOTH the Trigger.dev
 * schedule (cloud) and the in-process IntervalTicker (local) — it imports no @trigger.dev/sdk.
 *
 * Per tick: SENSE/CLASSIFY (monitoring agent) → DECIDE (deterministic) → dedup/cadence →
 * GATE (SE approval for customer-facing actions) → ACT (LLM-drafted nudge queued / escalation
 * emailed) → RECORD (durable ActivityEvents). Idempotent under Trigger retries.
 */
export type PovLoopRunnerOptions = {
  store: PocStore;
  monitoringAgent: PocMonitoringAgent;
  nudgeDrafter: NudgeDrafter;
  approval: ApprovalTool;
  email: EmailTool;
  /** SE/operator addresses that approve gated actions and receive escalations. */
  operatorEmails: string[];
  cooldownHours?: number;
  clock?: () => Date;
  idGenerator?: () => string;
};

export type TickResult = {
  pocId: string;
  status: "ran" | "not_ready";
  reportStatus?: PocMonitoringReport["status"];
  events: ActivityEvent[];
};

/** Lifecycle statuses the always-on loop should tick (post-handoff, being evaluated). */
export const MONITORABLE_STATUSES: PocLifecycleStatus[] = [
  "active_poc",
  "monitoring_running",
  "monitoring_at_risk",
  "monitoring_criteria_met",
];

export function isMonitorableStatus(status: PocLifecycleStatus): boolean {
  return MONITORABLE_STATUSES.includes(status);
}

export class PovLoopRunner {
  private readonly store: PocStore;
  private readonly monitoringAgent: PocMonitoringAgent;
  private readonly nudgeDrafter: NudgeDrafter;
  private readonly approval: ApprovalTool;
  private readonly email: EmailTool;
  private readonly operatorEmails: string[];
  private readonly cooldownMs: number;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(options: PovLoopRunnerOptions) {
    this.store = options.store;
    this.monitoringAgent = options.monitoringAgent;
    this.nudgeDrafter = options.nudgeDrafter;
    this.approval = options.approval;
    this.email = options.email;
    this.operatorEmails = options.operatorEmails;
    this.cooldownMs = (options.cooldownHours ?? 48) * 60 * 60 * 1000;
    this.clock = options.clock ?? (() => new Date());
    let counter = 0;
    this.newId =
      options.idGenerator ??
      (() => `evt_${this.clock().getTime().toString(36)}_${(counter++).toString(36)}`);
  }

  async runTick(pocId: string): Promise<TickResult> {
    const events: ActivityEvent[] = [];
    const record = async (event: Omit<ActivityEvent, "id" | "pocId" | "ts">) => {
      const full: ActivityEvent = {
        id: this.newId(),
        pocId,
        ts: this.clock().toISOString(),
        ...event,
      };
      await this.store.saveActivityEvent(full);
      events.push(full);
      return full;
    };

    let report: PocMonitoringReport;
    try {
      report = await this.monitoringAgent.monitor({ pocId });
    } catch (error) {
      await record({
        kind: "monitor_tick",
        actor: "monitoring_agent",
        status: "failed",
        summary: `Monitoring could not run: ${(error as Error).message}`,
      });
      await record({
        kind: "escalation",
        actor: "pov_loop",
        status: "sent",
        cadenceKey: "escalate:not_ready",
        summary: "PoC is not ready to monitor (missing plan/setup) — flagged for the SE.",
      });
      return { pocId, status: "not_ready", events };
    }

    await record({
      kind: "monitor_tick",
      actor: "monitoring_agent",
      status: "succeeded",
      summary: `Monitored: ${report.status} (risk ${report.riskLevel})`,
      refs: { monitoringRunId: report.runId },
    });
    await record({
      kind: "classification",
      actor: "pov_loop",
      status: "succeeded",
      summary: `Classified as ${report.status}`,
      payload: { status: report.status, riskLevel: report.riskLevel },
    });

    const plan = await this.loadPlan(pocId, report.planVersion);
    const priorEvents = await this.store.listActivityEvents(pocId, { limit: 100 });
    const priorTouches = priorEvents.filter(
      (event) => event.cadenceKey?.startsWith("nudge:") && isActed(event),
    ).length;

    const decideContext = {
      now: this.clock(),
      reviewDate: plan.handoffPlan.reviewDate,
      teardownDate: plan.handoffPlan.teardownDate,
    };
    for (const action of decide(report, decideContext)) {
      if (action.type === "keep_monitoring") {
        continue;
      }

      if (this.isOnCooldown(priorEvents, action.cadenceKey)) {
        await record({
          kind: "skipped",
          actor: "pov_loop",
          status: "skipped",
          cadenceKey: action.cadenceKey,
          summary: `Skipped ${action.type} — within cooldown for "${action.cadenceKey}".`,
        });
        continue;
      }

      if (action.customerFacing) {
        await this.proposeGatedNudge({ plan, report, action, priorTouches, record });
      } else {
        await this.actInternally({ plan, report, action, record });
      }
    }

    return { pocId, status: "ran", reportStatus: report.status, events };
  }

  private async proposeGatedNudge(input: {
    plan: PocPlan;
    report: PocMonitoringReport;
    action: ProposedAction;
    priorTouches: number;
    record: (event: Omit<ActivityEvent, "id" | "pocId" | "ts">) => Promise<ActivityEvent>;
  }): Promise<void> {
    const draft = await this.nudgeDrafter.draftCustomerAction({
      plan: input.plan,
      report: input.report,
      action: input.action,
      priorTouches: input.priorTouches,
    });
    await input.record({
      kind: "llm_activated",
      actor: "pov_loop",
      status: "succeeded",
      cadenceKey: input.action.cadenceKey,
      summary: `Drafted customer nudge (${draft.source}): "${draft.subject}"`,
      payload: { source: draft.source, subject: draft.subject },
    });

    const waitpoint = await this.approval.createApprovalWaitpoint({
      pocId: input.report.pocId,
      timeout: "7d",
      approverEmails: this.operatorEmails,
      idempotencyKey: this.idempotencyKey(input.report, input.action.cadenceKey),
    });
    await input.record({
      kind: "action_gated",
      actor: "pov_loop",
      status: "gated",
      cadenceKey: input.action.cadenceKey,
      summary: `Customer nudge queued for SE approval: "${draft.subject}"`,
      refs: { approvalTokenId: waitpoint.tokenId },
      payload: {
        subject: draft.subject,
        markdownBody: draft.markdownBody,
        recipients: input.plan.handoffPlan.recipients,
        publicApprovalUrl: waitpoint.publicApprovalUrl,
      },
    });
  }

  private async actInternally(input: {
    plan: PocPlan;
    report: PocMonitoringReport;
    action: ProposedAction;
    record: (event: Omit<ActivityEvent, "id" | "pocId" | "ts">) => Promise<ActivityEvent>;
  }): Promise<void> {
    if (input.action.type === "escalate_se") {
      const draft = await this.nudgeDrafter.draftEscalation({
        plan: input.plan,
        report: input.report,
        action: input.action,
      });
      await input.record({
        kind: "llm_activated",
        actor: "pov_loop",
        status: "succeeded",
        cadenceKey: input.action.cadenceKey,
        summary: `Drafted SE escalation (${draft.source}): "${draft.subject}"`,
        payload: { source: draft.source },
      });
      const sent = await this.email.sendEmail({
        to: this.operatorEmails,
        subject: draft.subject,
        markdownBody: draft.markdownBody,
        tags: ["pov:escalation", `poc:${input.report.pocId}`],
      });
      await input.record({
        kind: "escalation",
        actor: "pov_loop",
        status: "sent",
        cadenceKey: input.action.cadenceKey,
        summary: input.action.reason,
        refs: { emailId: sent.emailId },
      });
      return;
    }

    // Every other internal action (capture_success, revise_plan, schedule_review, extend_poc,
    // prepare_teardown) is a recommendation the agent surfaces to the SE via the activity feed —
    // the agent proposes, the SE disposes. Nothing is sent to the customer here.
    await input.record({
      kind: "action_sent",
      actor: "pov_loop",
      status: "succeeded",
      cadenceKey: input.action.cadenceKey,
      summary: internalActionSummary(input.action, input.plan),
      payload: { actionType: input.action.type, urgency: input.action.urgency },
    });
  }

  private isOnCooldown(priorEvents: ActivityEvent[], cadenceKey: string): boolean {
    const cutoff = this.clock().getTime() - this.cooldownMs;
    return priorEvents.some(
      (event) =>
        event.cadenceKey === cadenceKey && isActed(event) && new Date(event.ts).getTime() >= cutoff,
    );
  }

  private idempotencyKey(report: PocMonitoringReport, cadenceKey: string): string {
    return `poc:${report.pocId}:${cadenceKey}:${report.checkedAt.slice(0, 10)}`;
  }

  private async loadPlan(pocId: string, planVersion: number): Promise<PocPlan> {
    const plan = await this.store.getPlan(pocId, planVersion);
    if (!plan) {
      throw new Error(`No plan v${planVersion} for PoC ${pocId}`);
    }
    return plan;
  }
}

/** Feed summary for an internal recommendation surfaced to the SE. */
function internalActionSummary(action: ProposedAction, plan: PocPlan): string {
  const company = plan.customer.companyName;
  switch (action.type) {
    case "capture_success":
      return `Success criteria met for ${company} — evidence captured.`;
    case "revise_plan":
      return `Plan drift detected for ${company} — proposing a POV plan revision for SE review.`;
    case "schedule_review":
      return `Enough evidence gathered for ${company} — proposing the go/no-go review.`;
    case "extend_poc":
      return `${company} is progressing but late — proposing a POV extension.`;
    case "prepare_teardown":
      return `Review/teardown date reached for ${company} — preparing teardown.`;
    default:
      return action.reason;
  }
}

/** An action "happened" (was gated for approval or sent) — vs merely skipped/proposed. */
function isActed(event: ActivityEvent): boolean {
  return event.status === "gated" || event.status === "sent" || event.kind === "escalation";
}
