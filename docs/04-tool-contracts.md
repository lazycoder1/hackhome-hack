# Tool Contracts

This file defines the tool surface the orchestrator and PoC setup system need. Tools may be implemented as MCP tools, internal API calls, or typed service wrappers.

## Tool Design Rules

- Tools should have typed inputs and outputs.
- Tools should be idempotent where possible.
- Tools should return structured errors.
- Tools that mutate external state must write audit events.
- Tools that touch secrets must never return raw secret values unless explicitly required by a trusted backend component.
- LLM agents should receive constrained tool lists based on the active step.

## Intake Boundary

The call assistant is not specified by this system. It is an upstream black box. The orchestrator accepts a requirements text blob through either:

- API call.
- File drop/import.

Any transcript, notes, or structured summary must be represented as input text plus optional hints. The orchestrator validates and canonicalizes that input before any setup workflow can start.

## Orchestrator Tools

### `submit_requirements_blob`

Receives the canonical orchestrator input. This may come from a call assistant, a manually written note, a file import, or another upstream system.

```ts
type SubmitRequirementsBlobInput = {
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

type SubmitRequirementsBlobOutput = {
  pocId: string;
  status: "intake_received";
};
```

### `extract_poc_requirements`

Converts the requirements text blob into canonical requirements.

```ts
type ExtractPocRequirementsInput = {
  pocId: string;
  text: string;
  structuredHints?: Record<string, unknown>;
};

type ExtractPocRequirementsOutput = {
  requirements: PocRequirements;
  missingDetails: MissingDetail[];
  confidence: number;
};
```

### `generate_poc_plan`

Creates a customer-readable plan and a machine-readable setup plan.

```ts
type GeneratePocPlanInput = {
  pocId: string;
  requirements: PocRequirements;
  missingDetails: MissingDetail[];
};

type GeneratePocPlanOutput = {
  customerSummaryMarkdown: string;
  setupPlan: PocPlan;
  requiresClarification: boolean;
};
```

### `classify_customer_reply`

Classifies inbound email replies.

```ts
type ClassifyCustomerReplyInput = {
  pocId: string;
  emailThreadId: string;
  latestMessageText: string;
};

type ClassifyCustomerReplyOutput = {
  intent: "approved" | "needs_changes" | "question" | "rejected" | "unclear";
  confidence: number;
  extractedChanges: string[];
  requiresHumanReview: boolean;
  suggestedResponse?: string;
};
```

## Email and Inbox Tools

For this PostHog PoC, the `EmailTool` abstraction can be backed by either the official Gmail MCP server or raw Gmail REST API. Google Gmail MCP currently exposes `create_draft` for outbound messages, so that adapter creates reviewable Gmail drafts. `EMAIL_MODE=gmail_api` uses Gmail REST `users.messages.send` for direct send.

### `send_email`

```ts
type SendEmailInput = {
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

type SendEmailOutput = {
  emailId: string;
  threadId: string;
  sentAt: string;
};
```

Gmail API direct-send constraints in this PoC:

- Builds text-only RFC 2822 MIME messages.
- Base64url-encodes MIME content into the Gmail `raw` message field.
- Rejects attachments until multipart MIME support is added.
- Requires `EMAIL_FROM` and `GMAIL_API_ACCESS_TOKEN`.

### `check_inbox`

For Gmail MCP, inbox checks are implemented by `monitor-gmail-inbox`: call `search_threads`, fetch full bodies with `get_thread`, normalize messages, and dispatch canonical replies to the orchestrator.

```ts
type CheckInboxInput = {
  customerEmail?: string;
  threadId?: string;
  since?: string;
  tags?: string[];
};

type CheckInboxOutput = {
  messages: {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    textBody: string;
    receivedAt: string;
  }[];
};
```

### `monitor_gmail_inbox`

```ts
type MonitorGmailInboxInput = {
  query?: string;
  maxThreads?: number;
  pocId?: string;
  processedLabelIds?: string[];
};

type MonitorGmailInboxOutput = {
  searchedThreads: number;
  processedMessages: number;
  skippedMessages: number;
  labeledThreads: number;
};
```

## Approval Tools

These can be backed by Trigger.dev waitpoint tokens.

### `create_approval_waitpoint`

```ts
type CreateApprovalWaitpointInput = {
  pocId: string;
  timeout: string;
  approverEmails: string[];
  idempotencyKey: string;
};

type CreateApprovalWaitpointOutput = {
  tokenId: string;
  publicApprovalUrl: string;
  expiresAt: string;
};
```

