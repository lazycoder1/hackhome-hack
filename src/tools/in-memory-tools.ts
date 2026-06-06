import type {
  PosthogResourceRef,
  PosthogUsageSnapshot,
  ValidationCheck,
  ValidationReport,
} from "../contracts.js";
import type {
  ApprovalTool,
  AuditTool,
  EmailTool,
  PostHogEventCaptureTool,
  PostHogProject,
  PostHogUsageSnapshotTool,
  PostHogToolGateway,
  SecretsTool,
  SendEmailInput,
  SyntheticEventCaptureResult,
  SyntheticEventVisibilityResult,
  ValidationTool,
} from "./types.js";

type ClockOptions = {
  clock?: () => Date;
};

export class InMemoryEmailTool implements EmailTool {
  readonly sentEmails: (SendEmailInput & { emailId: string; threadId: string; sentAt: string })[] =
    [];
  readonly inboxMessages: {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    textBody: string;
    receivedAt: string;
  }[] = [];

  private readonly clock: () => Date;

  constructor(options: ClockOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async sendEmail(
    input: SendEmailInput,
  ): Promise<{ emailId: string; threadId: string; sentAt: string }> {
    const emailId = `email-${this.sentEmails.length + 1}`;
    const threadId = input.threadId ?? `thread-${this.sentEmails.length + 1}`;
    const sentAt = this.clock().toISOString();

    this.sentEmails.push({
      ...input,
      emailId,
      threadId,
      sentAt,
    });

    return { emailId, threadId, sentAt };
  }

  addIncomingEmail(input: {
    from: string;
    to: string[];
    subject: string;
    textBody: string;
    threadId?: string;
    receivedAt?: string;
  }): void {
    this.inboxMessages.push({
      id: `inbox-${this.inboxMessages.length + 1}`,
      threadId: input.threadId ?? `thread-${this.inboxMessages.length + 1}`,
      from: input.from,
      to: input.to,
      subject: input.subject,
      textBody: input.textBody,
      receivedAt: input.receivedAt ?? this.clock().toISOString(),
    });
  }

  async checkInbox(input: {
    customerEmail?: string;
    threadId?: string;
    since?: string;
    tags?: string[];
  }): Promise<{
    messages: {
      id: string;
      threadId: string;
      from: string;
      to: string[];
      subject: string;
      textBody: string;
      receivedAt: string;
    }[];
  }> {
    const sinceMs = input.since ? Date.parse(input.since) : undefined;
    const messages = this.inboxMessages.filter((message) => {
      if (input.threadId && message.threadId !== input.threadId) {
        return false;
      }
      if (input.customerEmail && message.from !== input.customerEmail) {
        return false;
      }
      if (sinceMs && Date.parse(message.receivedAt) < sinceMs) {
        return false;
      }
      return true;
    });

    return { messages };
  }
}

export class InMemoryApprovalTool implements ApprovalTool {
  private readonly baseApprovalUrl: string;
  private readonly clock: () => Date;
  private readonly waitpoints = new Map<
    string,
    {
      tokenId: string;
      pocId: string;
      idempotencyKey: string;
      approverEmails: string[];
      expiresAt: string;
      decision?: {
        decision: "approved" | "rejected" | "needs_changes";
        decidedBy: string;
        notes?: string;
        changes?: string[];
      };
    }
  >();

  constructor(options: ClockOptions & { baseApprovalUrl?: string } = {}) {
    this.baseApprovalUrl = options.baseApprovalUrl ?? "https://approve.example.test";
    this.clock = options.clock ?? (() => new Date());
  }

