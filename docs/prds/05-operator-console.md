# PRD 05: Operator Console

Status: Hackathon baseline  
Owner: frontend / product design  
Primary audience: designers and frontend engineers

## Summary

The operator console gives the sales engineer visibility and control over agentic PoC setup. It should not be a marketing landing page. It should be a compact operational dashboard for scanning lifecycle state, reviewing plans, seeing created resources, and retrying failed stages.

## Primary User

Sales engineer or founder running multiple PoCs.

## Jobs To Be Done

- See which PoCs need attention.
- Review extracted requirements.
- Confirm what the agent sent to the buyer.
- See whether setup succeeded.
- Open created dashboards.
- Understand validation warnings.
- Retry setup or handoff.
- Monitor active pilots.

## Information Architecture

### Board View

Shows all PoCs grouped by lifecycle state:

- Intake.
- Awaiting confirmation.
- Approved.
- Setup running.
- Needs clarification.
- Handoff sent.
- Active.
- At risk.
- Completed.

Each row/card should show:

- Customer.
- Product.
- Current state.
- Last updated.
- Owner.
- Main blocker or warning.

### PoC Detail View

Sections:

- Header summary.
- Timeline/audit trail.
- Requirements.
- Active plan.
- Confirmation email.
- Latest customer reply.
- Setup result.
- Created resources.
- Validation report.
- Handoff email.
- Monitoring reports.

### New PoC View

Inputs:

- Transcript text.
- Participants.
- Optional PostHog project ID.
- Optional structured hints.

Actions:

- Submit.
- Save draft.
- Load sample transcript.

### Settings View

Sections:

- LLM key status.
- PostHog MCP/API status.
- Gmail connection.
- SQLite/store path.
- Workflow mode.

## Key Components

### Status Badge

Color-coded lifecycle state.

### Validation Summary

Compact pass/warn/fail display with expandable checks.

### Resource List

Shows created dashboards, insights, actions, and links.

### Customer Thread Preview

Shows latest outbound and inbound email.

### Retry Controls

Buttons:

- Retry setup.
- Resend confirmation.
- Send handoff.
- Run monitoring.

Controls should be disabled if prerequisites are missing.

## UX Principles

- Dense, operational layout.
- No oversized hero section.
- No decorative dashboard cards.
- Fast scanning over visual flair.
- Use clear empty states.
- Warnings should be visible, not hidden in logs.

## Visual Tone

Should feel:

- Trustworthy.
- Technical but not cluttered.
- Calm.
- Workflow-oriented.

Avoid:

- Consumer-style landing page.
- Decorative gradients.
- Fake metrics.
- Text overlapping on small screens.

## MVP Screens

### Screen 1: Pipeline

Shows seeded or live PoCs.

### Screen 2: PoC Detail

Shows one complete PoC lifecycle.

### Screen 3: Intake

Allows transcript submission.

### Screen 4: Settings

Allows checking environment and Gmail connection.

## Acceptance Criteria

- Operator can submit a transcript.
- Operator can see status after submission.
- Operator can inspect generated plan.
- Operator can see whether buyer approval happened.
- Operator can see dashboard/resource links after setup.
- Operator can see warnings and known gaps.
- Operator can trigger a monitoring run.

## Demo Data

Seed at least one sample PoC:

- Customer: Convinced / VGS.
- Scenario: widget adoption for Enmovil and Bizom.
- Status: handoff sent or active.
- Created dashboard links can be fake in local mode or real in live mode.

## Future Enhancements

- Real-time workflow updates.
- Multi-user assignment.
- Slack notifications.
- Customer-facing handoff page.
- Inline email compose/review.
- Dashboard screenshot previews.

