# Demo readiness and gaps

_Snapshot: 2026-06-06. This is a proof-of-concept — production concerns (auth, exhaustive tests,
rate limiting, audit durability, deployment hardening) are intentionally out of scope and not listed
here. This tracks only whether the **core workflow features** are actually wired end-to-end._

## Current answer

The remaining work is not just e2e testing, but it is mostly **live validation and demo hardening** rather than major architecture build-out.

The offline happy path runs with `npm run demo`, and `WORKFLOW_MODE=local` can run the same flow over HTTP without a Trigger.dev deploy. Trigger.dev Cloud execution was validated end-to-end on 2026-06-05. Gmail OAuth, Gmail API direct-send, Gmail API draft fallback, and Gmail API inbox dry-run monitoring were validated on 2026-06-06. Live PostHog dashboard creation was also validated against project `212567`.

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
| Dashboard / action / insight creation | ✅ | Layer-4 dry-run produced a valid agentic dashboard spec, then live `--create` created dashboard `1675295` in project `212567` with real dashboard/insight URLs |
| Optional assets (flags, surveys, cohorts, experiments, alerts, replay) | 🟡 | setup now creates cohorts, feature flags, experiments, surveys, and alerts when requested; session replay remains project-setting only and live MCP argument shapes are unverified |
| Secret refs + one-time links | ✅ | pre-send secret scan is a stub (matches an empty list) — fine for POC |
| Synthetic event send + visibility retry | ✅ | |
| Validation checks (schema/widgets/SQL smoke/trends/funnel) | 🟡 | trends + funnel query-wrapper checks run when expected events exist; live read-back validation arg shapes remain under task #18 |
| Handoff generation | ✅ | |
| Operator status APIs (`GET /pocs`, `/pocs/:id`) | ✅ | JSON only; no UI/CLI |
| **PoC success monitoring** | 🟡 | Monitoring agent, usage snapshot (events, dashboards, survey responses, session recordings, feature-flag evaluations), durable reports, status + on-demand APIs, Trigger task, follow-up drafts. Funnel-specific scoring, review-date routing, and live PostHog validation still pending |
| Gmail email out + inbound message normalization | 🟡 | OAuth token storage, Gmail API draft fallback, guarded Gmail API direct-send, and Gmail API inbox dry-run monitoring were validated on 2026-06-06. Official remote MCP bridge still returns a Google Cloud `serviceusage.services.use` permission error for the configured project |
| File + SQLite stores | ✅ | JSON file store by default; SQLite uses Node's built-in `node:sqlite`; PGSQL intentionally removed for this PoC |
| Local in-process HTTP mode (`WORKFLOW_MODE=local`) | ✅ | `/email/inbound` + `/pocs/:pocId/monitoring/run` return real results without a Trigger.dev deploy |
| Offline demo runner (`npm run demo`) | ✅ | full happy path with in-memory tools + deterministic LLM; no credentials |
| Requirements file importer (`.md`/`.txt`/`.json`) | ✅ | `loadRequirementsBlobFromFile` |
| HTTP request validation (zod) | ✅ | `400` on malformed bodies on all POST endpoints |

## P0 before a real demo

These are the practical blockers before showing the full agent system against real services.

1. **PostHog read-back validation arg shapes (task #18)** — agentic dashboard creation is now
   live-validated: dry-run succeeded without clarification, and live `--create` produced dashboard
   `1675295` in project `212567`. The remaining warning is read-back validation for
   `dashboard-widgets-run` plus trends/funnel query wrappers. Claude Code is working this item.
2. **Gmail MCP project permission** — 2026-06-06 live checks confirmed the local Google OAuth token
   store, Gmail API draft fallback, guarded Gmail API direct-send, and Gmail API inbox dry-run
   monitoring. The official Gmail MCP call is still blocked by Google Cloud permission
   `serviceusage.services.use` on project `999302008289`.
3. **Monitoring MCP query validation** — event/dashboard monitoring is wired, but live PostHog
   monitoring query validation should wait until task #18 settles so we do not tune two
   overlapping PostHog read-back paths at once.
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
