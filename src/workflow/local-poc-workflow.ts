import type { HandoffGenerator } from "../handoff/handoff-generator.js";
import type { MonitorPocInput, PocMonitoringAgent } from "../monitoring/poc-monitoring-agent.js";
import type { PocStore } from "../state/types.js";
import type { AuditTool, EmailTool } from "../tools/types.js";
import type {
  InboundEmailMessage,
  PocLifecycleStatus,
  PocPlan,
  SetupResult,
} from "../contracts.js";
import type { PocSetupAgent } from "./poc-setup-agent.js";
import type { RetryPocStageInput, RetryPocStageResult } from "./workflow-api.js";

export type LocalPocWorkflowOptions = {
  store: PocStore;
  setupAgent: PocSetupAgent;
  monitoringAgent?: PocMonitoringAgent;
  handoffGenerator: HandoffGenerator;
  email: EmailTool;
  audit: AuditTool;
  replyProcessor?: {
    processCustomerReply(input: { pocId: string; message: InboundEmailMessage }): Promise<{
      intent: "approved" | "needs_changes" | "question" | "rejected" | "unclear";
      completedApproval: boolean;
      requiresSetup: boolean;
      requiresDashboardRevision?: boolean;
      changes: string[];
    }>;
  };
  clock?: () => Date;
};

export class LocalPocWorkflow {
  private readonly store: PocStore;
  private readonly setupAgent: PocSetupAgent;
  private readonly monitoringAgent?: PocMonitoringAgent;
  private readonly handoffGenerator: HandoffGenerator;
  private readonly email: EmailTool;
  private readonly audit: AuditTool;
  private readonly replyProcessor?: LocalPocWorkflowOptions["replyProcessor"];
  private readonly clock: () => Date;

  constructor(options: LocalPocWorkflowOptions) {
    this.store = options.store;
    this.setupAgent = options.setupAgent;
    this.monitoringAgent = options.monitoringAgent;
    this.handoffGenerator = options.handoffGenerator;
    this.email = options.email;
    this.audit = options.audit;
    this.replyProcessor = options.replyProcessor;
    this.clock = options.clock ?? (() => new Date());
  }

