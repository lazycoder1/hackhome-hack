export type Product = "posthog";

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
  | "monitoring_running"
  | "monitoring_at_risk"
  | "monitoring_criteria_met"
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

export type CohortRequirement = {
  name: string;
  description?: string;
  criteria: string;
};

export type FeatureFlagRequirement = {
  key: string;
  name: string;
  description?: string;
  rollout?: {
    percentage?: number;
    conditions?: string;
  };
  testUsers?: string[];
};

export type ExperimentRequirement = {
  name: string;
  hypothesis: string;
  variants: string[];
  primaryMetric: string;
  launchDuringPoC: boolean;
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

export type AlertRequirement = {
  name: string;
  condition: string;
  destination?: string;
};

export type SessionReplayRequirement = {
  enabled: boolean;
  pagesOrFlows?: string[];
  privacyNotes?: string[];
};

export type ExportRequirement = {
  destination: string;
  dataScope: string;
  schedule?: string;
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
    organizationId?: string;
    organizationName?: string;
    projectId?: string;
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
    experiments?: ExperimentRequirement[];
    surveys?: SurveyRequirement[];
    alerts?: AlertRequirement[];
    sessionReplay?: SessionReplayRequirement;
    exports?: ExportRequirement[];
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
    filename?: string;
    emailThreadId?: string;
    receivedAt: string;
  };
};

export type MissingDetail = {
  key: string;
  severity: "blocking" | "confirmable" | "optional";
  question: string;
  suggestedDefault?: string;
  reason: string;
};

