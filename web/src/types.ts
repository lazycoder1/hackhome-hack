// Mirrors src/contracts.ts and src/status/poc-status-reader.ts on the backend.
// Kept as a hand-maintained copy so the SPA stays a standalone build.

export type Product = "posthog";

export type GoogleIntegrationStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  expiresAt?: string;
  scopes: string[];
  provider: string;
  deliveryMode: "draft" | "send";
  memoryOnly: boolean;
  storage: "memory" | "file";
};

export type PocLifecycleStatus =
  | "intake_received"
  | "requirements_extracted"
  | "needs_clarification"
  | "confirmation_sent"
  | "approved"
  | "rejected"
  | "setup_queued"
  | "setup_running"
  | "validation_running"
  | "handoff_ready"
  | "handoff_sent"
  | "handoff_sent_with_gaps"
  | "active_poc"
  | "needs_human_review"
  | "failed"
  | "completed"
  | "teardown_queued"
  | "teardown_complete";

export type CustomerContact = {
  name?: string;
  email: string;
  role?: string;
  isPrimary?: boolean;
};

export type Customer = {
  companyName: string;
  companySlug: string;
  contacts: CustomerContact[];
  timezone?: string;
};

export type EventRequirement = {
  name: string;
  description: string;
  source?: "customer" | "agent_inferred";
  required: boolean;
  properties?: {
    name: string;
    type?: "string" | "number" | "boolean" | "datetime" | "json" | "unknown";
    description?: string;
    required?: boolean;
  }[];
  testValues?: Record<string, unknown>;
};

export type FunnelRequirement = {
  name: string;
  steps: string[];
  conversionWindow?: string;
  successCriterion?: string;
};

export type DashboardRequirement = {
  name: string;
  description?: string;
  tiles: {
    title: string;
    type: "trend" | "funnel" | "retention" | "paths" | "text" | "other";
    sourceEvents?: string[];
    successCriterion?: string;
  }[];
};

export type CohortRequirement = { name: string; description?: string; criteria: string };

export type FeatureFlagRequirement = {
  key: string;
  name: string;
  description?: string;
  rollout?: { percentage?: number; conditions?: string };
  testUsers?: string[];
};

export type SurveyRequirement = {
  name: string;
  questions: {
    prompt: string;
    type: "open_text" | "rating" | "single_choice" | "multiple_choice";
    options?: string[];
  }[];
  launchDuringPoC: boolean;
};

export type AlertRequirement = { name: string; condition: string; destination?: string };

export type SessionReplayRequirement = {
  enabled: boolean;
  pagesOrFlows?: string[];
  privacyNotes?: string[];
};

export type PocRequirements = {
  pocId: string;
  product: Product;
  customer: Customer;
  businessGoal: string;
  successCriteria: string[];
  appContext: {
    appName?: string;
    appUrl?: string;
    platform: ("web" | "ios" | "android" | "backend" | "unknown")[];
    techStack?: string[];
    environments?: ("dev" | "staging" | "prod" | "unknown")[];
  };
  posthogContext?: {
    organizationName?: string;
    projectName?: string;
    region?: "US" | "EU" | "unknown";
    useExistingProject?: boolean;
  };
  analyticsScope: {
    events: EventRequirement[];
    funnels?: FunnelRequirement[];
    dashboards?: DashboardRequirement[];
    cohorts?: CohortRequirement[];
    featureFlags?: FeatureFlagRequirement[];
    surveys?: SurveyRequirement[];
    alerts?: AlertRequirement[];
    sessionReplay?: SessionReplayRequirement;
  };
  securityConstraints?: {
    piiPolicy?: string;
    maskTextInputs?: boolean;
    maskSensitiveProperties?: string[];
    allowedDomains?: string[];
    credentialExpiry?: string;
    customerRequiresOwnAccount?: boolean;
  };
  timeline?: {
    desiredStartDate?: string;
    reviewDate?: string;
    endDate?: string;
    timezone?: string;
  };
  assumptions: string[];
  openQuestions: string[];
  source: {
    sourceKind: "api" | "file" | "email" | "manual" | "other";
    sourceId?: string;
    receivedAt: string;
  };
};

