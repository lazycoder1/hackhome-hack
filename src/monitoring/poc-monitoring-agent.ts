import type {
  PocLifecycleStatus,
  PocMonitoringReport,
  PocPlan,
  PosthogUsageSnapshot,
  SetupResult,
} from "../contracts.js";
import type { PocStore } from "../state/types.js";
import type { AuditTool, PostHogUsageSnapshotTool } from "../tools/types.js";

export type PocMonitoringAgentOptions = {
  store: PocStore;
  usageSnapshotTool: PostHogUsageSnapshotTool;
  audit: AuditTool;
  clock?: () => Date;
  runIdGenerator?: () => string;
};

export type MonitorPocInput = {
  pocId: string;
  window?: {
    from: string;
    to: string;
  };
};

export class PocMonitoringAgent {
  private readonly store: PocStore;
  private readonly usageSnapshotTool: PostHogUsageSnapshotTool;
  private readonly audit: AuditTool;
  private readonly clock: () => Date;
  private readonly runIdGenerator: () => string;

  constructor(options: PocMonitoringAgentOptions) {
    this.store = options.store;
    this.usageSnapshotTool = options.usageSnapshotTool;
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.runIdGenerator =
      options.runIdGenerator ?? (() => `monitor_${this.clock().getTime().toString(36)}`);
  }

  async monitor(input: MonitorPocInput): Promise<PocMonitoringReport> {
    const now = this.clock().toISOString();
    const context = await this.loadContext(input.pocId);
    const window = input.window ?? defaultWindow(this.clock());
    const runId = this.runIdGenerator();

    await this.store.updateStatus(input.pocId, "monitoring_running", now);

    try {
      const usageSnapshot = await this.usageSnapshotTool.collectPosthogUsageSnapshot({
        pocId: input.pocId,
        posthogProjectId: context.setupResult.posthog.projectId,
        window,
        expectedEvents: expectedEventNames(context.plan),
        resourceRefs: [
          ...context.setupResult.createdResources,
          ...context.setupResult.updatedResources,
        ],
      });
      const previousReports = await this.store.listMonitoringReports(input.pocId, { limit: 5 });
      const report = evaluate({
        plan: context.plan,
        setupResult: context.setupResult,
        usageSnapshot,
        previousReports,
        runId,
        checkedAt: now,
        window,
      });

      await this.persistResult(report);
      await this.audit.writeAuditLog({
        pocId: input.pocId,
        actor: "poc_monitoring_agent",
        action: "monitor_poc_success",
        outputSummary: `${report.status}:${report.riskLevel}`,
        status: "succeeded",
        createdAt: now,
      });

      return report;
    } catch (error) {
      const report = unknownReport({
        plan: context.plan,
        runId,
        checkedAt: now,
        window,
        error: (error as Error).message,
      });
      await this.persistResult(report);
      await this.audit.writeAuditLog({
        pocId: input.pocId,
        actor: "poc_monitoring_agent",
        action: "monitor_poc_success",
        status: "failed",
        error: (error as Error).message,
        createdAt: now,
      });
      return report;
    }
  }

  private async loadContext(pocId: string): Promise<{
    plan: PocPlan;
    setupResult: SetupResult;
  }> {
    const poc = await this.store.getPoc(pocId);
    if (!poc?.activePlanVersion) {
      throw new Error(`No active plan found for PoC ${pocId}`);
    }

    const plan = await this.store.getPlan(pocId, poc.activePlanVersion);
    if (!plan) {
      throw new Error(`No plan v${poc.activePlanVersion} found for PoC ${pocId}`);
    }

    const setupResult = await this.store.getSetupResult(pocId);
    if (!setupResult) {
      throw new Error(`No setup result found for PoC ${pocId}`);
    }

    return { plan, setupResult };
  }

  private async persistResult(report: PocMonitoringReport): Promise<void> {
    await this.store.saveMonitoringReport(report);
    await this.store.updateStatus(report.pocId, lifecycleStatusForReport(report), report.checkedAt);
  }
}

