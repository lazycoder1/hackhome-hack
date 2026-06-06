# Product Requirements Document: HackHome Agentic PoC Builder

Date: 2026-06-06  
Status: Hackathon baseline  
Owner: HackHome team

## 1. Executive Summary

HackHome is an AI pre-sales implementation agent. It converts buyer conversations into configured, validated SaaS proof-of-concept workspaces.

The first implementation vertical is a PostHog dashboard setup agent. A buyer explains what they want to measure, confirms the plan over email, and the system creates a usable dashboard from live PostHog evidence. The agent does not guess event names, ask buyers technical questions, or write unvalidated dashboard charts. It inspects available data, drafts a dashboard plan, validates every generated query, repairs weak specs, writes PostHog resources only after validation, and sends a business-readable handoff.

The long-term product is a repeatable "pilot implementation engine" for technical sales teams. PostHog is the first proving ground because dashboard setup has clear value, visible output, and strong validation gates.

## 2. Problem

B2B technical pilots often fail because the work after a discovery call is manual and fragile:

- Requirements live in call transcripts, Slack messages, CRM notes, email replies, and engineer memory.
- Sales engineers manually translate business goals into tool-specific setup tasks.
- Dashboards are created from guessed event names or stale assumptions.
- Buyers reply in natural language, but systems often require forms, approval links, or technical tickets.
- POCs lose momentum because no one monitors whether the buyer actually used the setup.
- The final handoff is inconsistent and often misses caveats, validation status, or secure credential handling.

This creates slow pilots, poor buyer experience, and low confidence that the technical demo proves the right business outcome.

## 3. Product Thesis

The fastest path to a credible technical pilot is not a generic agent with unrestricted tool access. It is a constrained domain agent with:

- A structured lifecycle.
- Email-native customer control.
- Live evidence discovery.
- Tool-specific validation.
- A deterministic write boundary.
- Persistent state and audit logs.

HackHome should behave like a senior pre-sales engineer: it understands buyer language, asks only useful business clarifications, inspects actual data before building, and hands off a ready-to-review workspace.

## 4. Target Users

### 4.1 Sales Engineer / Solutions Engineer

Primary operator.

Goals:

- Turn discovery calls into demo-ready PoCs quickly.
- Avoid forgetting setup details.
- Avoid building dashboards from wrong event names.
- Keep buyers moving without manual follow-up overhead.
- See what the agent did and what still needs review.

Pain points:

- High context switching.
- Manual dashboard creation.
- Repetitive handoff emails.
- Unclear customer approval status.
- Hard to know whether a PoC is active or stale.

### 4.2 Product/Growth Buyer

Customer stakeholder.

Goals:

- Explain desired metrics in business language.
- Confirm the pilot scope without learning technical internals.
- Receive a working dashboard with clear caveats.
- Continue the pilot over email.

Pain points:

- Technical setup blocks business evaluation.
- Approval links and forms feel unnatural.
- Dashboards often lack axis labels, definitions, or context.
- Follow-up questions can be too technical.

### 4.3 Founder / GTM Lead

Internal business owner.

Goals:

- Scale pilot delivery without scaling engineering labor linearly.
- Understand which pilots are moving or stuck.
- Standardize quality across demos.
- Capture learnings from repeated PoC setups.

## 5. MVP Use Case

### 5.1 Scenario

A buyer says:

> We have a widget deployed on Enmovil and Bizom landing pages. As a PM, I want to understand adoption: which pages get widget usage, which pages create conversations, and which pages convert visitors into email captures or demo requests.

The system should:

1. Extract the desired PoC outcome.
2. Generate a customer-readable plan.
3. Email the plan to the buyer.
4. Accept a natural-language confirmation reply.
5. Inspect live PostHog data.
6. Identify available events and URL patterns.
7. Ask clarification only if a business definition is ambiguous.
8. Generate a PostHog dashboard spec.
9. Validate every query through PostHog SQL.
10. Create dashboard and insights.
11. Send a final handoff email.

### 5.2 Expected Dashboard

The created dashboard should include useful PM/growth charts such as:

- Widget page views by company.
- Email submissions by day.
- Demo requests by day.
- Conversion signals by event or step.
- Top landing pages by usage or conversion.

