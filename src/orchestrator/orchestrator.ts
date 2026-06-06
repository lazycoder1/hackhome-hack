import type {
  CustomerReplyClassification,
  InboundEmailMessage,
  MissingDetail,
  PocPlan,
  PocRequirements,
} from "../contracts.js";
import type { LlmJsonClient } from "../llm/types.js";
import type { ApprovalTool, AuditTool, EmailTool } from "../tools/types.js";
import type { PocStore } from "../state/types.js";

export type SubmitRequirementsBlobInput = {
  source: "api" | "file";
  text: string;
  filename?: string;
  participants: {
    name?: string;
    email?: string;
    role?: string;
    company?: string;
  }[];
  structuredHints?: Record<string, unknown>;
  sourceMetadata: {
    sourceId?: string;
    receivedAt?: string;
  };
};

export type OrchestratorOptions = {
  store: PocStore;
  llm: LlmJsonClient;
  email: EmailTool;
  approval: ApprovalTool;
  audit: AuditTool;
  defaultStructuredHints?: Record<string, unknown>;
  clock?: () => Date;
  idGenerator?: () => string;
  extractionModel?: string;
  replyClassificationModel?: string;
};

export class Orchestrator {
  private readonly store: PocStore;
  private readonly llm: LlmJsonClient;
  private readonly email: EmailTool;
  private readonly approval: ApprovalTool;
  private readonly audit: AuditTool;
  private readonly defaultStructuredHints: Record<string, unknown>;
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly extractionModel: string;
  private readonly replyClassificationModel: string;

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.llm = options.llm;
    this.email = options.email;
    this.approval = options.approval;
    this.audit = options.audit;
    this.defaultStructuredHints = options.defaultStructuredHints ?? {};
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.extractionModel = options.extractionModel ?? "deepseek-v4-pro";
    this.replyClassificationModel = options.replyClassificationModel ?? "deepseek-v4-flash";
  }

  async submitRequirementsBlob(input: SubmitRequirementsBlobInput): Promise<{
    pocId: string;
    status: "confirmation_sent" | "needs_clarification";
    approvalUrl?: string;
    approvalTokenId?: string;
    missingDetails?: MissingDetail[];
  }> {
    const now = this.clock().toISOString();
    const pocId = this.idGenerator();

    await this.store.createPoc({
      pocId,
      status: "intake_received",
      createdAt: now,
      updatedAt: now,
      sourceText: input.text,
    });

    await this.audit.writeAuditLog({
      pocId,
      actor: "orchestrator",
      action: "submit_requirements_blob",
      status: "succeeded",
      createdAt: now,
    });

    const requirements = await this.extractRequirements(pocId, input, now);
    await this.store.saveRequirements(requirements);

    await this.audit.writeAuditLog({
      pocId,
      actor: "orchestrator",
      action: "extract_poc_requirements",
      outputSummary: requirements.businessGoal,
      status: "succeeded",
      createdAt: now,
    });

    const missingDetails = detectMissingDetails(requirements);
    if (missingDetails.some((detail) => detail.severity === "blocking")) {
      const recipients = requirements.customer.contacts.map((contact) => contact.email);
      const sent = await this.email.sendEmail({
        to: recipients,
        subject: "Clarification needed for your PostHog PoC",
        markdownBody: renderClarificationEmail(requirements, missingDetails),
        tags: [`poc:${pocId}`, "product:posthog", "stage:clarification"],
      });

      await this.store.updatePoc(pocId, {
        confirmationEmailId: sent.emailId,
        confirmationThreadId: sent.threadId,
      });
      await this.store.updateStatus(pocId, "needs_clarification", now);
      await this.audit.writeAuditLog({
        pocId,
        actor: "orchestrator",
        action: "request_poc_clarification",
        outputSummary: missingDetails.map((detail) => detail.key).join(","),
        status: "succeeded",
        createdAt: now,
      });

      return {
        pocId,
        status: "needs_clarification",
        missingDetails,
      };
    }

    const plan = this.generatePlan(requirements, 1);
    await this.store.savePlan(plan);

    const recipients = plan.customer.contacts.map((contact) => contact.email);
    const waitpoint = await this.sendPlanConfirmation({
      pocId,
      plan,
      subject: "Please confirm your PostHog PoC plan",
      tags: [`poc:${pocId}`, "product:posthog"],
    });
    await this.store.updateStatus(pocId, "confirmation_sent", now);

    await this.audit.writeAuditLog({
      pocId,
      actor: "orchestrator",
      action: "send_confirmation_email",
      target: recipients.join(","),
      status: "succeeded",
      createdAt: now,
    });

    return {
      pocId,
      status: "confirmation_sent",
      approvalUrl: waitpoint.publicApprovalUrl,
      approvalTokenId: waitpoint.tokenId,
    };
  }

  async processCustomerReply(input: { pocId: string; message: InboundEmailMessage }): Promise<{
    intent: CustomerReplyClassification["intent"];
    completedApproval: boolean;
    requiresSetup: boolean;
    requiresDashboardRevision?: boolean;
    changes: string[];
  }> {
    const now = this.clock().toISOString();
    const poc = await this.store.getPoc(input.pocId);
    if (!poc) {
      throw new Error(`Unknown PoC: ${input.pocId}`);
    }

    const classification = this.normalizeCustomerReplyClassification(
      await this.classifyCustomerReply(input.pocId, input.message),
      input.message.textBody,
    );
    const changes = classification.extractedChanges ?? [];

    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: "orchestrator",
      action: "classify_customer_reply",
      target: input.message.from,
      outputSummary: classification.intent,
      status: "succeeded",
      createdAt: now,
    });

    if (classification.intent === "approved" && !poc.activePlanVersion) {
      await this.audit.writeAuditLog({
        pocId: input.pocId,
        actor: "orchestrator",
        action: "skip_customer_reply_without_active_plan",
        target: input.message.from,
        outputSummary: classification.intent,
        status: "skipped",
        createdAt: now,
      });

      return {
        intent: classification.intent,
        completedApproval: false,
        requiresSetup: false,
        changes,
      };
    }

    if (classification.intent === "approved" || classification.intent === "rejected") {
      let completedApproval = false;
      if (poc.approvalTokenId) {
        try {
          await this.approval.completeApprovalWaitpoint({
            tokenId: poc.approvalTokenId,
            decision: classification.intent,
            decidedBy: input.message.from,
            notes: `${classification.intent === "approved" ? "Approved" : "Rejected"} by customer reply`,
            changes,
          });
          completedApproval = true;
        } catch (error) {
          await this.audit.writeAuditLog({
            pocId: input.pocId,
            actor: "orchestrator",
            action: "complete_approval_waitpoint",
            target: poc.approvalTokenId,
            status: "skipped",
            error: (error as Error).message,
            createdAt: now,
          });
        }
      }

      await this.store.updateStatus(
        input.pocId,
        classification.intent === "approved" ? "approved" : "rejected",
        now,
      );

      return {
        intent: classification.intent,
        completedApproval,
        requiresSetup: classification.intent === "approved",
        changes,
      };
    }

    if (classification.intent === "needs_changes") {
      if (await this.shouldRequestDashboardRevision(input.pocId, poc.status)) {
        await this.audit.writeAuditLog({
          pocId: input.pocId,
          actor: "orchestrator",
          action: "dashboard_revision_requested",
          target: input.message.from,
          outputSummary: changes.join("; "),
          status: "succeeded",
          createdAt: now,
        });
        return {
          intent: classification.intent,
          completedApproval: false,
          requiresSetup: false,
          requiresDashboardRevision: true,
          changes,
        };
      }

      await this.revisePlanFromChanges({
        pocId: input.pocId,
        changes,
        requestedBy: input.message.from,
      });
      return {
        intent: classification.intent,
        completedApproval: false,
        requiresSetup: false,
        changes,
      };
    }

    if (classification.intent === "question" || classification.intent === "unclear") {
      await this.email.sendEmail({
        to: [input.message.from],
        subject: `Re: ${input.message.subject.replace(/^Re:\s*/i, "")}`,
        markdownBody:
          classification.suggestedResponse ??
          renderReplyClarificationEmail(classification.intent, poc.status),
        threadId: input.message.threadId,
        tags: [`poc:${input.pocId}`, "product:posthog", "stage:email-reply"],
      });
    }

    return {
      intent: classification.intent,
      completedApproval: false,
      requiresSetup: false,
      changes,
    };
  }

  private async shouldRequestDashboardRevision(
    pocId: string,
    status: string,
  ): Promise<boolean> {
    if (!isPostHandoffStatus(status)) {
      return false;
    }

    const setupResult = await this.store.getSetupResult(pocId);
    return Boolean(
      setupResult?.createdResources.some((resource) => resource.type === "dashboard") ||
        setupResult?.updatedResources.some((resource) => resource.type === "dashboard"),
    );
  }

  async revisePlanFromChanges(input: {
    pocId: string;
    changes: string[];
    requestedBy?: string;
  }): Promise<{
    pocId: string;
    planVersion: number;
    approvalTokenId: string;
    approvalUrl: string;
  }> {
    const now = this.clock().toISOString();
    const poc = await this.store.getPoc(input.pocId);
    if (!poc) {
      throw new Error(`Unknown PoC: ${input.pocId}`);
    }

    await this.store.updateStatus(input.pocId, "needs_clarification", now);
    const plan = await this.createRevisedPlan({
      pocId: input.pocId,
      currentPlanVersion: poc.activePlanVersion,
      changes: input.changes,
      threadId: poc.confirmationThreadId,
      createdAt: now,
      requestedBy: input.requestedBy,
    });
    const updatedPoc = await this.store.getPoc(input.pocId);

    return {
      pocId: input.pocId,
      planVersion: plan.version,
      approvalTokenId: updatedPoc?.approvalTokenId ?? "",
      approvalUrl: updatedPoc?.approvalUrl ?? "",
    };
  }

  private normalizeCustomerReplyClassification(
    classification: CustomerReplyClassification,
    textBody: string,
  ): CustomerReplyClassification {
    const inferredChanges = inferDashboardPresentationChanges(textBody);
    if (
      inferredChanges.length === 0 ||
      (classification.intent !== "question" && classification.intent !== "unclear")
    ) {
      return classification;
    }

    return {
      ...classification,
      intent: "needs_changes",
      extractedChanges:
        classification.extractedChanges.length === 0 ? inferredChanges : classification.extractedChanges,
    };
  }

  private async extractRequirements(
    pocId: string,
    input: SubmitRequirementsBlobInput,
    receivedAt: string,
  ): Promise<PocRequirements> {
    const structuredHints = mergeStructuredHints(
      this.defaultStructuredHints,
      input.structuredHints ?? {},
    );
    const json = (await this.llm.completeJson({
      model: this.extractionModel,
      system: [
        "Extract a PostHog PoC requirements object from the user's text.",
        "Return JSON only. Product must be posthog.",
        "Preserve uncertainty as openQuestions and assumptions.",
      ].join(" "),
      user: JSON.stringify({
        text: input.text,
        participants: input.participants,
        structuredHints,
      }),
    })) as Partial<PocRequirements>;

    const hintRequirements = requirementsFromStructuredHints(structuredHints);
    const primaryEmail = firstEmail(json.customer?.contacts) ?? firstEmail(input.participants);
    if (!primaryEmail) {
      throw new Error("At least one customer email is required");
    }

    const companyName =
      json.customer?.companyName ??
      input.participants.find((participant) => participant.company)?.company ??
      "Unknown Customer";

    return {
      pocId,
      product: "posthog",
      customer: {
        companyName,
        companySlug: json.customer?.companySlug ?? slugify(companyName),
        contacts: normalizeContacts(json.customer?.contacts, input.participants, primaryEmail),
        timezone: json.customer?.timezone,
      },
      businessGoal:
        json.businessGoal ??
        hintRequirements.businessGoal ??
        "Evaluate PostHog for the requested PoC.",
      successCriteria: json.successCriteria?.length
        ? json.successCriteria
        : ["Confirm PostHog setup works"],
      appContext: {
        platform: json.appContext?.platform?.length
          ? json.appContext.platform
          : (hintRequirements.appContext?.platform ?? ["unknown"]),
        appName: json.appContext?.appName ?? hintRequirements.appContext?.appName,
        appUrl: json.appContext?.appUrl ?? hintRequirements.appContext?.appUrl,
        techStack: json.appContext?.techStack ?? hintRequirements.appContext?.techStack,
        environments: json.appContext?.environments ?? hintRequirements.appContext?.environments,
      },
      posthogContext: mergePosthogContext(hintRequirements.posthogContext, json.posthogContext),
      analyticsScope: {
        events: json.analyticsScope?.events?.length
          ? json.analyticsScope.events
          : (hintRequirements.analyticsScope?.events ?? []),
        funnels: json.analyticsScope?.funnels ?? hintRequirements.analyticsScope?.funnels ?? [],
        dashboards:
          json.analyticsScope?.dashboards ?? hintRequirements.analyticsScope?.dashboards ?? [],
        cohorts: json.analyticsScope?.cohorts ?? [],
        featureFlags: json.analyticsScope?.featureFlags ?? [],
        experiments: json.analyticsScope?.experiments ?? [],
        surveys: json.analyticsScope?.surveys ?? [],
        alerts: json.analyticsScope?.alerts ?? hintRequirements.analyticsScope?.alerts ?? [],
        sessionReplay: json.analyticsScope?.sessionReplay,
        exports: json.analyticsScope?.exports ?? [],
      },
      securityConstraints: json.securityConstraints,
      timeline: json.timeline,
      assumptions: json.assumptions ?? [],
      openQuestions: json.openQuestions ?? [],
      source: {
        sourceKind: input.source,
        sourceId: input.sourceMetadata.sourceId,
        filename: input.filename,
        receivedAt: input.sourceMetadata.receivedAt ?? receivedAt,
      },
    };
  }

  private async classifyCustomerReply(
    pocId: string,
    message: InboundEmailMessage,
  ): Promise<CustomerReplyClassification> {
    const planVersion = (await this.store.getPoc(pocId))?.activePlanVersion ?? 1;
    const plan = await this.store.getPlan(pocId, planVersion);
    const json = (await this.llm.completeJson({
      model: this.replyClassificationModel,
      system: [
        "Classify the customer's natural-language email reply for a PostHog PoC lifecycle.",
        "The customer may reply during confirmation, setup, handoff, or a month-long pilot.",
        "Do not require magic words like Approved; infer intent from ordinary language.",
        "Act like a pre-sales/customer-success agent. If follow-up is needed, ask in business terms about goals, success criteria, audience, timing, or definitions.",
        "Do not ask the customer technical implementation questions such as query shape, event instrumentation strategy, MCP tools, database fields, or dashboard widget types.",
        "Return JSON only with intent, confidence, extractedChanges, requiresHumanReview, and optional suggestedResponse.",
        "Allowed intent values: approved, needs_changes, question, rejected, unclear.",
        "Use needs_changes when they ask to modify scope, dashboards, metrics, recipients, timing, or configuration.",
        "Use question when they ask something we can answer or clarify over email.",
      ].join(" "),
      user: JSON.stringify({
        pocId,
        lifecycleStatus: (await this.store.getPoc(pocId))?.status,
        planSummary: plan
          ? {
              objective: plan.objective,
              successCriteria: plan.successCriteria,
              openQuestions: plan.openQuestions,
            }
          : undefined,
        email: message,
      }),
    })) as Partial<CustomerReplyClassification>;

    return {
      intent: isReplyIntent(json.intent) ? json.intent : "unclear",
      confidence: typeof json.confidence === "number" ? json.confidence : 0,
      extractedChanges: Array.isArray(json.extractedChanges)
        ? json.extractedChanges.filter((change): change is string => typeof change === "string")
        : [],
      requiresHumanReview: Boolean(json.requiresHumanReview),
      suggestedResponse:
        typeof json.suggestedResponse === "string" ? json.suggestedResponse : undefined,
    };
  }

  private async createRevisedPlan(input: {
    pocId: string;
    currentPlanVersion?: number;
    changes: string[];
    threadId?: string;
    createdAt: string;
    requestedBy?: string;
  }): Promise<PocPlan> {
    const requirements = await this.store.getRequirements(input.pocId);
    if (!requirements) {
      throw new Error(`No requirements found for PoC ${input.pocId}`);
    }

    const currentPlan = input.currentPlanVersion
      ? await this.store.getPlan(input.pocId, input.currentPlanVersion)
      : undefined;
    if (currentPlan) {
      await this.store.savePlan({
        ...currentPlan,
        status: "superseded",
      });
    }

    const revisedRequirements = applyRequirementChanges(requirements, input.changes);
    await this.store.saveRequirements(revisedRequirements);

    const nextVersion = (input.currentPlanVersion ?? currentPlan?.version ?? 1) + 1;
    const revisedPlan = this.generatePlan(revisedRequirements, nextVersion);
    await this.store.savePlan(revisedPlan);

    await this.sendPlanConfirmation({
      pocId: input.pocId,
      plan: revisedPlan,
      subject: "Please confirm your updated PostHog PoC plan",
      threadId: input.threadId,
      tags: [`poc:${input.pocId}`, "product:posthog", "stage:revision"],
    });
    await this.store.updateStatus(input.pocId, "confirmation_sent", input.createdAt);
    await this.audit.writeAuditLog({
      pocId: input.pocId,
      actor: "orchestrator",
      action: "revise_poc_plan",
      target: input.requestedBy,
      outputSummary: input.changes.join("; "),
      status: "succeeded",
      createdAt: input.createdAt,
    });

    return revisedPlan;
  }

  private async sendPlanConfirmation(input: {
    pocId: string;
    plan: PocPlan;
    subject: string;
    threadId?: string;
    tags: string[];
  }): Promise<{
    tokenId: string;
    publicApprovalUrl: string;
    expiresAt: string;
  }> {
    const recipients = input.plan.customer.contacts.map((contact) => contact.email);
    const waitpoint = await this.approval.createApprovalWaitpoint({
      pocId: input.pocId,
      timeout: "7d",
      approverEmails: recipients,
      idempotencyKey: `poc:${input.pocId}:approval:v${input.plan.version}`,
    });

    const sent = await this.email.sendEmail({
      to: recipients,
      subject: input.subject,
      markdownBody: renderConfirmationEmail(input.plan),
      threadId: input.threadId,
      tags: input.tags,
    });

    await this.store.updatePoc(input.pocId, {
      approvalTokenId: waitpoint.tokenId,
      approvalUrl: waitpoint.publicApprovalUrl,
      confirmationEmailId: sent.emailId,
      confirmationThreadId: sent.threadId,
    });

    return waitpoint;
  }

  private generatePlan(requirements: PocRequirements, version: number): PocPlan {
    const recipients = requirements.customer.contacts.map((contact) => contact.email);
    const events = requirements.analyticsScope.events;
    const dashboardName = `PoC - ${requirements.customer.companyName} - ${requirements.pocId}`;
    const fallbackDashboards = [
      {
        name: dashboardName,
        description: `PoC dashboard for ${requirements.customer.companyName}`,
        tiles: events.map((event) => ({
          title: humanizeEventName(event.name),
          type: "trend" as const,
          sourceEvents: [event.name],
        })),
      },
    ];

    return {
      pocId: requirements.pocId,
      version,
      status: "sent_for_confirmation",
      product: "posthog",
      customer: requirements.customer,
      objective: requirements.businessGoal,
      customerSummaryMarkdown: buildCustomerSummary(requirements),
      successCriteria: requirements.successCriteria,
      assumptions: requirements.assumptions,
      openQuestions: uniqueStrings([
        ...requirements.openQuestions,
        ...detectMissingDetails(requirements)
          .filter((detail) => detail.severity === "confirmable")
          .map((detail) => detail.question),
      ]),
      securityConstraints: requirements.securityConstraints,
      posthogTarget: {
        organizationId: requirements.posthogContext?.organizationId,
        projectId: requirements.posthogContext?.projectId,
        projectName: requirements.posthogContext?.projectName ?? dashboardName,
        region: requirements.posthogContext?.region,
        projectStrategy: requirements.posthogContext?.useExistingProject
          ? "existing_project"
          : "precreated_blank_project",
      },
      setup: {
        projectSettings: {
          timezone: requirements.customer.timezone ?? requirements.timeline?.timezone ?? "UTC",
          allowedDomains: requirements.securityConstraints?.allowedDomains,
        },
        events,
        actions: events.map((event) => ({
          name: humanizeEventName(event.name),
          description: event.description,
          matchEvents: [event.name],
        })),
        dashboards: normalizeDashboards(requirements.analyticsScope.dashboards, fallbackDashboards),
        cohorts: requirements.analyticsScope.cohorts ?? [],
        featureFlags: requirements.analyticsScope.featureFlags ?? [],
        experiments: requirements.analyticsScope.experiments ?? [],
        surveys: requirements.analyticsScope.surveys ?? [],
        alerts: requirements.analyticsScope.alerts ?? [],
        sessionReplay: requirements.analyticsScope.sessionReplay,
      },
      validationPlan: {
        syntheticEvents: events.filter((event) => event.required),
        requiredChecks: ["project", "dashboard", "schema"],
        acceptanceThreshold: "pass_or_warn",
      },
      handoffPlan: {
        recipients,
        includeSdkInstructions: true,
        includeTestingPlan: true,
        includeCredentialLinks: true,
        reviewDate: requirements.timeline?.reviewDate,
        teardownDate: requirements.timeline?.endDate,
      },
      approval: {},
    };
  }
}