  async createApprovalWaitpoint(input: {
    pocId: string;
    timeout: string;
    approverEmails: string[];
    idempotencyKey: string;
  }): Promise<{ tokenId: string; publicApprovalUrl: string; expiresAt: string }> {
    const existing = [...this.waitpoints.values()].find(
      (waitpoint) => waitpoint.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      return {
        tokenId: existing.tokenId,
        publicApprovalUrl: `${this.baseApprovalUrl}/${existing.tokenId}`,
        expiresAt: existing.expiresAt,
      };
    }

    const tokenId = `approval-token-${this.waitpoints.size + 1}`;
    const expiresAt = addDuration(this.clock(), input.timeout).toISOString();
    this.waitpoints.set(tokenId, {
      tokenId,
      pocId: input.pocId,
      idempotencyKey: input.idempotencyKey,
      approverEmails: input.approverEmails,
      expiresAt,
    });

    return {
      tokenId,
      publicApprovalUrl: `${this.baseApprovalUrl}/${tokenId}`,
      expiresAt,
    };
  }

  async completeApprovalWaitpoint(input: {
    tokenId: string;
    decision: "approved" | "rejected" | "needs_changes";
    decidedBy: string;
    notes?: string;
    changes?: string[];
  }): Promise<{ success: boolean }> {
    const waitpoint = this.waitpoints.get(input.tokenId);
    if (!waitpoint) {
      throw new Error(`Unknown approval token: ${input.tokenId}`);
    }
    if (waitpoint.decision) {
      return { success: false };
    }

    waitpoint.decision = {
      decision: input.decision,
      decidedBy: input.decidedBy,
      notes: input.notes,
      changes: input.changes,
    };
    return { success: true };
  }

  getDecision(tokenId: string):
    | {
        decision: "approved" | "rejected" | "needs_changes";
        decidedBy: string;
        notes?: string;
        changes?: string[];
      }
    | undefined {
    return this.waitpoints.get(tokenId)?.decision;
  }
}

export class InMemorySecretsTool implements SecretsTool {
  private readonly baseSecretUrl: string;
  private readonly clock: () => Date;
  private readonly secrets = new Map<
    string,
    { name: string; value: string; expiresAt?: string; revoked?: boolean }
  >();
  private readonly oneTimeLinks = new Map<
    string,
    { secretRef: string; used: boolean; expiresAt: string }
  >();

  constructor(options: ClockOptions & { baseSecretUrl?: string } = {}) {
    this.baseSecretUrl = options.baseSecretUrl ?? "https://secrets.example.test";
    this.clock = options.clock ?? (() => new Date());
  }

  async createSecret(input: {
    pocId: string;
    name: string;
    value: string;
    ttl?: string;
    tags?: string[];
  }): Promise<{ secretRef: string; expiresAt?: string }> {
    const secretRef = `secret-${this.secrets.size + 1}`;
    const expiresAt = input.ttl ? addDuration(this.clock(), input.ttl).toISOString() : undefined;
    this.secrets.set(secretRef, { name: input.name, value: input.value, expiresAt });
    return { secretRef, expiresAt };
  }

  async createOneTimeSecretLink(input: {
    secretRef: string;
    recipientEmail: string;
    expiresIn: string;
  }): Promise<{ url: string; expiresAt: string }> {
    if (!this.secrets.has(input.secretRef)) {
      throw new Error(`Unknown secret ref: ${input.secretRef}`);
    }

    const token = `one-time-${this.oneTimeLinks.size + 1}`;
    const expiresAt = addDuration(this.clock(), input.expiresIn).toISOString();
    this.oneTimeLinks.set(token, {
      secretRef: input.secretRef,
      used: false,
      expiresAt,
    });

    return {
      url: `${this.baseSecretUrl}/${token}`,
      expiresAt,
    };
  }