Every chart must be buyer-readable. Titles should explain axes, for example:

- `Email submissions by day (x = day, y = submissions)`
- `Widget page views by company (x = company, y = pageviews)`
- `Top landing pages by widget pageviews (rows = landing page, columns = pageviews)`

## 6. Goals

### 6.1 Product Goals

- Reduce time from discovery call to working PoC dashboard.
- Improve pilot setup quality by grounding dashboards in live evidence.
- Keep buyer interaction email-native and business-readable.
- Make setup steps auditable and repeatable.
- Produce a credible hackathon demo with a complete vertical.

### 6.2 Technical Goals

- Build a structured PoC lifecycle state machine.
- Use an LLM for extraction, reply classification, and dashboard planning.
- Constrain the LLM to produce specs, not mutate tools directly.
- Validate generated SQL before dashboard creation.
- Persist PoC state locally with SQLite.
- Integrate at least one live external tool, PostHog.
- Support email confirmation and handoff.

### 6.3 Demo Goals

By the end of the hackathon, the demo should show:

- A transcript being submitted.
- A plan email being generated.
- A natural-language approval reply being processed.
- The agent inspecting PostHog data.
- The agent creating a dashboard with usable charts.
- A handoff email that includes dashboard links and caveats.

## 7. Non-Goals

For the hackathon MVP:

- Do not build a generic multi-product marketplace.
- Do not support every PostHog feature.
- Do not perform destructive actions such as deleting dashboards without explicit operator approval.
- Do not send raw credentials in email.
- Do not require the buyer to answer SQL, event schema, MCP, or dashboard widget questions.
- Do not build full production auth, billing, or multi-tenant permissions.
- Do not depend on rewriting git history or prior project history.

## 8. Core Product Requirements

### 8.1 Requirements Intake

The system must accept a text blob representing:

- Transcript.
- Call summary.
- Email thread.
- Manually written requirements.

Input fields:

- `source`: file, API, email, manual.
- `text`: raw transcript/summary.
- `participants`: name, email, company, role.
- `structuredHints`: optional operator-provided business context.
- `sourceMetadata`: source ID, received timestamp, filename/thread ID.

Acceptance criteria:

- The system can ingest a sample transcript without manual restructuring.
- Missing primary buyer email blocks confirmation and asks for clarification.
- Missing PostHog project ID blocks live setup.
- Non-blocking ambiguity is preserved as assumptions/open questions.

### 8.2 Requirement Extraction

The LLM must extract canonical `PocRequirements`:

- Customer.
- Contacts.
- Business goal.
- Success criteria.
- Product target.
- App/platform context.
- PostHog project context.
- Analytics scope.
- Requested dashboards.
- Assumptions.
- Open questions.

Acceptance criteria:

- Output is JSON.
- Unsupported product defaults to "needs review" or is rejected for MVP.
- Structured hints can override or supplement LLM extraction.
- Open questions are not discarded.

### 8.3 Confirmation Email

The system must generate a buyer-readable confirmation email.

Email should include:

- Greeting.
- Captured goal.
- Success criteria.
- Scope.
- Assumptions.
- Open questions.
- Instruction to reply naturally if it looks right or needs changes.

Acceptance criteria:

- No raw secrets.
- No technical SQL or MCP details.
- Reply can be natural language, such as "confirmed", "looks good", or "change the date to next month".

### 8.4 Reply Classification

The system must classify inbound buyer replies into:

- `approved`
- `needs_changes`
- `question`
- `rejected`
- `unclear`

Acceptance criteria:

- Natural language approval triggers setup.
- Requested changes create a revised plan version and resend confirmation.
- Buyer questions receive a business-readable response.
- The classifier should not require magic words like "Approved".

### 8.5 Plan Revision Loop

The system must support plan versions.

Behavior:

- Version 1 is generated from initial requirements.
- If the buyer requests changes, version 1 becomes superseded.
- Version 2 incorporates requested changes.
- A new confirmation email is sent in the same thread when possible.

Acceptance criteria:

- Prior plan is preserved.
- Active plan points to latest version.
- Audit logs record the revision reason.