function evaluate(input: {
  plan: PocPlan;
  setupResult: SetupResult;
  usageSnapshot: PosthogUsageSnapshot;
  previousReports: PocMonitoringReport[];
  runId: string;
  checkedAt: string;
  window: {
    from: string;
    to: string;
  };
}): PocMonitoringReport {
  const expectedEvents = expectedEventNames(input.plan);
  const eventProgress = eventProgressFor(expectedEvents, input.usageSnapshot);
  const missingExpectedEvents = eventProgress
    .filter((event) => event.expected && event.count === 0)
    .map((event) => event.eventName);
  const unexpectedObservedEvents = input.usageSnapshot.events
    .filter((event) => event.count > 0 && !expectedEvents.includes(event.eventName))
    .map((event) => event.eventName);
  const syntheticOnly = isSyntheticOnly(input.usageSnapshot);
  const hasRealCustomerActivity =
    input.usageSnapshot.totalEvents > 0 &&
    input.usageSnapshot.events.some((event) => event.count > (event.syntheticCount ?? 0));
  const allExpectedEventsSeen = expectedEvents.length === 0 || missingExpectedEvents.length === 0;
  const allCriteriaMet = hasRealCustomerActivity && allExpectedEventsSeen && !syntheticOnly;
  const noActivity = input.usageSnapshot.totalEvents === 0;
  const status = allCriteriaMet
    ? "criteria_met"
    : noActivity
      ? "inactive"
      : syntheticOnly
        ? "blocked"
        : missingExpectedEvents.length
          ? "at_risk"
          : "on_track";
  const riskLevel = riskLevelFor(status);

  return {
    pocId: input.plan.pocId,
    planVersion: input.plan.version,
    runId: input.runId,
    checkedAt: input.checkedAt,
    window: input.window,
    status,
    riskLevel,
    usageSummary: {
      hasRealCustomerActivity,
      lastEventAt: input.usageSnapshot.lastEventAt,
      uniqueUsers: input.usageSnapshot.uniqueUsers,
      totalEvents: input.usageSnapshot.totalEvents,
      syntheticOnly,
      dashboardActivity: input.usageSnapshot.dashboardActivity,
      surveyResponses: input.usageSnapshot.surveyResponses,
      sessionRecordings: input.usageSnapshot.sessionRecordings,
      featureFlags: input.usageSnapshot.featureFlags,
    },
    eventProgress,
    successCriteriaProgress: input.plan.successCriteria.map((criterion) =>
      successCriterionProgress({
        criterion,
        status,
        usageSnapshot: input.usageSnapshot,
        missingExpectedEvents,
        syntheticOnly,
      }),
    ),
    planDrift: {
      missingExpectedEvents,
      unexpectedObservedEvents,
      notes: [
        ...planDriftNotes({
          setupResult: input.setupResult,
          previousReports: input.previousReports,
          missingExpectedEvents,
          unexpectedObservedEvents,
        }),
        ...assetActivityNotes(input.plan, input.usageSnapshot),
      ],
    },
    recommendedActions: recommendedActionsFor(status, missingExpectedEvents),
    followUpDraft: followUpDraftFor(input.plan, status, riskLevel),
  };
}

function expectedEventNames(plan: PocPlan): string[] {
  return plan.setup.events.filter((event) => event.required).map((event) => event.name);
}

function eventProgressFor(
  expectedEvents: string[],
  usageSnapshot: PosthogUsageSnapshot,
): PocMonitoringReport["eventProgress"] {
  const byName = new Map(usageSnapshot.events.map((event) => [event.eventName, event]));

  return expectedEvents.map((eventName) => {
    const observed = byName.get(eventName);
    const count = observed?.count ?? 0;
    const syntheticCount = observed?.syntheticCount ?? 0;
    return {
      eventName,
      expected: true,
      firstSeenAt: observed?.firstSeenAt,
      lastSeenAt: observed?.lastSeenAt,
      count,
      uniqueUsers: observed?.uniqueUsers,
      source: count === 0 ? "unknown" : syntheticCount >= count ? "synthetic" : "real_customer",
    };
  });
}

