# PoC Success Monitoring

## Product Definition

PoC Success Monitoring is the post-handoff loop that determines whether a configured PostHog PoC is actually being used and whether the original success criteria are being met.

Setup answers: "Is the PoC ready?"

Monitoring answers: "Is the PoC working for the customer, and what should we do next?"

## Core Jobs

- Track whether real customer activity appears after handoff.
- Compare observed usage to the approved `PocPlan`.
- Re-evaluate success criteria with evidence.
- Detect plan drift and implementation issues.
- Alert operators before the review date if the PoC is stalled.
- Draft targeted customer follow-ups.
- Recommend closeout when criteria are met.

## Monitoring Cadence

Recommended schedule:

- Daily for 7 days after handoff.
- 24 hours before `handoffPlan.reviewDate`.
- Weekly until `handoffPlan.teardownDate` or completion.
- On demand from an operator action.

Use Trigger.dev for the schedule and attach tags:

- `poc:{pocId}`
- `product:posthog`
- `stage:monitoring`
- `customer:{companySlug}`

## Inputs

- Approved `PocPlan`.
- `SetupResult` and created resource refs.
- Latest `ValidationReport`.
- Previous `PocMonitoringReport` snapshots.
- PostHog read/query access scoped to the target project.
- Handoff dates and review/teardown dates.

## PostHog Signals

Baseline signals:

- Planned event counts, first seen, last seen, and unique users.
- Synthetic vs real customer traffic, based on `properties.synthetic`, `properties.poc_id`, environment, and known test distinct IDs.
- Identity health: anonymous-only traffic, missing user IDs, missing group IDs when groups are expected.
- Funnel progress for approved funnel requirements.
- Dashboard and insight query health.
- Feature flag evaluation for test users when configured.
- Survey response count when configured.
- Session replay count and recency when configured.
- Unexpected observed events that may indicate the customer implemented a different tracking plan.

## Success Criteria Evaluation

Each criterion should be mapped to one of:

- `met`: evidence directly supports the criterion.
- `partially_met`: some evidence exists, but not enough for a confident pass.
- `not_met`: expected activity is missing or below threshold.
- `blocked`: customer action, setup issue, or missing access prevents evaluation.
- `unknown`: PostHog reads failed or the criterion was too vague to evaluate.

Every status must include evidence or a reason. Avoid a generic "looks good" report.

## Risk Levels

- `none`: all active criteria are met or on track.
- `low`: activity exists, but some optional evidence is missing.
- `medium`: core activity exists, but success criteria are not progressing.
- `high`: no real activity, credential link unused, broken ingestion, or review date is approaching with no evidence.

## Recommended Actions

Actions should be explicit:

- `send_reminder`: customer has not used the PoC.
- `offer_support`: data is present but implementation looks wrong.
- `revise_plan`: observed usage differs from the approved plan.
- `schedule_review`: enough evidence exists for a decision meeting.
- `mark_success`: success criteria are met.
- `extend_poc`: usage started late but shows progress.
- `prepare_teardown`: review/teardown date is reached.
- `keep_monitoring`: no action needed.

## Human Boundaries

The monitoring agent is read-only. It can draft follow-up messages and status updates, but it should not autonomously:

- Change PostHog configuration.
- Extend the PoC.
- Mark commercial success.
- Send customer escalation emails without an operator approval policy.
- Tear down resources.

## Report Shape

The canonical output is `PocMonitoringReport` in [data contracts](./05-data-contracts.md). Store every report so the operator can compare current usage against setup time and previous monitoring windows.

## First Implementation Slice

Implemented:

1. `PocMonitoringReport` is persisted by the in-memory, file, and SQLite stores.
2. `PostHogUsageSnapshotTool` has a local test fake and an MCP implementation using `execute-sql`, `dashboard-widgets-run`, `survey-stats`, and `query-session-recordings-list`, collecting events, dashboard activity, survey responses, session recordings, and feature-flag evaluations.
3. `PocMonitoringAgent` evaluates required event counts, inactivity, synthetic-only traffic, missing events, plan drift, and criteria-met status.
4. Trigger.dev exposes `monitor-active-posthog-poc`.
5. HTTP exposes `GET /pocs/:pocId/monitoring` and `POST /pocs/:pocId/monitoring/run`.
6. Each report includes an operator/customer follow-up draft.

Remaining:

- Validate the MCP SQL and dashboard argument shapes against a live PostHog project.
- Survey responses, session recordings, and feature-flag evaluations are now collected; extend snapshots to funnels and review-date routing.