function requirementsFromStructuredHints(
  structuredHints: Record<string, unknown> | undefined,
): Partial<PocRequirements> {
  const hints = structuredHints ?? {};
  const appContext = recordField(hints.appContext);
  const posthogContext = recordField(hints.posthogContext);
  const analyticsScope = recordField(hints.analyticsScope);

  return {
    businessGoal: stringField(hints.businessGoal),
    appContext: appContext
      ? {
          platform: platformArray(appContext.platform) ?? ["unknown"],
          appName: stringField(appContext.appName),
          appUrl: stringField(appContext.appUrl),
          techStack: stringArray(appContext.techStack),
          environments: environmentArray(appContext.environments),
        }
      : undefined,
    posthogContext: posthogContext
      ? {
          organizationId: stringField(posthogContext.organizationId),
          organizationName: stringField(posthogContext.organizationName),
          projectId: stringField(posthogContext.projectId),
          projectName: stringField(posthogContext.projectName),
          region: posthogRegion(posthogContext.region),
          useExistingProject: booleanField(posthogContext.useExistingProject),
        }
      : undefined,
    analyticsScope: analyticsScope
      ? {
          events: eventRequirements(analyticsScope.events),
          funnels: Array.isArray(analyticsScope.funnels)
            ? (analyticsScope.funnels as PocRequirements["analyticsScope"]["funnels"])
            : undefined,
          dashboards: Array.isArray(analyticsScope.dashboards)
            ? (analyticsScope.dashboards as PocRequirements["analyticsScope"]["dashboards"])
            : undefined,
          alerts: Array.isArray(analyticsScope.alerts)
            ? (analyticsScope.alerts as PocRequirements["analyticsScope"]["alerts"])
            : undefined,
        }
      : undefined,
  };
}