### `complete_approval_waitpoint`

```ts
type CompleteApprovalWaitpointInput = {
  tokenId: string;
  decision: "approved" | "rejected" | "needs_changes";
  decidedBy: string;
  notes?: string;
  changes?: string[];
};

type CompleteApprovalWaitpointOutput = {
  success: boolean;
};
```

## Secrets Tools

### `create_secret`

```ts
type CreateSecretInput = {
  pocId: string;
  name: string;
  value: string;
  ttl?: string;
  tags?: string[];
};

type CreateSecretOutput = {
  secretRef: string;
  expiresAt?: string;
};
```

### `create_one_time_secret_link`

```ts
type CreateOneTimeSecretLinkInput = {
  secretRef: string;
  recipientEmail: string;
  expiresIn: string;
};

type CreateOneTimeSecretLinkOutput = {
  url: string;
  expiresAt: string;
};
```

### `consume_one_time_secret_link`

```ts
type ConsumeOneTimeSecretLinkInput = {
  token: string;
};

type ConsumeOneTimeSecretLinkOutput =
  | {
      status: "consumed";
      name: string;
      value: string;
      expiresAt?: string;
    }
  | {
      status: "not_found" | "expired" | "used" | "revoked";
    };
```

### `rotate_or_revoke_secret`

```ts
type RotateOrRevokeSecretInput = {
  secretRef: string;
  action: "rotate" | "revoke";
  reason: string;
};

type RotateOrRevokeSecretOutput = {
  success: boolean;
  newSecretRef?: string;
};
```

## Validation Tools

### `capture_synthetic_posthog_events`

Sends synthetic events into PostHog using the project API key and host URL.

```ts
type CaptureSyntheticPosthogEventsInput = {
  pocId: string;
  posthogProjectId: string;
  hostUrl: string;
  events: EventRequirement[];
};

type CaptureSyntheticPosthogEventsOutput = {
  status: "sent" | "skipped" | "failed";
  requestedEventCount: number;
  eventsSent: number;
  eventNames: string[];
  capturedAt: string;
  reason?: string;
  error?: string;
};
```

### `verify_synthetic_posthog_events`

Retries a PostHog MCP `execute-sql` query until captured synthetic events are visible in the `events` table.

```ts
type VerifySyntheticPosthogEventsInput = {
  pocId: string;
  posthogProjectId: string;
  eventNames: string[];
};

type VerifySyntheticPosthogEventsOutput = {
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
```

### `validate_posthog_setup`

Runs all approved validation checks.

```ts
type ValidatePosthogSetupInput = {
  pocId: string;
  posthogProjectId: string;
  expectedResources: ExpectedPosthogResources;
  syntheticEventCapture?: CaptureSyntheticPosthogEventsOutput;
  syntheticEventVisibility?: VerifySyntheticPosthogEventsOutput;
};

type ValidatePosthogSetupOutput = {
  status: "pass" | "warn" | "fail";
  checks: ValidationCheck[];
  knownGaps: string[];
};
```

## Monitoring Tools

### `collect_posthog_usage_snapshot`

Reads PostHog usage data for an active PoC window. This is read-only and should run under a monitoring-scoped MCP allowlist.

```ts
type CollectPosthogUsageSnapshotInput = {
  pocId: string;
  posthogProjectId: string;
  window: {
    from: string;
    to: string;
  };
  expectedEvents: string[];
  resourceRefs: PosthogResourceRef[];
};

type CollectPosthogUsageSnapshotOutput = {
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
};
```

### `evaluate_poc_success_criteria`

Compares the approved plan and latest usage snapshot against the original success criteria.

```ts
type EvaluatePocSuccessCriteriaInput = {
  plan: PocPlan;
  setupResult: SetupResult;
  usageSnapshot: CollectPosthogUsageSnapshotOutput;
  previousReports?: PocMonitoringReport[];
};

type EvaluatePocSuccessCriteriaOutput = {
  status: PocMonitoringReport["status"];
  riskLevel: PocMonitoringReport["riskLevel"];
  successCriteriaProgress: PocMonitoringReport["successCriteriaProgress"];
  planDrift: PocMonitoringReport["planDrift"];
  recommendedActions: PocMonitoringReport["recommendedActions"];
};
```

### `store_poc_monitoring_report`

```ts
type StorePocMonitoringReportInput = {
  report: PocMonitoringReport;
};

type StorePocMonitoringReportOutput = {
  reportId: string;
};
```