function isSyntheticOnly(usageSnapshot: PosthogUsageSnapshot): boolean {
  return (
    usageSnapshot.totalEvents > 0 &&
    usageSnapshot.events.length > 0 &&
    usageSnapshot.events.every(
      (event) => event.count > 0 && (event.syntheticCount ?? 0) >= event.count,
    )
  );
}

function successCriterionProgress(input: {
  criterion: string;
  status: PocMonitoringReport["status"];
  usageSnapshot: PosthogUsageSnapshot;
  missingExpectedEvents: string[];
  syntheticOnly: boolean;
}): PocMonitoringReport["successCriteriaProgress"][number] {
  if (input.status === "criteria_met") {
    return {
      criterion: input.criterion,
      status: "met",
      evidence: [
        `Observed ${input.usageSnapshot.totalEvents} event(s) from ${input.usageSnapshot.uniqueUsers ?? "unknown"} user(s).`,
      ],
    };
  }

  if (input.syntheticOnly) {
    return {
      criterion: input.criterion,
      status: "blocked",
      evidence: ["Only synthetic setup validation events were observed."],
      recommendedAction: "Help the customer send real product traffic into the PoC project.",
    };
  }

  if (input.usageSnapshot.totalEvents === 0) {
    return {
      criterion: input.criterion,
      status: "not_met",
      evidence: ["No customer activity was observed in the monitoring window."],
      recommendedAction: "Remind the customer to complete the agreed testing plan.",
    };
  }

  return {
    criterion: input.criterion,
    status: input.missingExpectedEvents.length ? "partially_met" : "unknown",
    evidence: [
      `Observed activity, but missing expected event(s): ${input.missingExpectedEvents.join(", ") || "unknown"}.`,
    ],
    recommendedAction: "Review instrumentation and testing steps with the customer.",
  };
}

function planDriftNotes(input: {
  setupResult: SetupResult;
  previousReports: PocMonitoringReport[];
  missingExpectedEvents: string[];
  unexpectedObservedEvents: string[];
}): string[] {
  const notes: string[] = [];
  if (input.setupResult.knownGaps.length) {
    notes.push(`Setup gaps remain: ${input.setupResult.knownGaps.join("; ")}`);
  }
  if (input.previousReports.length) {
    notes.push(`Compared with ${input.previousReports.length} previous monitoring report(s).`);
  }
  if (input.missingExpectedEvents.length) {
    notes.push(`Expected event(s) not observed: ${input.missingExpectedEvents.join(", ")}`);
  }
  if (input.unexpectedObservedEvents.length) {
    notes.push(`Unexpected event(s) observed: ${input.unexpectedObservedEvents.join(", ")}`);
  }
  return notes;
}

function assetActivityNotes(plan: PocPlan, usageSnapshot: PosthogUsageSnapshot): string[] {
  const notes: string[] = [];
  if (plan.setup.surveys.length && noSurveyResponses(usageSnapshot)) {
    notes.push("Survey(s) configured but no responses observed yet.");
  }
  if (plan.setup.sessionReplay?.enabled && (usageSnapshot.sessionRecordings?.count ?? 0) === 0) {
    notes.push("Session replay configured but no recordings observed yet.");
  }
  if (plan.setup.featureFlags.length && noFlagEvaluations(usageSnapshot)) {
    notes.push("Feature flag(s) configured but no evaluations observed yet.");
  }
  return notes;
}

function noSurveyResponses(usageSnapshot: PosthogUsageSnapshot): boolean {
  const responses = usageSnapshot.surveyResponses ?? [];
  return responses.length === 0 || responses.every((survey) => survey.responseCount === 0);
}

function noFlagEvaluations(usageSnapshot: PosthogUsageSnapshot): boolean {
  const flags = usageSnapshot.featureFlags ?? [];
  return flags.length === 0 || flags.every((flag) => flag.evaluations === 0);
}

