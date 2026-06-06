import type {
  EventRequirement,
  PosthogResourceRef,
  PosthogUsageSnapshot,
  ValidationReport,
} from "../contracts.js";

export type SendEmailInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  markdownBody: string;
  attachments?: {
    filename: string;
    contentType: string;
    storageRef: string;
  }[];
  threadId?: string;
  tags?: string[];
};

export type EmailTool = {
  sendEmail(input: SendEmailInput): Promise<{
    emailId: string;
    threadId: string;
    sentAt: string;
  }>;
};

export type ApprovalTool = {
  createApprovalWaitpoint(input: {
    pocId: string;
    timeout: string;
    approverEmails: string[];
    idempotencyKey: string;
  }): Promise<{
    tokenId: string;
    publicApprovalUrl: string;
    expiresAt: string;
  }>;
  completeApprovalWaitpoint(input: {
    tokenId: string;
    decision: "approved" | "rejected" | "needs_changes";
    decidedBy: string;
    notes?: string;
    changes?: string[];
  }): Promise<{ success: boolean }>;
};

export type AuditTool = {
  writeAuditLog(input: {
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
  }): Promise<{ auditEventId: string }>;
};

export type SecretsTool = {
  createSecret(input: {
    pocId: string;
    name: string;
    value: string;
    ttl?: string;
    tags?: string[];
  }): Promise<{
    secretRef: string;
    expiresAt?: string;
  }>;
  createOneTimeSecretLink(input: {
    secretRef: string;
    recipientEmail: string;
    expiresIn: string;
  }): Promise<{
    url: string;
    expiresAt: string;
  }>;
  consumeOneTimeSecretLink(input: { token: string }): Promise<
    | {
        status: "consumed";
        name: string;
        value: string;
        expiresAt?: string;
      }
    | {
        status: "not_found" | "expired" | "used" | "revoked";
      }
  >;
  rotateOrRevokeSecret(input: {
    secretRef: string;
    action: "rotate" | "revoke";
    reason: string;
  }): Promise<{
    success: boolean;
    newSecretRef?: string;
  }>;
};

export type ValidationTool = {
  validatePosthogSetup(input: {
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
  }): Promise<ValidationReport>;
};

export type SyntheticEventCaptureResult = {
  status: "sent" | "skipped" | "failed";
  requestedEventCount: number;
  eventsSent: number;
  eventNames: string[];
  capturedAt: string;
  reason?: string;
  error?: string;
};

export type PostHogEventCaptureTool = {
  captureSyntheticEvents(input: {
    pocId: string;
    posthogProjectId: string;
    hostUrl: string;
    events: EventRequirement[];
  }): Promise<SyntheticEventCaptureResult>;
};

export type SyntheticEventVisibilityResult = {
  status: "visible" | "not_visible" | "skipped" | "failed";
  requestedEventCount: number;
  visibleEventCount: number;
  missingEventNames: string[];
  visibleEventNames: string[];
  attempts: number;
  checkedAt: string;
  query?: string;
  reason?: string;
  error?: string;
};

export type PostHogSyntheticEventVerifier = {
  verifySyntheticEvents(input: {
    pocId: string;
    posthogProjectId: string;
    eventNames: string[];
  }): Promise<SyntheticEventVisibilityResult>;
};

export type PostHogUsageSnapshotTool = {
  collectPosthogUsageSnapshot(input: {
    pocId: string;
    posthogProjectId: string;
    window: {
      from: string;
      to: string;
    };
    expectedEvents: string[];
    resourceRefs: PosthogResourceRef[];
  }): Promise<PosthogUsageSnapshot>;
};

export type PostHogProject = {
  id: string;
  name: string;
  url: string;
  hostUrl: string;
  organizationId?: string;
};

export type PostHogToolGateway = {
  getProject(projectId: string): Promise<PostHogProject>;
  updateProjectSettings(projectId: string, settings: Record<string, unknown>): Promise<void>;
  createAction(input: {
    projectId: string;
    name: string;
    description: string;
    matchEvents: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createDashboard(input: {
    projectId: string;
    name: string;
    description?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createInsight(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    type: string;
    sourceEvents?: string[];
    query?: Record<string, unknown>;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  readDataSchema?(input: {
    projectId: string;
    query?: Record<string, unknown>;
  }): Promise<unknown>;
  executeSql?(input: {
    projectId: string;
    query: string;
  }): Promise<unknown>;
  createCohort?(input: {
    projectId: string;
    name: string;
    description?: string;
    criteria: string;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createFeatureFlag?(input: {
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
  }): Promise<PosthogResourceRef>;
  createExperiment?(input: {
    projectId: string;
    name: string;
    hypothesis: string;
    variants: string[];
    primaryMetric: string;
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createSurvey?(input: {
    projectId: string;
    name: string;
    questions: {
      prompt: string;
      type: "open_text" | "rating" | "single_choice" | "multiple_choice";
      options?: string[];
    }[];
    launchDuringPoC: boolean;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
  createAlert?(input: {
    projectId: string;
    name: string;
    condition: string;
    destination?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef>;
};