### `generate_monitoring_followup_draft`

Creates an operator or customer follow-up draft. It should not send email by itself.

```ts
type GenerateMonitoringFollowupDraftInput = {
  report: PocMonitoringReport;
  audience: "customer" | "operator";
};

type GenerateMonitoringFollowupDraftOutput = {
  subject: string;
  markdownBody: string;
};
```

## Audit Tool

### `write_audit_log`

```ts
type WriteAuditLogInput = {
  pocId: string;
  actor: "orchestrator" | "posthog_setup_agent" | "validation_runner" | "human" | "system";
  action: string;
  target?: string;
  inputHash?: string;
  outputSummary?: string;
  status: "started" | "succeeded" | "failed" | "skipped";
  error?: string;
  createdAt?: string;
};

type WriteAuditLogOutput = {
  auditEventId: string;
};
```

## PostHog MCP Connection

PostHog MCP endpoint:

```text
https://mcp.posthog.com/mcp
```

For production, pin the connection to the target organization and project using headers or query parameters, and constrain the exposed tools.

Example feature filter:

```text
https://mcp.posthog.com/mcp?features=workspace,docs,actions,dashboards,insights,data_schema,sql,flags,surveys,cohorts,sdk_doctor
```

Example exact tool filter:

```text
https://mcp.posthog.com/mcp?tools=projects-get,project-get,project-settings-update,action-create,dashboard-create,insight-create,read-data-schema,execute-sql
```

## PostHog MCP Tool Allowlist

### Core project

- `projects-get`
- `project-get`
- `project-settings-update`
- `organization-get`
- `organizations-list`

### Documentation and schema

- `docs-search`
- `read-data-schema`
- `read-data-warehouse-schema`
- `execute-sql`
- `sdk-doctor-get`

### Actions and event metadata

- `action-create`
- `action-update`
- `action-get`
- `actions-get-all`
- `event-definition-update`

### Dashboards and insights

- `dashboard-create`
- `dashboard-create-text-tile`
- `dashboard-get`
- `dashboard-update`
- `dashboard-widgets-batch-add`
- `dashboard-widgets-run`
- `dashboard-reorder-tiles`
- `insight-create`
- `insight-get`
- `insight-update`
- `insights-list`
- `insight-query`
- `query-trends`
- `query-funnel`
- `query-retention`
- `query-paths`
- `query-stickiness`

### Cohorts and persons

- `cohorts-create`
- `cohorts-list`
- `cohorts-retrieve`
- `cohorts-partial-update`
- `persons-list`
- `persons-retrieve`

### Feature flags

- `create-feature-flag`
- `update-feature-flag`
- `feature-flag-get-all`
- `feature-flag-get-definition`
- `feature-flags-test-evaluation-create`
- `feature-flags-user-blast-radius-create`

### Experiments

- `experiment-create`
- `experiment-get`
- `experiment-list`
- `experiment-update`
- `experiment-results-get`

Do not allow `experiment-launch` by default. Add a human approval gate if launch is required.

### Surveys

- `survey-create`
- `survey-get`
- `survey-update`
- `survey-launch`
- `survey-stats`
- `surveys-get-all`
- `surveys-responses-list`

### Alerts and subscriptions

- `alert-create`
- `alert-get`
- `alert-simulate`
- `alerts-list`
- `subscriptions-create`
- `subscriptions-test-delivery-create`
- `subscriptions-list`

### Session replay

- `query-session-recordings-list`
- `session-recording-get`
- `session-recording-playlist-create`
- `session-recording-playlist-get`
- `session-recording-summarize`

### CDP functions

- `cdp-function-templates-list`
- `cdp-function-templates-retrieve`
- `cdp-functions-create`
- `cdp-functions-invocations-create`
- `cdp-functions-list`
- `cdp-functions-logs-retrieve`
- `cdp-functions-retrieve`

## Tools Requiring Human Approval

These tools should not be available to autonomous setup by default:

- `delete-feature-flag`
- `feature-flags-bulk-delete-create`
- `persons-bulk-delete`
- `dashboard-delete`
- `dashboard-delete-tile`
- `insight-delete`
- `experiment-delete`
- `experiment-launch`
- `experiment-end`
- `experiment-reset`
- `experiment-ship-variant`
- `survey-delete`
- `survey-stop`
- `cdp-functions-delete`
- `external-data-sources-destroy`
- `external-data-schemas-delete-data`