### 8.6 Agentic Dashboard Harness

The LLM must not directly call PostHog mutation tools. It operates inside a constrained planning harness.

Allowed LLM actions:

- Inspect transcript-derived plan.
- Inspect live evidence summary.
- Draft dashboard JSON.
- Draft validation SQL.
- Repair dashboard JSON from validation feedback.

Forbidden LLM actions:

- Edit repository files.
- Call PostHog mutation tools.
- Invent event names unsupported by evidence.
- Ask the buyer technical implementation questions.

Acceptance criteria:

- Harness prompt explicitly states allowed and forbidden actions.
- LLM receives live evidence before planning.
- LLM returns JSON only.
- Harness supports multiple repair attempts.
- Harness exposes a maximum internal planning budget, for example 50 steps.

### 8.7 Live Evidence Discovery

Before dashboard planning, the setup agent must inspect live PostHog evidence.

Evidence should include:

- Event schema.
- Top events by volume.
- Non-noise conversion candidates.
- URL/page activity.
- Candidate landing pages.
- Query errors.

Acceptance criteria:

- Evidence collection does not hardcode buyer-specific names.
- Evidence excludes local/test URLs when possible.
- Evidence errors are captured and surfaced.
- DeepSeek receives evidence and produces `dataAssessment` before tiles.

### 8.8 Dashboard Spec Generation

The LLM must return an `AgenticDashboardSpec`.

Fields:

- `dashboardName`
- `dashboardDescription`
- `clarificationRequired`
- `clarificationQuestions`
- `dataAssessment`
- `notes`
- `tiles`

Each tile:

- `title`
- `description`
- `validationSql`
- `insightQuery`

Acceptance criteria:

- Dashboard and tile names do not contain raw PoC UUIDs.
- At least one real graph tile is required when live data supports it.
- Chart titles must describe axes.
- Table titles must describe rows/columns.
- SQL-style tiles must use PostHog `DataVisualizationNode` with `HogQLQuery`.
- Display must be explicit, such as `ActionsLineGraph`, `ActionsBar`, `ActionsStackedBar`, `ActionsAreaGraph`, `ActionsTable`, or `BoldNumber`.

### 8.9 Validation Before Write

Every generated query must be validated before resource creation.

Validation:

- Run `validationSql` with PostHog `execute-sql`.
- Reject unsupported visualization shapes.
- Reject missing displays.
- Reject titles without axis/row meaning.
- Reject raw UUIDs in buyer-visible names.

Acceptance criteria:

- No dashboard is created from invalid tile specs.
- If a tile fails final SQL validation, the system does not create a partial dashboard.
- Query validation errors are fed back to the LLM for repair.
- Setup result records known gaps and skipped resources.

### 8.10 PostHog Resource Creation

After validation, the setup agent may create:

- Actions.
- Dashboard.
- Insights.
- Optional cohorts, flags, experiments, surveys, alerts.

Acceptance criteria:

- Dashboard resources are tagged with PoC/source tags when supported.
- Created resource IDs and URLs are stored.
- Existing resource conflicts are handled gracefully.
- Validation report confirms resources exist or warns with reason.

### 8.11 Handoff Email

After setup, the system sends a handoff.

Handoff should include:

- Dashboard link.
- Validation status.
- Created resources.
- Known gaps/caveats.
- Testing plan.
- Secure credential link if relevant.
- Next steps.

Acceptance criteria:

- Warnings are not hidden.
- Email is business-readable.
- No raw credentials are included.

### 8.12 PoC Monitoring

After handoff, the system should continue monitoring the pilot.

Monitoring signals:

- Event volume.
- Unique users.
- Dashboard activity.
- Recent usage.
- Missing expected events.
- Survey responses.
- Session recordings.
- Feature flag evaluations.

Acceptance criteria:

- Monitoring is read-only by default.
- Monitoring reports are stored.
- At-risk pilots are surfaced.
- Recommendations are generated for follow-up, extension, or closeout.

## 9. Functional Requirements by User Story

### Story 1: Submit Transcript

As a sales engineer, I can submit a transcript so the system can extract a PoC plan.

Acceptance:

