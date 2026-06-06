# Implementation Roadmap

## Phase 0: Repo Setup

Deliverables:

- Basic service skeleton.
- State store schema.
- Environment configuration.
- Tool gateway interfaces.
- Local mock tools for email, inbox, secrets, and PostHog MCP.

Acceptance criteria:

- A local script can create a fake PoC record from a sample call summary.
- Audit events are written for each step.

## Phase 1: Orchestrator MVP

Deliverables:

- `submit_requirements_blob` endpoint.
- File importer for `.md`, `.txt`, or `.json` requirements blobs.
- Requirements extraction into `PocRequirements`.
- Plan generation into `PocPlan`.
- Confirmation email generation.
- Inbox reply classifier.
- Approval state machine.

Acceptance criteria:

- Given a sample requirements text blob, the orchestrator creates a confirmation email.
- A simulated approval moves the PoC to `approved`.
- A simulated correction updates the plan and resends confirmation.

Status: implemented, including the `.md`/`.txt`/`.json` file importer. Plan generation emits a `customerSummaryMarkdown` summary and surfaces confirmable missing details (missing events, assumed platform) as open questions.

## Phase 2: Trigger.dev Workflow MVP

Deliverables:

- Trigger.dev tasks for intake, confirmation, approval wait, setup, validation, and handoff.
- Waitpoint token approval flow.
- Run tags and metadata.
- Retry policy.

Acceptance criteria:

- A workflow pauses for approval and resumes after token completion.
- Failed email sends retry.
- Setup task is idempotent by `pocId` and plan version.

## Phase 3: PostHog Setup MVP

Deliverables:

- PostHog MCP connection with tool filtering.
- Project resolution using existing or pre-created project.
- Dashboard creation.
- Action creation.
- Insight creation.
- Event taxonomy output.
- Secure secret references.

Acceptance criteria:

- The setup agent configures a PostHog project from a small approved plan.
- The result includes project URL, dashboard URL, resource IDs, and known gaps.
- Destructive tools are not available to autonomous setup.

## Phase 4: Validation MVP

Deliverables:

- Synthetic event sender.
- Synthetic event visibility retry check via PostHog MCP SQL.
- Schema reader.
- Dashboard/insight runner.
- Query wrapper checks for trends and funnels.
- Validation report.

Acceptance criteria:

- Validation returns `pass`, `warn`, or `fail`.
- Handoff is blocked on `fail` unless a human override is recorded.
- Warnings are included in the handoff.

Status: implemented; trends and funnel query-wrapper checks run when expected events exist (live MCP argument shapes still need a disposable PostHog project). Human override on `fail` is not implemented (out of POC scope).

## Phase 5: Customer Handoff MVP

Deliverables:

- Handoff generator.
- One-time secret link integration.
- Final email sender.
- Security scan for raw secrets in email body.

Acceptance criteria:

- Customer handoff includes testing plan, links, validation status, known gaps, and support owner.
- Email body contains no raw credentials.
- Secret links expire.

## Phase 6: Demo Polish

Deliverables:

- Seed sample customer requirement.
- End-to-end demo script.
- Internal operator dashboard or CLI status view.
- Failure demo for customer change request.

Acceptance criteria:

- Demo can show the happy path in under 5 minutes.
- Demo can show approval wait and resume.
- Demo can show a created PostHog dashboard or mocked equivalent.

Status: `npm run demo` runs the seeded happy path end-to-end offline (under 5 minutes), and `WORKFLOW_MODE=local` runs the same flow over the HTTP API. Operator UI / CLI status view is still pending.

## Phase 7: PoC Success Monitoring

Status: first runtime slice implemented. Deeper live PostHog validation and broader product-signal coverage remain.

Deliverables:

- Scheduled/on-demand `monitor-active-posthog-poc` Trigger.dev task.
- PostHog usage snapshot tool for event volume, unique users, recency, and dashboard activity.
- Success criteria evaluator that compares observed usage to the approved `PocPlan`.
- `PocMonitoringReport` persistence and status API exposure.
- Operator/customer follow-up draft generation.
- Risk routing for inactive, at-risk, blocked, criteria-met, and unknown PoCs.
- Remaining: funnel-specific scoring, review-date routing, and live MCP validation (survey responses, feature-flag evaluations, and session recordings are now collected).

Acceptance criteria:

- An active PoC produces a monitoring report for a defined time window.
- The report distinguishes synthetic-only traffic from real customer activity.
- Each success criterion receives a status and evidence.
- The system recommends a next action when usage stalls or the review date is approaching.
- The monitor is read-only unless a separate human-approved remediation workflow is added.

## MVP Technical Stack

Recommended:

- TypeScript service for orchestrator and tools.
- Trigger.dev for workflows.
- PostHog MCP for PostHog configuration.
- JSON file storage by default, with local SQLite when a small database file helps.
- Gmail MCP for outbound draft creation and inbox ingestion.
- Gmail REST API for optional direct-send fallback.
- 1Password/Infisical/Doppler/Vault or a small encrypted secret store for secret links.
- Zod for runtime schema validation.

## Open Implementation Questions

- Should the MVP use a real PostHog project or mocked PostHog tools for the first demo?
- Do we need an internal approval UI, or is email reply enough?
- Who owns customer PostHog account creation and invites?
- Will customers install SDK code themselves, or will we connect to their repo later?
- What is the target app stack for the first demo customer?

## Later-Phase Email Backlog

- Add multipart MIME attachment support to the Gmail API sender if handoff packages need real file attachments. The current direct-send path is text-only and uses one-time links for credentials.

## Major Risks

### Risk: PostHog project creation is not available through MCP

Mitigation:

- Start with existing/pre-created projects.
- Add an internal admin API or Terraform-backed tool later.

### Risk: LLM executes unsafe PostHog writes

Mitigation:

- Pin organization/project.
- Use tool allowlists.
- Require approval before destructive actions.
- Run plan validation before setup.

### Risk: Event ingestion is eventually consistent

Mitigation:

- Validation retries with backoff.
- Handoff includes expected delay if relevant.

### Risk: Raw secrets leak in email

Mitigation:

- Use one-time links.
- Add a pre-send secret scanner.
- Keep secret values out of LLM-visible context when possible.

### Risk: Customer requirements are ambiguous

Mitigation:

- Classify missing details.
- Send assumptions for approval.
- Preserve open questions in plan and handoff.

## Backlog

- Internal operator dashboard.
- Customer approval portal.
- PoC success monitoring UI.
- Teardown automation.
- PostHog resource tagging conventions.
- Terraform provider exploration for project provisioning.
- Customer repository integration for SDK installation.
- Multi-product support after PostHog MVP.
- Slack/CRM notifications for sales and solutions engineering.
- Analytics on PoC completion and conversion.