  async approveAndRunSetup(input: {
    pocId: string;
    approvedBy: string;
    approvalSource: "email_reply" | "approval_link" | "internal_operator";
  }): Promise<{
    setupResult: Awaited<ReturnType<PocSetupAgent["setup"]>>;
    handoffEmailId: string;
    handoffThreadId: string;
  }> {
    const now = this.clock().toISOString();
    const plan = await this.loadActivePlan(input.pocId);

    const approvedPlan = {
      ...plan,
      status: "approved" as const,
      approval: {
        approvedBy: input.approvedBy,
        approvedAt: now,
        approvalSource: input.approvalSource,
      },
    };

    await this.store.savePlan(approvedPlan);
    await this.store.updateStatus(input.pocId, "approved", now);
    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: "orchestrator",
      action: "approve_poc_plan",
      target: input.approvedBy,
      status: "succeeded",
      createdAt: now,
    });

    const setupResult = await this.runSetup(input.pocId, approvedPlan);
    const sent = await this.sendHandoff(input.pocId, approvedPlan, setupResult);

    return {
      setupResult,
      handoffEmailId: sent.emailId,
      handoffThreadId: sent.threadId,
    };
  }

  async processEmailReply(input: { pocId: string; message: InboundEmailMessage }): Promise<{
    intent: "approved" | "needs_changes" | "question" | "rejected" | "unclear";
    completedApproval: boolean;
    requiresSetup: boolean;
    requiresDashboardRevision?: boolean;
    changes: string[];
  }> {
    if (!this.replyProcessor) {
      throw new Error("No reply processor configured");
    }

    const result = await this.replyProcessor.processCustomerReply(input);
    if (result.requiresSetup) {
      await this.approveAndRunSetup({
        pocId: input.pocId,
        approvedBy: input.message.from,
        approvalSource: "email_reply",
      });
    }
    if (result.requiresDashboardRevision) {
      await this.reviseDashboardFromFeedback({
        pocId: input.pocId,
        requestedBy: input.message.from,
        changes: result.changes,
        threadId: input.message.threadId,
        subject: input.message.subject,
      });
    }

    return result;
  }

  async reviseDashboardFromFeedback(input: {
    pocId: string;
    requestedBy: string;
    changes: string[];
    threadId?: string;
    subject?: string;
  }): Promise<{
    setupResult: Awaited<ReturnType<PocSetupAgent["setup"]>>;
    responseEmailId: string;
    responseThreadId: string;
  }> {
    const now = this.clock().toISOString();
    const plan = await this.loadActivePlan(input.pocId);
    if (plan.status !== "approved") {
      throw new Error(`PoC ${input.pocId} active plan is not approved`);
    }

    await this.store.updateStatus(input.pocId, "dashboard_revision_requested", now);
    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: "orchestrator",
      action: "start_dashboard_revision",
      target: input.requestedBy,
      outputSummary: input.changes.join("; "),
      status: "started",
      createdAt: now,
    });

    const revisionPlan = dashboardRevisionPlan(plan, input.changes, now);
    const setupResult = await this.runSetup(input.pocId, revisionPlan);
    const sent = await this.sendDashboardRevisionResponse({
      pocId: input.pocId,
      plan,
      setupResult,
      requestedBy: input.requestedBy,
      changes: input.changes,
      threadId: input.threadId,
      subject: input.subject,
    });

    return {
      setupResult,
      responseEmailId: sent.emailId,
      responseThreadId: sent.threadId,
    };
  }

  async retryPocStage(input: RetryPocStageInput): Promise<RetryPocStageResult> {
    const plan = await this.loadActivePlan(input.pocId);
    if (plan.status !== "approved") {
      throw new Error(`PoC ${input.pocId} active plan is not approved`);
    }

    const now = this.clock().toISOString();
    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: input.requestedBy ? "human" : "orchestrator",
      action: `retry_poc_${input.stage}`,
      target: input.requestedBy ?? input.stage,
      status: "started",
      createdAt: now,
    });

    if (input.stage === "setup") {
      const setupResult = await this.runSetup(input.pocId, plan);
      const sent = await this.sendHandoff(input.pocId, plan, setupResult);
      return {
        pocId: input.pocId,
        stage: input.stage,
        status: sent.status,
        setupStatus: setupResult.status,
        handoffEmailId: sent.emailId,
        handoffThreadId: sent.threadId,
      };
    }

    const setupResult = await this.store.getSetupResult(input.pocId);
    if (!setupResult) {
      throw new Error(`No setup result found for PoC ${input.pocId}`);
    }
    if (setupResult.status === "failed") {
      throw new Error(`Last setup result failed for PoC ${input.pocId}`);
    }

    const sent = await this.sendHandoff(input.pocId, plan, setupResult);
    return {
      pocId: input.pocId,
      stage: input.stage,
      status: sent.status,
      setupStatus: setupResult.status,
      handoffEmailId: sent.emailId,
      handoffThreadId: sent.threadId,
    };
  }

  async monitorActivePoc(input: MonitorPocInput): ReturnType<PocMonitoringAgent["monitor"]> {
    if (!this.monitoringAgent) {
      throw new Error("No monitoring agent configured");
    }

    return await this.monitoringAgent.monitor(input);
  }

  private async loadActivePlan(pocId: string): Promise<PocPlan> {
    const poc = await this.store.getPoc(pocId);
    if (!poc?.activePlanVersion) {
      throw new Error(`No active plan found for PoC ${pocId}`);
    }

    const plan = await this.store.getPlan(pocId, poc.activePlanVersion);
    if (!plan) {
      throw new Error(`No plan v${poc.activePlanVersion} found for PoC ${pocId}`);
    }

    return plan;
  }

  private async runSetup(pocId: string, plan: PocPlan): Promise<SetupResult> {
    await this.store.updateStatus(pocId, "setup_running", this.clock().toISOString());
    const setupResult = await this.setupAgent.setup(plan);
    await this.store.saveSetupResult(setupResult);

    if (setupResult.status === "failed") {
      const clarificationQuestions = setupClarificationQuestions(setupResult);
      if (clarificationQuestions.length) {
        await this.store.updateStatus(pocId, "needs_clarification", this.clock().toISOString());
        await this.sendSetupClarification(pocId, plan, clarificationQuestions);
        throw new Error(`PostHog setup needs customer clarification for PoC ${pocId}`);
      }
      await this.store.updateStatus(pocId, "needs_human_review", this.clock().toISOString());
      throw new Error(`PostHog setup failed for PoC ${pocId}`);
    }

    return setupResult;
  }

  private async sendHandoff(
    pocId: string,
    plan: PocPlan,
    setupResult: SetupResult,
  ): Promise<{
    status: PocLifecycleStatus;
    emailId: string;
    threadId: string;
  }> {
    await this.store.updateStatus(pocId, "handoff_ready", this.clock().toISOString());
    const handoff = this.handoffGenerator.generate({
      plan,
      setupResult,
    });

    const sent = await this.email.sendEmail({
      to: handoff.recipients,
      subject: handoff.subject,
      markdownBody: handoff.markdownBody,
      tags: [`poc:${pocId}`, "product:posthog", "stage:handoff"],
    });

    const status =
      setupResult.status === "succeeded_with_warnings" ? "handoff_sent_with_gaps" : "handoff_sent";
    await this.store.updateStatus(pocId, status, this.clock().toISOString());
    await this.audit.writeAuditLog({
      pocId,
      actor: "orchestrator",
      action: "send_poc_handoff",
      target: handoff.recipients.join(","),
      status: "succeeded",
      createdAt: this.clock().toISOString(),
    });

    return {
      status,
      emailId: sent.emailId,
      threadId: sent.threadId,
    };
  }

  private async sendDashboardRevisionResponse(input: {
    pocId: string;
    plan: PocPlan;
    setupResult: SetupResult;
    requestedBy: string;
    changes: string[];
    threadId?: string;
    subject?: string;
  }): Promise<{
    emailId: string;
    threadId: string;
  }> {
    const status =
      input.setupResult.status === "succeeded_with_warnings"
        ? "handoff_sent_with_gaps"
        : "handoff_sent";
    await this.store.updateStatus(input.pocId, status, this.clock().toISOString());

    const dashboard = latestDashboard(input.setupResult);
    const insights = input.setupResult.createdResources.filter(
      (resource) => resource.type === "insight",
    );
    const body = [
      `Hi ${input.plan.customer.contacts[0]?.name ?? input.plan.customer.companyName},`,
      "",
      "Yes, PostHog supports graph-heavy dashboards. I revised the dashboard based on your feedback so it leans more on charts and clearer visual comparisons instead of dense numeric tiles.",
      "",
      dashboard?.url
        ? `Updated dashboard: ${dashboard.url}`
        : "The dashboard revision has been applied.",
      "",
      ...(insights.length
        ? [
            "Updated views:",
            ...insights
              .slice(0, 6)
              .map((insight) => `- ${insight.name}${insight.url ? `: ${insight.url}` : ""}`),
            "",
          ]
        : []),
      input.setupResult.knownGaps.length
        ? `Known caveat: ${input.setupResult.knownGaps.join("; ")}`
        : "I did not find any blocking caveats in the revision.",
      "",
      "Reply with any other dashboard feedback and I will keep iterating on the pilot.",
    ].join("\n");

    const sent = await this.email.sendEmail({
      to: [input.requestedBy],
      subject: `Re: ${(input.subject ?? `PostHog PoC dashboard`).replace(/^Re:\s*/i, "")}`,
      markdownBody: body,
      threadId: input.threadId,
      tags: [`poc:${input.pocId}`, "product:posthog", "stage:dashboard-revision"],
    });

    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: "orchestrator",
      action: "send_dashboard_revision_response",
      target: input.requestedBy,
      outputSummary: dashboard?.url ?? input.setupResult.status,
      status: "succeeded",
      createdAt: this.clock().toISOString(),
    });

    return sent;
  }

  private async sendSetupClarification(
    pocId: string,
    plan: PocPlan,
    questions: string[],
  ): Promise<void> {
    const poc = await this.store.getPoc(pocId);
    const recipients = plan.handoffPlan.recipients.length
      ? plan.handoffPlan.recipients
      : plan.customer.contacts.map((contact) => contact.email);
    if (!recipients.length) {
      return;
    }

    const sent = await this.email.sendEmail({
      to: recipients,
      subject: `Quick clarification on your ${plan.customer.companyName} PostHog PoC`,
      threadId: poc?.confirmationThreadId,
      markdownBody: [
        `Hi ${plan.customer.contacts[0]?.name ?? plan.customer.companyName},`,
        "",
        "Thanks for confirming the PoC. I checked the live PostHog evidence and need a few business definitions before I create the final dashboard.",
        "",
        ...questions.map((question, index) => `${index + 1}. ${question}`),
        "",
        "Feel free to reply naturally. I will use your answer to finish the dashboard and follow up with the final view.",
      ].join("\n"),
      tags: [`poc:${pocId}`, "product:posthog", "stage:setup-clarification"],
    });

    await this.audit.writeAuditLog({
      pocId,
      actor: "orchestrator",
      action: "send_setup_clarification",
      target: recipients.join(","),
      outputSummary: sent.threadId,
      status: "succeeded",
      createdAt: this.clock().toISOString(),
    });
  }
}