  async consumeOneTimeSecretLink(input: { token: string }): Promise<
    | {
        status: "consumed";
        name: string;
        value: string;
        expiresAt?: string;
      }
    | {
        status: "not_found" | "expired" | "used" | "revoked";
      }
  > {
    const link = this.oneTimeLinks.get(input.token);
    if (!link) {
      return { status: "not_found" };
    }
    if (link.used) {
      return { status: "used" };
    }
    if (Date.parse(link.expiresAt) < this.clock().getTime()) {
      return { status: "expired" };
    }

    const secret = this.secrets.get(link.secretRef);
    if (!secret) {
      return { status: "not_found" };
    }
    if (secret.revoked) {
      return { status: "revoked" };
    }
    if (secret.expiresAt && Date.parse(secret.expiresAt) < this.clock().getTime()) {
      return { status: "expired" };
    }

    link.used = true;
    return {
      status: "consumed",
      name: secret.name,
      value: secret.value,
      expiresAt: secret.expiresAt ?? link.expiresAt,
    };
  }

  async rotateOrRevokeSecret(input: {
    secretRef: string;
    action: "rotate" | "revoke";
    reason: string;
  }): Promise<{ success: boolean; newSecretRef?: string }> {
    if (!this.secrets.has(input.secretRef)) {
      return { success: false };
    }

    if (input.action === "revoke") {
      const secret = this.secrets.get(input.secretRef);
      if (secret) {
        secret.revoked = true;
      }
      return { success: true };
    }

    const current = this.secrets.get(input.secretRef);
    if (!current) {
      return { success: false };
    }

    const newSecretRef = `secret-${this.secrets.size + 1}`;
    this.secrets.set(newSecretRef, current);
    this.secrets.delete(input.secretRef);
    return { success: true, newSecretRef };
  }
}

export class InMemoryPostHogGateway implements PostHogToolGateway {
  private readonly projects = new Map<
    string,
    PostHogProject & {
      settings: Record<string, unknown>;
      resources: PosthogResourceRef[];
    }
  >();

  async getProject(projectId: string): Promise<PostHogProject> {
    const project = this.ensureProject(projectId);
    return {
      id: project.id,
      name: project.name,
      url: project.url,
      hostUrl: project.hostUrl,
      organizationId: project.organizationId,
    };
  }

  async updateProjectSettings(projectId: string, settings: Record<string, unknown>): Promise<void> {
    const project = this.ensureProject(projectId);
    project.settings = { ...project.settings, ...settings };
  }

  async createAction(input: {
    projectId: string;
    name: string;
    description: string;
    matchEvents: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "action",
      name: input.name,
      tags: input.tags,
    });
  }

  async createDashboard(input: {
    projectId: string;
    name: string;
    description?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "dashboard",
      name: input.name,
      tags: input.tags,
      url: `https://posthog.example.test/project/${input.projectId}/dashboard/${this.nextResourceNumber(input.projectId)}`,
    });
  }

  async createInsight(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    type: string;
    sourceEvents?: string[];
    query?: Record<string, unknown>;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "insight",
      name: input.name,
      tags: input.tags,
    });
  }

  async createCohort(input: {
    projectId: string;
    name: string;
    description?: string;
    criteria: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "cohort",
      name: input.name,
      tags: input.tags,
    });
  }

  async createFeatureFlag(input: {
    projectId: string;
    key: string;
    name: string;
    description?: string;
    rollout?: {
      percentage?: number;
      conditions?: string;
    };
    testUsers?: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "feature_flag",
      name: input.name,
      tags: input.tags,
    });
  }

  async createExperiment(input: {
    projectId: string;
    name: string;
    hypothesis: string;
    variants: string[];
    primaryMetric: string;
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "experiment",
      name: input.name,
      tags: input.tags,
    });
  }

  async createSurvey(input: {
    projectId: string;
    name: string;
    questions: {
      prompt: string;
      type: "open_text" | "rating" | "single_choice" | "multiple_choice";
      options?: string[];
    }[];
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "survey",
      name: input.name,
      tags: input.tags,
    });
  }

  async createAlert(input: {
    projectId: string;
    name: string;
    condition: string;
    destination?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.createResource(input.projectId, {
      type: "alert",
      name: input.name,
      tags: input.tags,
    });
  }

  getProjectState(projectId: string):
    | (PostHogProject & {
        settings: Record<string, unknown>;
        resources: PosthogResourceRef[];
      })
    | undefined {
    return this.projects.get(projectId);
  }

  private ensureProject(projectId: string): PostHogProject & {
    settings: Record<string, unknown>;
    resources: PosthogResourceRef[];
  } {
    const existing = this.projects.get(projectId);
    if (existing) {
      return existing;
    }

    const project = {
      id: projectId,
      name: `Project ${projectId}`,
      url: `https://posthog.example.test/project/${projectId}`,
      hostUrl: "https://us.i.posthog.com",
      settings: {},
      resources: [],
    };
    this.projects.set(projectId, project);
    return project;
  }

  private createResource(
    projectId: string,
    input: Pick<PosthogResourceRef, "type" | "name" | "tags"> & { url?: string },
  ): PosthogResourceRef {
    const project = this.ensureProject(projectId);
    const id = `${input.type}-${project.resources.length + 1}`;
    const resource = {
      type: input.type,
      id,
      name: input.name,
      url: input.url,
      tags: input.tags,
    };
    project.resources.push(resource);
    return resource;
  }

  private nextResourceNumber(projectId: string): number {
    return this.ensureProject(projectId).resources.length + 1;
  }
}

