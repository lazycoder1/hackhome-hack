# PRD 06: Demo, Validation, and Judging Plan

Status: Hackathon baseline  
Owner: demo lead  
Primary audience: entire hackathon team

## Summary

This PRD defines what must be true for the hackathon demo to be credible. The demo should prove one end-to-end vertical rather than showing many partial features.

## Demo Narrative

"A buyer explains what they need in a transcript. HackHome acts like a sales engineer: it extracts the plan, confirms it over email, inspects live product analytics, builds the dashboard, validates it, and sends a handoff."

## Demo Setup

Required:

- Sample transcript.
- LLM API key.
- Local SQLite store.
- Email mode: local or Gmail API.
- PostHog test project.
- PostHog API/MCP key.
- One known dashboard creation target.

Optional:

- Operator UI.
- Trigger.dev workflow.
- Real Gmail inbox polling.

## Golden Path

1. Open the operator console or run CLI.
2. Submit sample transcript.
3. Show extracted plan.
4. Show confirmation email.
5. Simulate or send buyer approval.
6. Show live PostHog evidence collection.
7. Show dashboard spec generation.
8. Show SQL validation.
9. Show created dashboard.
10. Show handoff email.
11. Show monitoring report or planned monitoring.

## Required Proof Points

### Proof 1: Transcript Understanding

The plan should mention:

- Widget adoption.
- Enmovil and Bizom.
- Email capture.
- Demo requests.
- PM/growth audience.

### Proof 2: Natural Email Approval

The buyer reply should be ordinary language:

- "Confirmed, please proceed."

The system should not rely on a link click.

### Proof 3: Live Evidence

The system should show it inspected live data:

- Top events.
- Candidate conversion signals.
- URLs/landing pages.
- Event schema.

### Proof 4: Validated Dashboard

The created dashboard should contain:

- At least three tiles.
- At least two charts.
- Axis-aware titles.
- SQL-validated queries.

### Proof 5: Safe Agent Boundary

Explain:

- The LLM drafts specs.
- The app validates SQL.
- The app writes resources only after validation.
- Failed charts are not created.

## Judging Positioning

What to emphasize:

- This is not just a chatbot.
- It mutates a real SaaS tool safely.
- It turns messy buyer language into an implementation artifact.
- It has a human-friendly email loop.
- It uses validation gates before external writes.

## Demo Script

### Opening

"Technical pilots die in the gap between a good discovery call and a working proof of concept. HackHome closes that gap."

### Step 1: Transcript

Show the sample buyer conversation.

### Step 2: Plan

Show generated business plan and assumptions.

### Step 3: Email Reply

Show approval reply:

> Confirmed. This is the dashboard we need for the pilot. Please proceed.

### Step 4: Agentic Setup

Show logs or UI states:

- Data reconnaissance completed.
- Dashboard harness completed.
- SQL validation passed.
- Dashboard created.

### Step 5: PostHog Dashboard

Open real dashboard.

Point out:

- Chart titles explain axes.
- Events came from live evidence.
- Caveats are preserved.

### Step 6: Handoff

Show handoff email.

### Closing

"This starts with PostHog, but the pattern is reusable: transcript, confirmation, evidence, validated setup, handoff, monitoring."

## Validation Checklist

Before demo:

- Build passes.
- Tests pass.
- Sample transcript exists.
- PostHog credentials work.
- Dashboard create smoke works.
- Email mode works.
- No raw secrets in repo.
- README has run instructions.

## Fallback Plan

If PostHog live creation fails:

- Use dry-run mode with live SQL validation.
- Show previously created dashboard.
- Explain write step is gated but disabled for judging environment.

If Gmail fails:

- Use local email mode.
- Show generated email payloads.

If LLM latency is high:

- Use cached fixture response for the demo.
- Explain live path is available.

## Hackathon Finish Criteria

Must have:

- PRD and README.
- Working transcript intake.
- Working plan generation.
- Working approval simulation.
- Working PostHog dashboard creation or validated dry-run.

Should have:

- Operator UI.
- Gmail API send/read.
- Monitoring report.

Could have:

- Trigger.dev workflow.
- Real-time UI updates.
- Multi-product skill abstraction.

