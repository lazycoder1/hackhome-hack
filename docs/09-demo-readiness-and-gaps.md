# Demo readiness and gaps

_Snapshot: 2026-06-05. This is a proof-of-concept — production concerns (auth, exhaustive tests,
rate limiting, audit durability, deployment hardening) are intentionally out of scope and not listed
here. This tracks only whether the **core workflow features** are actually wired end-to-end._

## Current answer

The remaining work is not just e2e testing, but it is mostly **live validation and demo hardening** rather than major architecture build-out.

The offline happy path runs with `npm run demo`, and `WORKFLOW_MODE=local` can run the same flow over HTTP without a Trigger.dev deploy. The remaining demo blockers require live external systems: a disposable PostHog project and Gmail OAuth. (Trigger.dev Cloud execution was validated end-to-end on 2026-06-05.)

## What works vs. what's stubbed

| Feature | Status | Notes |
|---|---|---|
| Requirements intake (`POST /requirements`) | ✅ | + zod-validated input (added 2026-06-05) |
| Requirements extraction → `PocRequirements` (LLM) | ✅ | |
| Plan generation → `PocPlan` | 🟡 | deterministic mapper; now emits a `customerSummaryMarkdown` summary; blocking project-target clarification exists |
| Missing-detail detection (blocking/confirmable) | 🟡 | detects missing project ID (blocking) plus missing events / assumed platform (confirmable, surfaced as open questions); deeper field-level detection still possible |
| Confirmation email | ✅ | |
| Inbox reply classifier (DeepSeek Flash) | ✅ | |
| Waitpoint token approval | ✅ | |
| **Email approval → setup** | ✅ | Approved inbound email now routes through workflow setup/handoff locally and in the Trigger email task |
| **Plan revision loop** (`needs_changes` → v2 + resend) | ✅ | Inbound email and Trigger waitpoint change requests now supersede the prior plan, create v2+, and resend confirmation |
| PostHog MCP connection + tool filtering | ✅ | setup tool failures are captured as failed setup reports for human review; a read-only MCP smoke-check command exists |
| Project resolution (existing/create) | 🟡 | missing project ID now blocks for clarification; setup still requires an existing/pre-created project because project creation is not wired |
| Dashboard / action / insight creation | ✅ | |
| Optional assets (flags, surveys, cohorts, experiments, alerts, replay) | 🟡 | setup now creates cohorts, feature flags, experiments, surveys, and alerts when requested; session replay remains project-setting only and live MCP argument shapes are unverified |
| Secret refs + one-time links | ✅ | pre-send secret scan is a stub (matches an empty list) — fine for POC |
| Synthetic event send + visibility retry | ✅ | |
| Validation checks (schema/widgets/SQL smoke/trends/funnel) | ✅ | trends + funnel query-wrapper checks run when expected events exist (live arg shapes unverified) |
| Handoff generation | ✅ | |
| Operator status APIs (`GET /pocs`, `/pocs/:id`) | ✅ | JSON only; no UI/CLI |
| **PoC success monitoring** | 🟡 | Monitoring agent, usage snapshot (events, dashboards, survey responses, session recordings, feature-flag evaluations), durable reports, status + on-demand APIs, Trigger task, follow-up drafts. Funnel-specific scoring, review-date routing, and live PostHog validation still pending |
| Gmail email out + inbound message normalization | 🟡 | Official remote MCP bridge creates Gmail drafts, polls threads, normalizes replies, and exposes a `monitor-gmail-inbox` Trigger task. Raw Gmail API direct-send mode is wired through `users.messages.send`. Needs real OAuth token + test inbox/send run |
| File + SQLite stores | ✅ | JSON file store by default; SQLite uses Node's built-in `node:sqlite`; PGSQL intentionally removed for this PoC |
| Local in-process HTTP mode (`WORKFLOW_MODE=local`) | ✅ | `/email/inbound` + `/pocs/:pocId/monitoring/run` return real results without a Trigger.dev deploy |
| Offline demo runner (`npm run demo`) | ✅ | full happy path with in-memory tools + deterministic LLM; no credentials |
| Requirements file importer (`.md`/`.txt`/`.json`) | ✅ | `loadRequirementsBlobFromFile` |
| HTTP request validation (zod) | ✅ | `400` on malformed bodies on all POST endpoints |

## P0 before a real demo

These are the practical blockers before showing the full agent system against real services.

1. **Real PostHog MCP argument shapes** — `npm run posthog:mcp:smoke` can validate
   read-only `project-get`, `read-data-schema`, and `execute-sql` calls once
   `POSTHOG_MCP_API_KEY` and `POSTHOG_PROJECT_ID` are configured. Mutating gateway
   arg names can be validated against a disposable live project with
   `POSTHOG_MCP_MUTATION_SMOKE=1 npm run posthog:mcp:mutation-smoke`. The mutating check
   creates temporary `poc-smoke-*` actions, dashboards, insights, cohorts, feature flags,
   experiments, surveys, and alerts. Failures now produce a stored failed setup report
   instead of crashing before state is saved.
2. **Gmail live validation** — configure Gmail OAuth, provide a test access token, run
   `monitor-gmail-inbox` against a test label/query, and send one test email with
   `EMAIL_MODE=gmail_api`.
3. **Monitoring MCP query validation** — event/dashboard monitoring is wired, but the SQL and
   dashboard run arguments still need a live PostHog project check.
4. **Trigger.dev Cloud execution** — ✅ validated 2026-06-05: backend `task.trigger()` (via `TRIGGER_SECRET_KEY`), waitpoint approval resume, and inline setup → validation → handoff with file-store persistence, confirmed against Trigger.dev Cloud. Not yet exercised: the `monitor-active-posthog-poc` / `process-posthog-poc-email-reply` tasks and the full `api:start` → `/approval/complete` path.

## P1 feature depth still pending

These are useful if the demo needs more product depth, but they are not blockers for the first working PoC path.

- **PoC monitoring depth**: funnel-specific scoring, review-date routing, live PostHog monitoring query validation, and deeper session replay handling if replay is central to the demo.
- **Operator experience**: status APIs exist, but there is no UI or CLI dashboard yet.
- **PostHog project provisioning**: setup currently assumes an existing/pre-created project. Project creation is not wired.
- **Missing-detail depth**: current detection catches the biggest blockers and confirmable assumptions; deeper field-level requirement checks can be added.

## P2 later work

- Multipart attachment support for Gmail API sender.
- Teardown automation.
- Customer repo / SDK install automation.
- Production hardening only if this stops being a quick PoC.

Everything else is implemented or intentionally out of POC scope.