export class InMemoryPostHogEventCaptureTool implements PostHogEventCaptureTool {
  readonly captures: {
    pocId: string;
    posthogProjectId: string;
    hostUrl: string;
    eventNames: string[];
  }[] = [];

  private readonly clock: () => Date;

  constructor(options: ClockOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async captureSyntheticEvents(input: {
    pocId: string;
    posthogProjectId: string;
    hostUrl: string;
    events: { name: string }[];
  }): Promise<SyntheticEventCaptureResult> {
    const eventNames = input.events.map((event) => event.name);
    this.captures.push({
      pocId: input.pocId,
      posthogProjectId: input.posthogProjectId,
      hostUrl: input.hostUrl,
      eventNames,
    });

    return {
      status: input.events.length ? "sent" : "skipped",
      requestedEventCount: input.events.length,
      eventsSent: input.events.length,
      eventNames,
      capturedAt: this.clock().toISOString(),
      reason: input.events.length ? undefined : "No synthetic events were requested.",
    };
  }
}

export class InMemoryPostHogUsageSnapshotTool implements PostHogUsageSnapshotTool {
  private readonly snapshots = new Map<string, PosthogUsageSnapshot>();

  setSnapshot(pocId: string, snapshot: PosthogUsageSnapshot): void {
    this.snapshots.set(pocId, snapshot);
  }

  async collectPosthogUsageSnapshot(input: { pocId: string }): Promise<PosthogUsageSnapshot> {
    return (
      this.snapshots.get(input.pocId) ?? {
        totalEvents: 0,
        uniqueUsers: 0,
        events: [],
      }
    );
  }
}

export class ResourceValidationTool implements ValidationTool {
  private readonly clock: () => Date;