- Given a transcript with customer goal and contact, when submitted, then a PoC record is created.
- The PoC moves to `confirmation_sent` if blocking details are present.
- The PoC moves to `needs_clarification` if blocking details are missing.

### Story 2: Confirm by Email

As a buyer, I can reply naturally to confirm the PoC plan.

Acceptance:

- "Looks good, go ahead" is classified as approval.
- "Can we include Bizom separately?" is classified as requested change or question depending on phrasing.
- Approval triggers setup.

### Story 3: Ask Business Clarification

As a buyer, I should only be asked questions I can answer in business language.

Acceptance:

- Good: "Should demo intent include opened demo forms, submitted demo forms, or both?"
- Bad: "Which SQL query should I use?"
- Bad: "Which event property contains company?"

### Story 4: Create Validated Dashboard

As a PM buyer, I receive a dashboard that answers the requested adoption questions.

Acceptance:

- Dashboard contains at least one graph.
- Charts have clear titles.
- Queries validate before write.
- Dashboard is created only after validation.

### Story 5: Repair Weak Dashboard Specs

As an operator, I want the system to repair bad LLM output before writing to PostHog.

Acceptance:

- Missing display triggers repair.
- Invalid SQL triggers repair.
- Table-only dashboard triggers repair if graphable data exists.
- Failed final validation blocks partial dashboard creation.

### Story 6: Handoff

As a buyer, I receive a summary of what was built and how to review it.

Acceptance:

- Email includes dashboard link.
- Email includes known caveats.
- Email includes next steps.
- Email is readable by a non-technical stakeholder.

## 10. State Machine

Required lifecycle states:

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
- `teardown_queued`
- `teardown_complete`

Minimum MVP path:

```text
intake_received
-> confirmation_sent
-> approved
-> setup_running
-> handoff_ready
-> handoff_sent
```

## 11. Data Model

### 11.1 PocRecord

- `pocId`
- `status`
- `createdAt`
- `updatedAt`
- `sourceText`
- `activePlanVersion`
- `confirmationEmailId`
- `confirmationThreadId`
- `approvalTokenId`
- `approvalUrl`

### 11.2 PocRequirements

- `pocId`
- `product`
- `customer`
- `businessGoal`
- `successCriteria`
- `appContext`
- `posthogContext`
- `analyticsScope`
- `securityConstraints`
- `timeline`
- `assumptions`
- `openQuestions`
- `source`

### 11.3 PocPlan

- `pocId`
- `version`
- `status`
- `customer`
- `objective`
- `customerSummaryMarkdown`
- `successCriteria`
- `assumptions`
- `openQuestions`
- `posthogTarget`
- `setup`
- `validationPlan`
- `handoffPlan`
- `approval`

### 11.4 SetupResult

- `pocId`
- `status`
- `posthog`
- `createdResources`
- `updatedResources`
- `skippedResources`
- `credentialRefs`
- `sdkInstructions`
- `knownGaps`
- `validationReport`
- `auditEventIds`

### 11.5 ValidationReport

- `pocId`
- `status`
- `checkedAt`
- `checks`
- `summary`
- `knownGaps`

## 12. Integrations

### 12.1 LLM

Uses:

- Requirement extraction.
- Reply classification.
- Dashboard planning.
- Clarification response drafting.

Requirements:

- JSON output support.
- Low-temperature deterministic mode.
- Strict output normalization.
- No direct mutation access.

### 12.2 PostHog

Uses:

- Project read.
- Schema read.
- SQL execution.
- Dashboard create.
- Insight create.
- Optional action/cohort/flag/survey/experiment creation.

Critical tools:

- `project-get`
- `read-data-schema`
- `execute-sql`
- `dashboard-create`
- `insight-create`
- `action-create`

Restricted/destructive tools:

- `dashboard-delete`
- `insight-delete`
- `persons-bulk-delete`
- Any launch/end/ship action for experiments.

### 12.3 Gmail

Uses:

- Send confirmation emails.
- Read replies.
- Send or draft handoffs.

Preferred MVP:

- Gmail API for reliable send/read in hackathon.
- Gmail MCP can be supported as optional bridge if permissions are configured.