function setupClarificationQuestions(setupResult: SetupResult): string[] {
  const prefix = "DeepSeek requested business clarification before dashboard creation:";
  return setupResult.knownGaps.flatMap((gap) => {
    if (!gap.startsWith(prefix)) {
      return [];
    }
    return splitClarificationQuestions(gap.slice(prefix.length));
  });
}

function splitClarificationQuestions(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (/\?\s*;/.test(trimmed)) {
    const parts = trimmed.split(/\?\s*;\s*/);
    return parts
      .map((part, index) => {
        const question = part.trim();
        if (!question) {
          return "";
        }
        return index < parts.length - 1 && !question.endsWith("?") ? `${question}?` : question;
      })
      .filter((question) => question.length > 0);
  }

  return trimmed
    .split(";")
    .map((question) => question.trim())
    .filter((question) => question.length > 0);
}

function dashboardRevisionPlan(plan: PocPlan, changes: string[], createdAt: string): PocPlan {
  const revisionKey = createdAt.replace(/\D/g, "").slice(0, 14);
  const cleanChanges = changes.map((change) => change.trim()).filter(Boolean);
  const revisionAssumptions = [
    ...cleanChanges.map((change) => `Customer dashboard revision request: ${change}`),
    "Create a replacement dashboard revision for the already-delivered pilot dashboard. Prefer graph/chart-heavy views, clear axes, and fewer numeric-only summary cards.",
  ];

  return {
    ...plan,
    assumptions: uniqueStrings([...plan.assumptions, ...revisionAssumptions]),
    setup: {
      ...plan.setup,
      dashboards: plan.setup.dashboards.map((dashboard) => ({
        ...dashboard,
        name: `${dashboard.name} revision ${revisionKey}`,
        description: [
          dashboard.description ?? dashboard.name,
          "Updated from post-handoff customer feedback.",
          ...cleanChanges,
        ].join(" "),
      })),
    },
  };
}

function latestDashboard(setupResult: SetupResult) {
  return [...setupResult.updatedResources, ...setupResult.createdResources]
    .filter((resource) => resource.type === "dashboard")
    .at(-1);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