export type PocPlan = {
  pocId: string;
  version: number;
  status: "draft" | "sent_for_confirmation" | "approved" | "rejected" | "superseded";
  customer: Customer;
  product: Product;
  objective: string;
  successCriteria: string[];
  assumptions: string[];
  openQuestions: string[];
  securityConstraints?: PocRequirements["securityConstraints"];
  posthogTarget: {
    projectName: string;
    region?: "US" | "EU" | "unknown";
    projectUrl?: string;
    projectStrategy: "existing_project" | "precreated_blank_project" | "admin_tool_create_project";
  };
  setup: {
    projectSettings: Record<string, unknown>;
    events: EventRequirement[];
    actions: { name: string; description: string; matchEvents: string[] }[];
    dashboards: DashboardRequirement[];
    cohorts: CohortRequirement[];
    featureFlags: FeatureFlagRequirement[];
    surveys: SurveyRequirement[];
    alerts: AlertRequirement[];
    sessionReplay?: SessionReplayRequirement;
  };
  validationPlan: {
    syntheticEvents: EventRequirement[];
    requiredChecks: string[];
    acceptanceThreshold: "all_pass" | "pass_or_warn";
  };
  handoffPlan: {
    recipients: string[];
    includeSdkInstructions: boolean;
    includeTestingPlan: boolean;
    includeCredentialLinks: boolean;
    reviewDate?: string;
    teardownDate?: string;
  };
  approval: {
    approvedBy?: string;
    approvedAt?: string;
    approvalSource?: "email_reply" | "approval_link" | "internal_operator";
  };
};

export type PosthogResourceRef = {
  type:
    | "project"
    | "dashboard"
    | "dashboard_tile"
    | "insight"
    | "action"
    | "cohort"
    | "feature_flag"
    | "experiment"
    | "survey"
    | "alert"
    | "subscription"
    | "cdp_function"
    | "session_recording_playlist";
  id: string;
  name: string;
  url?: string;
  tags?: string[];
};

export type ValidationCheck = {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail" | "skipped";
  evidence?: string;
  resourceRef?: PosthogResourceRef;
  error?: string;
};

export type ValidationReport = {
  pocId: string;
  status: "pass" | "warn" | "fail";
  checkedAt: string;
  checks: ValidationCheck[];
  summary: string;
  knownGaps: string[];
};

export type SetupResult = {
  pocId: string;
  status: "succeeded" | "succeeded_with_warnings" | "failed";
  posthog: {
    organizationId?: string;
    projectId: string;
    projectName: string;
    projectUrl: string;
    hostUrl: string;
  };
  createdResources: PosthogResourceRef[];
  updatedResources: PosthogResourceRef[];
  skippedResources: { reason: string; resource: Partial<PosthogResourceRef> }[];
  credentialRefs: {
    name: string;
    secretRef: string;
    oneTimeLink?: string;
    expiresAt?: string;
  }[];
  sdkInstructions: { platform: string; markdown: string }[];
  knownGaps: string[];
  validationReport?: ValidationReport;
  auditEventIds: string[];
};

export type PocStatusSummary = {
  pocId: string;
  status: PocLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  activePlanVersion?: number;
  customerCompany?: string;
  customerSlug?: string;
  product?: "posthog";
  objective?: string;
  approvalUrl?: string;
  confirmationThreadId?: string;
  hasRequirements: boolean;
  hasActivePlan: boolean;
  hasSetupResult: boolean;
  setupStatus?: SetupResult["status"];
  validationStatus?: ValidationReport["status"];
};

export type PocStatusDetail = PocStatusSummary & {
  requirements?: PocRequirements;
  activePlan?: PocPlan;
  setupResult?: SetupResult;
};