### 12.4 Trigger / Worker

Uses:

- Long-running setup.
- Waitpoint approval.
- Retry.
- Inbox monitor.
- Monitoring schedules.

MVP alternative:

- In-process local workflow if Trigger setup costs too much hackathon time.

### 12.5 SQLite

Uses:

- Local durable PoC state.
- Plans.
- Setup results.
- Monitoring reports.

Requirements:

- Easy local reset.
- No production database dependency for hackathon.

## 13. Architecture

### 13.1 Component Diagram

```text
Transcript/API/File
  -> Orchestrator
  -> PoC Store
  -> Confirmation Email
  -> Email Reply Classifier
  -> Local/Trigger Workflow
  -> PostHog Setup Agent
  -> Agentic Dashboard Harness
  -> PostHog MCP/API
  -> Validation Runner
  -> Handoff Generator
  -> Monitoring Agent
```

### 13.2 Trust Boundary

Customer text is untrusted. It can influence requirements, but it cannot directly execute tools.

LLM output is semi-trusted. It must be normalized, validated, and repaired before use.

Tool mutations are trusted only after deterministic validation.

### 13.3 Dashboard Planning Boundary

The LLM returns a dashboard spec. The app decides whether to write it.

Flow:

1. Collect evidence.
2. Ask LLM for spec.
3. Normalize spec.
4. Run quality checks.
5. Run SQL checks.
6. Repair if needed.
7. Create dashboard.
8. Create insights.
9. Validate created resources.

## 14. API Requirements

### 14.1 Submit Requirements

`POST /requirements`

Input:

- `source`
- `text`
- `participants`
- `structuredHints`
- `sourceMetadata`

Output:

- `pocId`
- `status`
- `approvalUrl`
- `missingDetails`

### 14.2 Inbound Email

`POST /email/inbound`

Input:

- `pocId`
- `message`

Output:

- `intent`
- `completedApproval`
- `requiresSetup`
- `changes`

### 14.3 Get PoC

`GET /pocs/:pocId`

Output:

- PoC record.
- Active plan.
- Latest setup result.
- Latest monitoring report.

### 14.4 Run Monitoring

`POST /pocs/:pocId/monitoring/run`

Output:

- Monitoring report.
- Status update.

## 15. UX Requirements

### 15.1 Operator UI

Views:

- Pipeline board.
- PoC detail.
- Plan view.
- Setup result.
- Validation report.
- Handoff status.
- Monitoring report.
- Retry controls.

Must show:

- Current lifecycle state.
- Customer/company.
- Blocking gaps.
- Created resources.
- Known warnings.
- Latest customer reply.

### 15.2 Customer UI

MVP can be email-only.

Optional:

- Read-only approval page.
- Handoff page.
- Dashboard link landing page.

### 15.3 Copy Guidelines

Use business language:

- "Which pages are in scope?"
- "Should demo intent mean opened form, submitted form, or both?"
- "What audience is this dashboard for?"

Avoid technical language:

- "Which SQL should we run?"
- "Which PostHog property stores company?"
- "Should I use MCP tool X?"

## 16. Quality Gates

### 16.1 Requirement Quality

- Customer contact exists.
- Business goal exists.
- Target project exists.
- Success criteria exist or are explicitly assumed.

### 16.2 Dashboard Quality

- Uses live evidence.
- Contains at least one graph.
- Has axis-aware titles.
- Avoids raw UUIDs.
- Avoids synthetic-only signals unless clearly labeled.
- Shows caveats.

### 16.3 Validation Quality

- SQL smoke passes.
- Each tile SQL passes.
- Created resources are readable.
- Handoff includes warnings if validation is partial.

### 16.4 Email Quality

- No raw secrets.
- No markdown artifacts that Gmail will not render cleanly unless sending plain text intentionally.
- Includes concise next steps.

## 17. Security and Safety

Requirements:

- Store secrets outside git.
- Use one-time links for credentials.
- Redact tokens in logs.
- Scope MCP tools to required project and allowlist.
- Disable destructive tools by default.
- Persist audit events for mutations.
- Do not let LLM directly call mutation tools.
- Keep customer text out of shell commands.

## 18. Observability

