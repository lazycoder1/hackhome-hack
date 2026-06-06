# PRD 02: Agentic Workflow and Lifecycle

Status: Hackathon baseline  
Owner: Backend / agent engineering  
Primary audience: engineers implementing the workflow backbone

## Summary

This PRD defines the lifecycle from transcript intake to setup, handoff, and monitoring. The key requirement is that customer text and LLM output cannot directly mutate external tools. All mutations must pass through structured plans, approval gates, deterministic validation, and audit logging.

## Workflow Stages

1. Intake received.
2. Requirements extracted.
3. Confirmation sent.
4. Buyer reply classified.
5. Plan approved or revised.
6. Setup queued.
7. Setup running.
8. Evidence collected.
9. Dashboard spec generated.
10. Queries validated.
11. Resources created.
12. Setup validated.
13. Handoff sent.
14. Pilot monitored.

## State Machine

Minimum states:

- `intake_received`
- `requirements_extracted`
- `needs_clarification`
- `confirmation_sent`
- `approved`
- `rejected`
- `setup_queued`
- `setup_running`
- `validation_running`
- `handoff_ready`
- `handoff_sent`
- `handoff_sent_with_gaps`
- `active_poc`
- `monitoring_running`
- `monitoring_at_risk`
- `monitoring_criteria_met`
- `needs_human_review`
- `failed`
- `completed`

## Inputs

### Requirements Blob

Required:

- `text`
- `source`
- `participants`

Optional:

- `structuredHints`
- `sourceMetadata`
- `filename`
- `emailThreadId`

### Inbound Email Reply

Required:

- `id`
- `threadId`
- `from`
- `to`
- `subject`
- `textBody`
- `receivedAt`

## Outputs

### PocRequirements

The canonical extracted requirements object.

Must include:

- Customer.
- Contact emails.
- Product target.
- Business goal.
- Success criteria.
- PostHog project context.
- Analytics scope.
- Assumptions.
- Open questions.

### PocPlan

The customer-confirmable implementation plan.

Must include:

- Objective.
- Setup scope.
- Dashboards requested.
- Validation plan.
- Handoff plan.
- Approval state.

### SetupResult

The created-resource and validation result.

Must include:

- Created resources.
- Skipped resources.
- Known gaps.
- Validation report.
- Handoff links or references.

## LLM Responsibilities

The LLM may:

- Extract requirements.
- Classify replies.
- Draft business-language responses.
- Produce a dashboard spec inside a constrained harness.

The LLM may not:

- Directly call mutation tools.
- Edit code.
- Invent unsupported live event names.
- Ask buyers for SQL, schema, or MCP choices.

## Approval Behavior

Buyers approve by replying naturally.

Examples that should approve:

- "Confirmed, please proceed."
- "Looks good."
- "Yes, this covers it."

Examples that should revise:

- "Looks good, but include Bizom separately."
- "Can we make the review window 90 days?"

Examples that should ask a question:

- "Can this run for a month?"
- "Will this include demo requests?"

## Retry Behavior

Retries should exist at three levels:

1. LLM output repair retry.
2. Tool call retry for transient failures.
3. Workflow stage retry from operator action.

Retries should not duplicate resources without idempotency checks or naming strategy.

## Audit Requirements

Every meaningful state transition or tool mutation must write an audit event:

- `submit_requirements_blob`
- `extract_poc_requirements`
- `send_confirmation_email`
- `classify_customer_reply`
- `revise_poc_plan`
- `approve_poc_plan`
- `setup_started`
- `data_reconnaissance_completed`
- `dashboard_harness_completed`
- `setup_completed`
- `send_poc_handoff`
- `monitor_poc`

## Storage

Use SQLite for the hackathon baseline.

Tables or logical collections:

- PoCs.
- Requirements.
- Plans.
- Setup results.
- Monitoring reports.
- Audit events.

## Acceptance Criteria

- A transcript creates a PoC record.
- A plan is generated and stored.
- A natural-language reply can approve or revise.
- Approved plans run setup.
- Failed setup stores a failed setup result.
- Known gaps are visible to the operator and handoff.
- Workflow can be rerun locally without losing state.

## Implementation Notes

- Build local in-process mode first.
- Add Trigger.dev or background workers only after local workflow works.
- Keep state transitions explicit.
- Make setup idempotency a first-class concern.

