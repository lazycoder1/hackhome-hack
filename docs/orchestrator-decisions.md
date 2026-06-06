# Always-On Orchestrator — Gap Decisions

Source-of-truth record of the gaps a fresh review found in the current codebase and the
goal-based decision taken for each. Companion to [pov-orchestrator-plan.md](./pov-orchestrator-plan.md)
and [orchestrator-adherence.md](./orchestrator-adherence.md).

**Goal being served:** an always-on / monitoring orchestrator with **event-based triggers**
(Trigger.dev) where, for some paths, **an LLM is activated to take over a task** — giving the
impression of a 24/7 agent. It must work in **local mode** (in-process, for testing) and
**trigger mode** (cloud) from one code path.

## Current state (verified)

- **No recurring tick.** `trigger.config.ts` registers tasks but no `schedules.task`; every
  task in `trigger/posthog-poc-workflow.ts` is on-demand. The inbox monitor and
  `monitor-active-posthog-poc` tasks exist but nothing schedules them.
- **Monitoring is SENSE→CLASSIFY only.** `PocMonitoringAgent.monitor()` pulls a real PostHog
  usage snapshot and classifies (`on_track|at_risk|blocked|criteria_met|inactive|unknown`),
  but DECIDE→ACT is missing: `followUpDraft` is generated deterministically and dropped.
- **LLM is only in intake.** DeepSeek is called in `Orchestrator.extractRequirements` and
  `classifyCustomerReply`. The monitoring loop never calls the LLM.
- **Telemetry is the strongest existing piece.** `PostHogMcpUsageSnapshotTool` runs real SQL
  via PostHog MCP `execute-sql` and separates synthetic vs real customer events. This is the
  moat, half-built.
- **The SE-approval gate exists for plan confirmation only**, not for monitoring-driven
  customer actions.
- **Audit/activity evaporates.** `AuditTool` is in-memory and rebuilt per `createAgentSystem`
  call (every Trigger run starts fresh) — no durable history, so nudge dedup is impossible.
  `PocStore` has no activity entity.

## Decisions

| # | Gap | Decision | Rationale |
|---|---|---|---|
| A | No recurring tick | **One global Trigger `schedules.task` (cron) that fans out one `runTick(pocId)` per active POV**, plus an in-process `IntervalTicker` for local mode. Both call the same `runTick`. | Single idempotent fan-out; one tick function = identical local & cloud behavior. |
| B | Events don't wake the agent | **Hybrid: poll-derived events** (the tick diffs the new report against the last to detect "threshold crossed" / "milestone due"); keep the existing inbox poll for email and waitpoint for approval. Thin `events[]` seam so true push can replace polling later. | Ships now with no Gmail-push infra; the tick already has prior state to diff. |
| C | DECIDE + ACT missing | **New `PovLoopRunner.runTick()`** orchestrates the existing agent: SENSE/CLASSIFY (agent) → DECIDE (pure) → GATE → ACT → RECORD. | Keeps the deterministic classifier pure and testable; isolates side effects. |
| D | LLM vs deterministic | **Deterministic:** sense, classify, decide (state→action map), gate routing, dedup, record. **LLM-activated:** only drafting the customer-facing nudge/check-in body and the SE escalation summary on the act branch. | Money/automation logic must be reproducible & auditable; natural-language drafting is where the LLM earns its keep — the "activation" moment. |
| E | Where the gate sits | **Gate every customer-facing action** via the existing `ApprovalTool.createApprovalWaitpoint`; internal actions (escalate-to-SE, capture-success, keep-monitoring) bypass it. Per-account `autoSendRoutineNudges` flag stubbed for later. | The gate is "the whole point" (plan §5); reuse the proven approve/edit/reject primitive. |
| F | No durable activity feed | **Add a first-class `ActivityEvent` entity to `PocStore`** (in-memory + file + sqlite). The loop runner writes events directly to the store (not via the evaporating audit tool), and dedup reads them back. | Activity Feed is a Phase-1 deliverable; durable events are required for nudge dedup. Writing from the loop avoids touching audit wiring / existing tests. |
| G | Local vs cloud parity | **`PovLoopRunner.runTick(pocId)` is the single seam.** Trigger: `schedules.task` → list active POVs → fan-out. Local: `IntervalTicker` (`setInterval`) calls the same function. `runTick` imports no `@trigger.dev/sdk`. | One code path, two schedulers — exactly the plan's "works local, maps to Trigger." |