function mergeStructuredHints(
  defaults: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return deepMerge(defaults, input);
}

function deepMerge(
  defaults: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    const existing = merged[key];
    const existingRecord = recordField(existing);
    const valueRecord = recordField(value);
    if (existingRecord && valueRecord) {
      merged[key] = deepMerge(existingRecord, valueRecord);
      continue;
    }
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function mergePosthogContext(
  hints: Partial<NonNullable<PocRequirements["posthogContext"]>> | undefined,
  extracted: Partial<NonNullable<PocRequirements["posthogContext"]>> | undefined,
): PocRequirements["posthogContext"] {
  const merged = {
    ...definedPosthogContext(hints),
    ...definedPosthogContext(extracted),
  };
  return Object.keys(merged).length ? merged : undefined;
}

function definedPosthogContext(
  value: Partial<NonNullable<PocRequirements["posthogContext"]>> | undefined,
): Partial<NonNullable<PocRequirements["posthogContext"]>> {
  const record = recordField(value);
  if (!record) {
    return {};
  }
  const context: Partial<NonNullable<PocRequirements["posthogContext"]>> = {};
  const organizationId = stringField(record.organizationId);
  const organizationName = stringField(record.organizationName);
  const projectId = stringField(record.projectId);
  const projectName = stringField(record.projectName);
  const region = posthogRegion(record.region);
  const useExistingProject = booleanField(record.useExistingProject);
  if (organizationId) context.organizationId = organizationId;
  if (organizationName) context.organizationName = organizationName;
  if (projectId) context.projectId = projectId;
  if (projectName) context.projectName = projectName;
  if (region) context.region = region;
  if (useExistingProject !== undefined) context.useExistingProject = useExistingProject;
  return context;
}

function buildCustomerSummary(requirements: PocRequirements): string {
  const events = requirements.analyticsScope.events.map((event) => event.name);
  return [
    `**PostHog PoC for ${requirements.customer.companyName}**`,
    "",
    requirements.businessGoal,
    "",
    `We will track ${events.length} event(s)${events.length ? `: ${events.join(", ")}` : ""} ` +
      `and validate ${requirements.successCriteria.length} success criterion(s).`,
  ].join("\n");
}

function normalizeDashboards(
  dashboards: PocRequirements["analyticsScope"]["dashboards"],
  fallbackDashboards: PocPlan["setup"]["dashboards"],
): PocPlan["setup"]["dashboards"] {
  if (!dashboards?.length) {
    return fallbackDashboards;
  }

  const fallbackTiles = fallbackDashboards[0]?.tiles ?? [];
  return dashboards.map((dashboard) => ({
    ...dashboard,
    tiles: Array.isArray(dashboard.tiles) && dashboard.tiles.length ? dashboard.tiles : fallbackTiles,
  }));
}

function renderConfirmationEmail(plan: PocPlan): string {
  return [
    `Hi ${plan.customer.contacts[0]?.name ?? plan.customer.companyName},`,
    "",
    "Here is the PostHog PoC plan we captured.",
    "Please reply in your own words if the business goal, success criteria, audience, timeline, or definitions should change. If it looks right, a short confirmation is enough.",
    "We will handle the technical setup and follow up only when we need business context.",
    "",
    ...(plan.customerSummaryMarkdown ? [plan.customerSummaryMarkdown, ""] : []),
    "## Goal",
    "",
    plan.objective,
    "",
    "## Success criteria",
    "",
    ...plan.successCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Scope",
    "",
    `- PostHog project strategy: ${plan.posthogTarget.projectStrategy}`,
    `- Region: ${plan.posthogTarget.region ?? "Not specified"}`,
    `- Dashboards: ${plan.setup.dashboards.map((dashboard) => dashboard.name).join(", ") || "None"}`,
    `- Events/actions: ${plan.setup.events.map((event) => event.name).join(", ") || "None"}`,
    "",
    "## Assumptions",
    "",
    ...(plan.assumptions.length
      ? plan.assumptions.map((assumption) => `- ${assumption}`)
      : ["- None"]),
    "",
    "## Open questions",
    "",
    ...(plan.openQuestions.length
      ? plan.openQuestions.map((question) => `- ${question}`)
      : ["- None"]),
  ].join("\n");
}

function renderReplyClarificationEmail(
  intent: CustomerReplyClassification["intent"],
  lifecycleStatus: string,
): string {
  if (intent === "question") {
    return [
      "Thanks for the note.",
      "",
      "I need one more business detail before changing the PoC plan. Could you clarify the outcome or definition you want us to use for the active pilot?",
      "",
      `Current PoC status: ${lifecycleStatus}`,
    ].join("\n");
  }

  return [
    "Thanks for the reply.",
    "",
    "I could not confidently tell whether this confirms the current plan, changes the business scope, asks a question, or stops the PoC. Could you clarify the business outcome you want us to act on next?",
    "",
    `Current PoC status: ${lifecycleStatus}`,
  ].join("\n");
}

function renderClarificationEmail(
  requirements: PocRequirements,
  missingDetails: MissingDetail[],
): string {
  return [
    `Hi ${requirements.customer.contacts[0]?.name ?? requirements.customer.companyName},`,
    "",
    "We captured the PostHog PoC requirements, but need one detail before we can prepare the approval plan.",
    "",
    "## Needed before setup",
    "",
    ...missingDetails.map((detail) => `- ${detail.question}`),
    "",
    "Once we have this, we can resend the PoC plan for confirmation.",
  ].join("\n");
}

function detectMissingDetails(requirements: PocRequirements): MissingDetail[] {
  const missingDetails: MissingDetail[] = [];

  if (!requirements.posthogContext?.projectId) {
    missingDetails.push({
      key: "posthog.projectId",
      severity: "blocking",
      question:
        "Please provide the PostHog project ID to use for this PoC, or confirm that a blank PoC project has already been created.",
      suggestedDefault: "Use an existing or pre-created blank PostHog project.",
      reason:
        "The available PostHog MCP setup tools can read and configure a project, but this system does not create a new PostHog project yet.",
    });
  }

  if (!requirements.successCriteria.length) {
    missingDetails.push({
      key: "successCriteria",
      severity: "confirmable",
      question:
        "What does a successful PoC look like? We did not capture explicit success criteria.",
      reason: "Success criteria let us evaluate whether the PoC met its goals.",
    });
  }
  if (!requirements.analyticsScope.events.length) {
    missingDetails.push({
      key: "analyticsScope.events",
      severity: "confirmable",
      question: "Which product events should we track? No events were captured.",
      reason: "Events drive the actions, dashboards, and validation we set up.",
    });
  }
  const platforms = requirements.appContext?.platform ?? [];
  if (!platforms.length || platforms.every((platform) => platform === "unknown")) {
    missingDetails.push({
      key: "appContext.platform",
      severity: "confirmable",
      question: "Which platform(s) is the app on (web, iOS, Android)? We assumed web for now.",
      suggestedDefault: "web",
      reason: "Platform determines the SDK install instructions in the handoff.",
    });
  }
  if (!requirements.customer.contacts.some((contact) => contact.email)) {
    missingDetails.push({
      key: "customer.contacts",
      severity: "blocking",
      question: "Who is the primary contact (email) for this PoC? We could not find one.",
      reason: "We need a recipient to send the confirmation and handoff emails to.",
    });
  }

  return missingDetails;
}

function applyRequirementChanges(
  requirements: PocRequirements,
  changes: string[],
): PocRequirements {
  const cleanChanges = changes.map((change) => change.trim()).filter(Boolean);
  const requestedAssumptions = cleanChanges.map((change) => `Customer requested change: ${change}`);
  const region = requestedRegion(cleanChanges);

  return {
    ...requirements,
    assumptions: uniqueStrings([...requirements.assumptions, ...requestedAssumptions]),
    posthogContext: region
      ? {
          ...requirements.posthogContext,
          region,
        }
      : requirements.posthogContext,
  };
}

function requestedRegion(changes: string[]): "US" | "EU" | undefined {
  const text = changes.join("\n").toLowerCase();
  if (/\beu\b|europe|european/.test(text)) {
    return "EU";
  }
  if (/\bus\b|united states|usa/.test(text)) {
    return "US";
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function inferDashboardPresentationChanges(textBody: string): string[] {
  const text = textBody.toLowerCase();
  if (!text.length) {
    return [];
  }

  const hasDashboardContext = /(dashboard|report|handoff|view|chart|charts|graph|graphs|visual|visuals|metric|metrics|number|numbers|tile|tiles|gauge|card|cards)/.test(
    text,
  );
  if (!hasDashboardContext) {
    return [];
  }

  if (/too many\s+(numbers?|metrics?|kpis?|cards?)/.test(text)) {
    return [
      "Please reduce numeric-heavy dashboard tiles and focus on fewer, more readable chart-based views.",
    ];
  }

  if (/not enough\s+(graphs?|charts?|visuals?)/.test(text)) {
    return [
      "Please make the dashboard easier to read by adding more graph/chart-based visualizations and fewer numeric summaries.",
    ];
  }

  if (/hard to understand|too hard to|hardly understand|unclear/.test(text)) {
    return [
      "Please simplify the dashboard so outcomes are easier to understand, with more explanation-driven visuals.",
    ];
  }

  return [];
}

function isPostHandoffStatus(status: string): boolean {
  return (
    status === "handoff_sent" ||
    status === "handoff_sent_with_gaps" ||
    status === "active_poc" ||
    status === "monitoring_running" ||
    status === "monitoring_at_risk" ||
    status === "monitoring_criteria_met"
  );
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return strings.length ? strings : undefined;
}

function platformArray(value: unknown): PocRequirements["appContext"]["platform"] | undefined {
  const allowed = new Set(["web", "ios", "android", "backend", "unknown"]);
  const values = stringArray(value)?.filter((item) => allowed.has(item));
  return values?.length ? (values as PocRequirements["appContext"]["platform"]) : undefined;
}

function environmentArray(
  value: unknown,
): PocRequirements["appContext"]["environments"] | undefined {
  const allowed = new Set(["dev", "staging", "prod", "unknown"]);
  const values = stringArray(value)?.filter((item) => allowed.has(item));
  return values?.length ? (values as PocRequirements["appContext"]["environments"]) : undefined;
}

function posthogRegion(
  value: unknown,
): NonNullable<PocRequirements["posthogContext"]>["region"] | undefined {
  return value === "US" || value === "EU" || value === "unknown" ? value : undefined;
}

function eventRequirements(value: unknown): PocRequirements["analyticsScope"]["events"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PocRequirements["analyticsScope"]["events"] => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name, description: name, required: true, source: "customer" }] : [];
    }
    const record = recordField(item);
    const name = stringField(record?.name);
    if (!name) return [];
    return [
      {
        name,
        description: stringField(record?.description) ?? name,
        required: booleanField(record?.required) ?? true,
        source: record?.source === "agent_inferred" ? "agent_inferred" : "customer",
      },
    ];
  });
}