function recommendedActionsFor(
  status: PocMonitoringReport["status"],
  missingExpectedEvents: string[],
): PocMonitoringReport["recommendedActions"] {
  if (status === "criteria_met") {
    return [
      {
        owner: "operator",
        action: "mark_success",
        reason: "All expected PoC usage signals are present.",
        urgency: "low",
      },
      {
        owner: "operator",
        action: "schedule_review",
        reason: "Success criteria are met; schedule the customer review while evidence is fresh.",
        urgency: "medium",
      },
    ];
  }

  if (status === "inactive") {
    return [
      {
        owner: "customer",
        action: "send_reminder",
        reason: "No real usage was observed during the monitoring window.",
        urgency: "high",
      },
      {
        owner: "operator",
        action: "offer_support",
        reason: "The customer may need help installing the SDK or running the test plan.",
        urgency: "medium",
      },
    ];
  }

  if (status === "blocked") {
    return [
      {
        owner: "operator",
        action: "offer_support",
        reason: "Only synthetic events are visible; real customer traffic is blocked.",
        urgency: "high",
      },
    ];
  }

  if (status === "at_risk") {
    return [
      {
        owner: "operator",
        action: "offer_support",
        reason: `Missing expected event(s): ${missingExpectedEvents.join(", ")}.`,
        urgency: "medium",
      },
      {
        owner: "operator",
        action: "revise_plan",
        reason: "Observed behavior may not match the original PoC plan.",
        urgency: "medium",
      },
    ];
  }

  return [
    {
      owner: "system",
      action: "keep_monitoring",
      reason: "Usage exists and no immediate intervention is required.",
      urgency: "low",
    },
  ];
}

function followUpDraftFor(
  plan: PocPlan,
  status: PocMonitoringReport["status"],
  riskLevel: PocMonitoringReport["riskLevel"],
): PocMonitoringReport["followUpDraft"] {
  return {
    audience: status === "criteria_met" ? "operator" : "customer",
    subject:
      status === "criteria_met"
        ? `PostHog PoC success evidence ready for ${plan.customer.companyName}`
        : `PostHog PoC testing check-in for ${plan.customer.companyName}`,
    markdownBody:
      status === "criteria_met"
        ? `The PostHog PoC for ${plan.customer.companyName} has evidence for the approved success criteria. Risk level: ${riskLevel}.`
        : `We checked the PostHog PoC for ${plan.customer.companyName} and need more usage evidence before the review. Risk level: ${riskLevel}.`,
  };
}

function riskLevelFor(status: PocMonitoringReport["status"]): PocMonitoringReport["riskLevel"] {
  if (status === "criteria_met") {
    return "none";
  }
  if (status === "on_track") {
    return "low";
  }
  if (status === "at_risk" || status === "unknown") {
    return "medium";
  }
  return "high";
}

function lifecycleStatusForReport(report: PocMonitoringReport): PocLifecycleStatus {
  if (report.status === "criteria_met") {
    return "monitoring_criteria_met";
  }
  if (report.status === "inactive" || report.status === "at_risk") {
    return "monitoring_at_risk";
  }
  if (report.status === "blocked" || report.status === "unknown") {
    return "needs_human_review";
  }
  return "active_poc";
}

function defaultWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

function unknownReport(input: {
  plan: PocPlan;
  runId: string;
  checkedAt: string;
  window: {
    from: string;
    to: string;
  };
  error: string;
}): PocMonitoringReport {
  return {
    pocId: input.plan.pocId,
    planVersion: input.plan.version,
    runId: input.runId,
    checkedAt: input.checkedAt,
    window: input.window,
    status: "unknown",
    riskLevel: "medium",
    usageSummary: {
      hasRealCustomerActivity: false,
      syntheticOnly: false,
    },
    eventProgress: expectedEventNames(input.plan).map((eventName) => ({
      eventName,
      expected: true,
      count: 0,
      source: "unknown",
    })),
    successCriteriaProgress: input.plan.successCriteria.map((criterion) => ({
      criterion,
      status: "unknown",
      evidence: [`Monitoring failed: ${input.error}`],
      recommendedAction: "Retry monitoring or inspect PostHog MCP access.",
    })),
    planDrift: {
      missingExpectedEvents: expectedEventNames(input.plan),
      unexpectedObservedEvents: [],
      notes: [`Monitoring failed: ${input.error}`],
    },
    recommendedActions: [
      {
        owner: "operator",
        action: "offer_support",
        reason: "Monitoring could not read PostHog usage data.",
        urgency: "medium",
      },
    ],
  };
}