## DECIDE playbook (deterministic state → action)

| Report status | Proposed action | Customer-facing? | Gated? | LLM? |
|---|---|---|---|---|
| `criteria_met` | capture success + notify SE | no | no | no |
| `inactive` | nudge customer (testing reminder) | **yes** | **yes** | **yes** (draft) |
| `at_risk` | nudge customer (missing events) | **yes** | **yes** | **yes** (draft) |
| `blocked` | escalate to SE (real traffic blocked) | no | no | yes (summary) |
| `unknown` | escalate to SE (monitoring failed) | no | no | no |
| `on_track` | keep monitoring (no-op) | no | no | no |

## Dedup / cadence

Each action carries a `cadenceKey` (e.g. `nudge:inactive`). Before acting, `runTick` calls
`store.listActivityEvents(pocId)` and skips if a `gated`/`sent` event with the same
`cadenceKey` occurred within `POV_NUDGE_COOLDOWN_HOURS` (default 48h). The approval waitpoint
`idempotencyKey` is `poc:{pocId}:{cadenceKey}:{YYYY-MM-DD}` so same-day retries don't
double-create. **Most ticks classify `on_track`/`criteria_met` and never touch the LLM** —
the deterministic path is the hot path, controlling cost.

## Round 2 — gap closure + Agent Activity UI (A-tier)

Gaps found after round 1 and how they were closed:

| Gap | Fix | Evidence |
|---|---|---|
| Audit (incl. all emails) was in-memory and discarded — not in the feed | `StoreBackedAuditTool` decorator persists every audit entry as a durable `ActivityEvent` with semantic kinds (`email_sent`/`email_received`/`audit`); wired as the default audit. Skips `monitor_poc_success` to avoid duping the loop's `monitor_tick`. | `tests/store-backed-audit.test.ts` |
| Approving a gated nudge didn't actually send it (half a loop) | `NudgeApprovalService.complete()` — on approve, sends the (optionally edited) draft to the customer and records `email_sent`; on reject records `nudge_decision`; idempotent. HTTP `POST /pocs/:id/nudges/:tokenId`. | `tests/nudge-approval-service.test.ts` |
| No UI for the activity feed / intervention console | **Agent Activity tab** on the PoC detail page: POV-progress header, **"Needs your approval"** intervention console (approve / edit / reject), "where things stand" counts, and the full activity timeline (emails sent/received, ticks, drafts, escalations). | `web/src/components/ActivityView.tsx` |
| Web mirror missing `monitoring_*` lifecycle statuses (crashed `StatusPill`) | Added to web `PocLifecycleStatus`, `STATUS_META`, and the Live & Done phase. | `web/src/lifecycle.ts` |

**End-to-end smoke test (local mode, real DeepSeek + PostHog), all observed:**
1. Always-on ticker monitored `poc_acme` → classified `inactive` → DeepSeek drafted a real nudge ("Let's get those activation events flowing!") → queued for SE approval (1 pending).
2. The Activity tab rendered the pending nudge in the intervention console with an editable body.
3. Clicking **Approve & send** in the UI → backend returned `{status:"sent", emailId:"email-1"}` → an `email_sent` event ("sent to riley@acme.test") topped the timeline, the pending section cleared, and "Emails sent" ticked to 1.
4. Re-approving the same token → `already_decided` (idempotent).
5. Activity persisted across a backend restart (durable store).

Quality gates: backend build ✅ · **153 tests** ✅ · lint ✅ · web typecheck ✅.

### Still not built (later phases, by design)
POV Plan Builder, Customer Collaboration Space, Stakeholder/Champion Map, Go/No-Go Decision
Room, Portfolio Analytics; true email *push* (we poll); the horizontal `TelemetryAdapter`
extraction (PostHog is hard-wired for now).

## Risks carried forward

- File store is JSON and not safe for concurrent cloud ticks — use `POC_STORE_MODE=sqlite`
  for any multi-POV always-on run; file store stays a local-demo convenience.
- No `TelemetryAdapter` seam yet — the loop depends on the PostHog snapshot tool. Fine for
  PostHog-first; extract the interface before product #2. Keep `ActivityEvent`/`ProposedAction`
  free of PostHog-specific fields (done).
- LLM latency/cost on a loop — mitigated by D + dedup (LLM only after dedup passes, only on
  customer-facing actions).
- Trigger retries (`maxAttempts: 3`) mean tick bodies must be idempotent — guaranteed by the
  deterministic idempotency keys above.