type ContactHint = { email?: string; name?: string; role?: string; isPrimary?: boolean };

function normalizeContacts(
  llmContacts: ContactHint[] | undefined,
  participantContacts: ContactHint[],
  primaryEmail: string,
) {
  const contactsByEmail = new Map<
    string,
    { email: string; name?: string; role?: string; isPrimary?: boolean }
  >();

  for (const contact of [...(participantContacts ?? []), ...(llmContacts ?? [])]) {
    if (!contact.email) {
      continue;
    }
    contactsByEmail.set(contact.email, {
      ...contactsByEmail.get(contact.email),
      ...contact,
      email: contact.email,
      isPrimary: contact.email === primaryEmail || contact.isPrimary,
    });
  }

  if (!contactsByEmail.has(primaryEmail)) {
    contactsByEmail.set(primaryEmail, { email: primaryEmail, isPrimary: true });
  }

  return [...contactsByEmail.values()];
}

function firstEmail(contacts: { email?: string }[] | undefined): string | undefined {
  return contacts?.find((contact) => contact.email)?.email;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function humanizeEventName(value: string): string {
  return value
    .replace(/^poc_[a-z0-9]+:\s*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isReplyIntent(value: unknown): value is CustomerReplyClassification["intent"] {
  return (
    value === "approved" ||
    value === "needs_changes" ||
    value === "question" ||
    value === "rejected" ||
    value === "unclear"
  );
}
