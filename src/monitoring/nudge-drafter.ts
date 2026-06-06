import type { PocMonitoringReport, PocPlan } from "../contracts.js";
import type { LlmJsonClient } from "../llm/types.js";
import type { ProposedAction } from "./decide.js";

/**
 * The LLM-activated path of the always-on loop. When DECIDE produces a customer-facing nudge
 * (or an SE escalation), the LLM is "activated" to write the message — this is where the agent
 * stops being deterministic plumbing and takes over a task. If the model errors or returns a
 * bad shape, we fall back to the deterministic draft already on the monitoring report, so the
 * loop never blocks on the LLM.
 */
export type DraftedMessage = {
  subject: string;
  markdownBody: string;
  source: "llm" | "fallback";
};

export type NudgeDrafterOptions = {
  llm: LlmJsonClient;
  model?: string;
};

export class NudgeDrafter {
  private readonly llm: LlmJsonClient;
  private readonly model: string;

  constructor(options: NudgeDrafterOptions) {
    this.llm = options.llm;
    this.model = options.model ?? "gpt-5.5";
  }

  async draftCustomerAction(input: {
    plan: PocPlan;
    report: PocMonitoringReport;
    action: ProposedAction;
    priorTouches: number;
  }): Promise<DraftedMessage> {
    const system = [
      "You are a Proof-of-Value orchestration agent writing a short, friendly check-in email to a customer who is evaluating a product.",
      "Goal: get them to run the agreed testing plan and reach their success criteria. Be concise, warm, specific, and never pushy.",
      "If they have been nudged before, acknowledge it lightly and do not repeat yourself.",
      'Respond ONLY as JSON: {"subject": string, "markdownBody": string}.',
    ].join(" ");

    const user = JSON.stringify({
      company: input.plan.customer.companyName,
      objective: input.plan.objective,
      reason: input.action.reason,
      urgency: input.action.urgency,
      priorTouches: input.priorTouches,
      missingExpectedEvents: input.report.planDrift.missingExpectedEvents,
      successCriteriaProgress: input.report.successCriteriaProgress.map((criterion) => ({
        criterion: criterion.criterion,
        status: criterion.status,
      })),
    });

    return this.draftOrFallback({ system, user }, input.report, "customer");
  }

  async draftEscalation(input: {
    plan: PocPlan;
    report: PocMonitoringReport;
    action: ProposedAction;
  }): Promise<DraftedMessage> {
    const system = [
      "You are a Proof-of-Value orchestration agent writing a brief internal escalation to the Solution Engineer who owns this evaluation.",
      "State what is wrong, the evidence, and the one action you recommend. Be terse and factual.",
      'Respond ONLY as JSON: {"subject": string, "markdownBody": string}.',
    ].join(" ");

    const user = JSON.stringify({
      company: input.plan.customer.companyName,
      objective: input.plan.objective,
      status: input.report.status,
      riskLevel: input.report.riskLevel,
      reason: input.action.reason,
      missingExpectedEvents: input.report.planDrift.missingExpectedEvents,
      notes: input.report.planDrift.notes,
    });

    return this.draftOrFallback({ system, user }, input.report, "operator");
  }

  private async draftOrFallback(
    prompt: { system: string; user: string },
    report: PocMonitoringReport,
    audience: "customer" | "operator",
  ): Promise<DraftedMessage> {
    try {
      const raw = await this.llm.completeJson({
        model: this.model,
        system: prompt.system,
        user: prompt.user,
        temperature: 0.3,
      });
      const parsed = asDraft(raw);
      if (parsed) {
        return { ...parsed, source: "llm" };
      }
    } catch {
      // fall through to deterministic draft
    }
    return { ...fallbackDraft(report, audience), source: "fallback" };
  }
}

function asDraft(raw: unknown): { subject: string; markdownBody: string } | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as { subject?: unknown; markdownBody?: unknown };
  if (typeof candidate.subject === "string" && typeof candidate.markdownBody === "string") {
    return { subject: candidate.subject, markdownBody: candidate.markdownBody };
  }
  return undefined;
}

function fallbackDraft(
  report: PocMonitoringReport,
  audience: "customer" | "operator",
): { subject: string; markdownBody: string } {
  if (report.followUpDraft && report.followUpDraft.audience === audience) {
    return {
      subject: report.followUpDraft.subject,
      markdownBody: report.followUpDraft.markdownBody,
    };
  }
  return {
    subject:
      audience === "customer"
        ? "Quick check-in on your evaluation"
        : `PoC ${report.pocId} needs attention (${report.status})`,
    markdownBody:
      audience === "customer"
        ? "We noticed the evaluation could use some activity — happy to help you run the next test step."
        : `Monitoring status is ${report.status} (risk: ${report.riskLevel}). Please review.`,
  };
}