  constructor(options: ClockOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async validatePosthogSetup(input: {
    pocId: string;
    posthogProjectId: string;
    expectedResources: {
      actions: PosthogResourceRef[];
      dashboards: PosthogResourceRef[];
      insights: PosthogResourceRef[];
    };
    syntheticEventCapture?: SyntheticEventCaptureResult;
    syntheticEventVisibility?: SyntheticEventVisibilityResult;
    expectedEvents?: string[];
  }): Promise<ValidationReport> {
    const checks: ValidationCheck[] = [
      resourceGroupCheck("actions", "Actions created", input.expectedResources.actions),
      resourceGroupCheck("dashboards", "Dashboards created", input.expectedResources.dashboards),
      resourceGroupCheck("insights", "Insights created", input.expectedResources.insights),
    ];
    const syntheticCheck = syntheticEventCaptureCheck(input.syntheticEventCapture);
    if (syntheticCheck) {
      checks.push(syntheticCheck);
    }
    const visibilityCheck = syntheticEventVisibilityCheck(input.syntheticEventVisibility);
    if (visibilityCheck) {
      checks.push(visibilityCheck);
    }
    const hasFailures = checks.some((check) => check.status === "fail");
    const hasWarnings = checks.some((check) => check.status === "warn");
    const status = hasFailures ? "fail" : hasWarnings ? "warn" : "pass";

    return {
      pocId: input.pocId,
      status,
      checkedAt: this.clock().toISOString(),
      checks,
      summary:
        status === "pass"
          ? "All required local resource checks passed."
          : status === "warn"
            ? "Required resources exist, but synthetic event validation warned."
            : "Required resources are missing.",
      knownGaps:
        status === "pass"
          ? []
          : status === "warn"
            ? ["Synthetic event capture or visibility validation warned."]
            : ["One or more expected PostHog resource groups are missing."],
    };
  }
}

export class InMemoryAuditTool implements AuditTool {
  readonly events: {
    auditEventId: string;
    pocId: string;
    actor:
      | "orchestrator"
      | "posthog_setup_agent"
      | "poc_monitoring_agent"
      | "validation_runner"
      | "human"
      | "system";
    action: string;
    target?: string;
    inputHash?: string;
    outputSummary?: string;
    status: "started" | "succeeded" | "failed" | "skipped";
    error?: string;
    createdAt: string;
  }[] = [];

  private readonly clock: () => Date;

  constructor(options: ClockOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async writeAuditLog(input: {
    pocId: string;
    actor:
      | "orchestrator"
      | "posthog_setup_agent"
      | "poc_monitoring_agent"
      | "validation_runner"
      | "human"
      | "system";
    action: string;
    target?: string;
    inputHash?: string;
    outputSummary?: string;
    status: "started" | "succeeded" | "failed" | "skipped";
    error?: string;
    createdAt?: string;
  }): Promise<{ auditEventId: string }> {
    const auditEventId = `audit-${this.events.length + 1}`;
    this.events.push({
      ...input,
      auditEventId,
      createdAt: input.createdAt ?? this.clock().toISOString(),
    });
    return { auditEventId };
  }
}

function resourceGroupCheck(
  id: string,
  name: string,
  resources: PosthogResourceRef[],
): ValidationCheck {
  return {
    id,
    name,
    status: resources.length > 0 ? "pass" : "fail",
    evidence: `${resources.length} resource(s) found.`,
  };
}

function syntheticEventCaptureCheck(
  capture: SyntheticEventCaptureResult | undefined,
): ValidationCheck | undefined {
  if (!capture || capture.requestedEventCount === 0) {
    return undefined;
  }

  return {
    id: "synthetic-events",
    name: "Synthetic events captured",
    status: capture.status === "sent" ? "pass" : "warn",
    evidence: `${capture.eventsSent}/${capture.requestedEventCount} synthetic event(s) sent: ${capture.eventNames.join(", ")}`,
    error: capture.error ?? capture.reason,
  };
}

function syntheticEventVisibilityCheck(
  visibility: SyntheticEventVisibilityResult | undefined,
): ValidationCheck | undefined {
  if (!visibility || visibility.requestedEventCount === 0) {
    return undefined;
  }

  return {
    id: "synthetic-event-visibility",
    name: "Synthetic events visible in PostHog",
    status: visibility.status === "visible" ? "pass" : "warn",
    evidence: `${visibility.visibleEventCount}/${visibility.requestedEventCount} synthetic event type(s) visible after ${visibility.attempts} attempt(s).`,
    error: visibility.error ?? visibility.reason,
  };
}

function addDuration(date: Date, duration: string): Date {
  const match = /^(\d+)([dhm])$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported duration: ${duration}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds =
    unit === "d"
      ? amount * 24 * 60 * 60 * 1000
      : unit === "h"
        ? amount * 60 * 60 * 1000
        : amount * 60 * 1000;

  return new Date(date.getTime() + milliseconds);
}