Audit events:

- Intake submitted.
- Requirements extracted.
- Confirmation sent.
- Reply classified.
- Plan approved/revised.
- Setup started.
- Evidence collected.
- Dashboard harness completed.
- Resource created.
- Validation completed.
- Handoff sent.
- Monitoring run.

Each audit event should include:

- `pocId`
- `actor`
- `action`
- `target`
- `status`
- `summary`
- `error`
- `createdAt`

## 19. Success Metrics

### Hackathon Metrics

- One transcript creates one real dashboard.
- Dashboard has at least three useful tiles.
- All tile SQL validates before creation.
- Natural-language email approval works.
- Handoff email is produced.

### Product Metrics

- Time from transcript to dashboard.
- Percentage of setup runs requiring human intervention.
- Percentage of dashboards with validation warnings.
- Buyer reply-to-approval conversion.
- PoC activation rate after handoff.
- Number of stale pilots detected by monitoring.

## 20. MVP Milestones

### Milestone 1: Offline Happy Path

- In-memory tools.
- Deterministic LLM or fixture responses.
- Transcript to plan.
- Simulated approval.
- Fake dashboard resource.
- Handoff output.

### Milestone 2: Email Loop

- Gmail send/draft.
- Inbox polling.
- Reply classification.
- Plan revision.

### Milestone 3: PostHog Live Evidence

- Project read.
- Schema read.
- Top events SQL.
- Candidate conversion signals SQL.
- Candidate page URLs.

### Milestone 4: Agentic Dashboard Harness

- LLM dashboard spec.
- Data assessment.
- Repair loop.
- Quality gates.
- SQL validation.

### Milestone 5: Live Dashboard Creation

- Create dashboard.
- Create insights.
- Validate resources.
- Store URLs.

### Milestone 6: Handoff and Monitoring

- Send handoff.
- Run usage snapshot.
- Store monitoring report.
- Flag at-risk PoC.

## 21. Demo Script

1. Show the transcript.
2. Submit transcript into HackHome.
3. Show extracted plan.
4. Show generated confirmation email.
5. Send or simulate buyer reply: "Confirmed, please proceed."
6. Show agent collecting live PostHog evidence.
7. Show DeepSeek dashboard planning output.
8. Show SQL validation gate.
9. Show created PostHog dashboard.
10. Show handoff email.
11. Show monitoring/status view.

## 22. Risks

### Risk: LLM invents event names

Mitigation:

- Provide live evidence.
- Reject planned events not supported by evidence.
- Validate SQL before write.

### Risk: Buyer is asked technical questions

Mitigation:

- Prompt constraints.
- Clarification question quality gate.
- Operator review when classifier confidence is low.

### Risk: Broken charts are created

Mitigation:

- SQL validation before creation.
- Final validation immediately before write.
- All-or-nothing dashboard creation for agentic specs.

### Risk: PostHog MCP tool shape changes

Mitigation:

- Smoke tests.
- Gateway adapter.
- Tool-specific tests.
- Clear warnings in validation report.

### Risk: Gmail MCP permissions block demo

Mitigation:

- Gmail API fallback.
- Local email mode for offline demo.
- Narrow smoke scripts.

### Risk: Hackathon scope becomes too broad

Mitigation:

- Focus on one complete PostHog vertical.
- Treat other tools as future skills.
- Do not build generic plugin infrastructure until after demo.

## 23. Open Questions

- What final product name should be used in the demo: HackHome, PoC Pilot, or another brand?
- Should the hackathon demo use real Gmail sends or local simulated emails?
- Should the first UI be an operator dashboard, or should the first demo be CLI/API driven?
- Should the agent create dashboards in a shared test PostHog project or a disposable project per run?
- How much monitoring depth is needed for the hackathon judging criteria?

## 24. Definition of Done

The hackathon MVP is done when:

- A sample transcript can be submitted.
- The system generates a plan and confirmation email.
- A natural-language approval starts setup.
- The agent inspects live PostHog evidence.
- The agent creates a validated dashboard with useful graphs.
- The dashboard URL and insight URLs are stored.
- The handoff email is generated.
- Build and tests pass.
- README explains how to run the demo.