export type PocPlan = {
  pocId: string;
  version: number;
  status: "draft" | "sent_for_confirmation" | "approved" | "rejected" | "superseded";
  customer: Customer;
  product: Product;
  objective: string;
  customerSummaryMarkdown?: string;
  successCriteria: string[];
  assumptions: string[];
  openQuestions: string[];
  securityConstraints?: PocRequirements["securityConstraints"];
  posthogTarget: {
    organizationId?: string;
    projectId?: string;
    projectName: string;
    region?: "US" | "EU" | "unknown";
    projectUrl?: string;
    projectStrategy: "existing_project" | "precreated_blank_project" | "admin_tool_create_project";
  };
  setup: {
    projectSettings: Record<string, unknown>;
    events: EventRequirement[];
    actions: {
      name: string;
      description: string;
      matchEvents: string[];
    }[];
    dashboards: DashboardRequirement[];
    cohorts: CohortRequirement[];
    featureFlags: FeatureFlagRequirement[];
    experiments: ExperimentRequirement[];
    surveys: SurveyRequirement[];
    alerts: AlertRequirement[];
    sessionReplay?: SessionReplayRequirement;
    subscriptions?: {
      name: string;
      destination: string;
      schedule?: string;
    }[];
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
    approvalEvidenceRef?: string;
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
  skippedResources: {
    reason: string;
    resource: Partial<PosthogResourceRef>;
  }[];
  credentialRefs: {
    name: string;
    secretRef: string;
    oneTimeLink?: string;
    expiresAt?: string;
  }[];
  sdkInstructions: {
    platform: string;
    markdown: string;
  }[];
  knownGaps: string[];
  validationReport?: ValidationReport;
  auditEventIds: string[];
};

export type PosthogUsageSnapshot = {
  totalEvents: number;
  uniqueUsers?: number;
  lastEventAt?: string;
  events: {
    eventName: string;
    count: number;
    uniqueUsers?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    syntheticCount?: number;
  }[];
  dashboardActivity?: {
    dashboardId: string;
    lastViewedAt?: string;
    widgetsRunning: boolean;
  }[];
  surveyResponses?: {
    surveyId: string;
    responseCount: number;
  }[];
  sessionRecordings?: {
    count: number;
    latestRecordingAt?: string;
  };
  featureFlags?: {
    key: string;
    evaluations: number;
    lastEvaluatedAt?: string;
  }[];
};

export type PocMonitoringReport = {
  pocId: string;
  planVersion: number;
  runId: string;
  checkedAt: string;
  window: {
    from: string;
    to: string;
  };
  status: "on_track" | "at_risk" | "blocked" | "criteria_met" | "inactive" | "unknown";
  riskLevel: "none" | "low" | "medium" | "high";
  usageSummary: {
    hasRealCustomerActivity: boolean;
    lastEventAt?: string;
    uniqueUsers?: number;
    totalEvents?: number;
    syntheticOnly: boolean;
    credentialLinkConsumed?: boolean;
    dashboardActivity?: {
      dashboardId: string;
      lastViewedAt?: string;
      widgetsRunning: boolean;
    }[];
    surveyResponses?: {
      surveyId: string;
      responseCount: number;
    }[];
    sessionRecordings?: {
      count: number;
      latestRecordingAt?: string;
    };
    featureFlags?: {
      key: string;
      evaluations: number;
      lastEvaluatedAt?: string;
    }[];
  };
  eventProgress: {
    eventName: string;
    expected: boolean;
    firstSeenAt?: string;
    lastSeenAt?: string;
    count: number;
    uniqueUsers?: number;
    source: "real_customer" | "synthetic" | "unknown";
  }[];
  successCriteriaProgress: {
    criterion: string;
    status: "met" | "partially_met" | "not_met" | "blocked" | "unknown";
    evidence: string[];
    recommendedAction?: string;
  }[];
  planDrift: {
    missingExpectedEvents: string[];
    unexpectedObservedEvents: string[];
    environmentMismatch?: string;
    identityIssues?: string[];
    notes: string[];
  };
  recommendedActions: {
    owner: "customer" | "operator" | "system";
    action:
      | "send_reminder"
      | "offer_support"
      | "revise_plan"
      | "schedule_review"
      | "mark_success"
      | "extend_poc"
      | "prepare_teardown"
      | "keep_monitoring";
    reason: string;
    urgency: "low" | "medium" | "high";
  }[];
  followUpDraft?: {
    audience: "customer" | "operator";
    subject: string;
    markdownBody: string;
  };
};

/**
 * A durable record of one thing the orchestrator did or proposed for a PoC. Powers the
 * Agent Activity Feed and the nudge-dedup logic in the always-on loop. Kept product-agnostic
 * (no PostHog-specific fields) so it survives the move to a horizontal TelemetryAdapter.
 */
export type ActivityEvent = {
  id: string;
  pocId: string;
  ts: string;
  kind:
    | "monitor_tick"
    | "classification"
    | "action_proposed"
    | "action_gated"
    | "action_sent"
    | "escalation"
    | "llm_activated"
    | "skipped"
    | "email_sent"
    | "email_received"
    | "nudge_decision"
    | "audit";
  actor:
    | "pov_loop"
    | "monitoring_agent"
    | "orchestrator"
    | "setup_agent"
    | "validation_runner"
    | "human"
    | "system";
  summary: string;
  status: "proposed" | "gated" | "sent" | "succeeded" | "failed" | "skipped";
  /** Stable key used to rate-limit/dedup repeated actions (e.g. "nudge:inactive"). */
  cadenceKey?: string;
  refs?: {
    approvalTokenId?: string;
    monitoringRunId?: string;
    emailId?: string;
  };
  payload?: Record<string, unknown>;
};

export type HandoffPackage = {
  pocId: string;
  recipients: string[];
  subject: string;
  markdownBody: string;
  links: {
    label: string;
    url: string;
    kind: "posthog_project" | "dashboard" | "insight" | "secret" | "docs" | "approval" | "other";
  }[];
  attachments?: {
    filename: string;
    storageRef: string;
    contentType: string;
  }[];
  securityReview: {
    containsRawSecrets: boolean;
    credentialLinksExpireAt?: string;
    piiNotes: string[];
  };
};

export type PocRecord = {
  pocId: string;
  status: PocLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  activePlanVersion?: number;
  approvalTokenId?: string;
  approvalUrl?: string;
  confirmationEmailId?: string;
  confirmationThreadId?: string;
  sourceText: string;
};

export type InboundEmailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  textBody: string;
  receivedAt: string;
};

export type CustomerReplyClassification = {
  intent: "approved" | "needs_changes" | "question" | "rejected" | "unclear";
  confidence: number;
  extractedChanges: string[];
  requiresHumanReview: boolean;
  suggestedResponse?: string;
};
