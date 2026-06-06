# Always-On Orchestrator — Adherence Plan

The build is "done" only when **every box below is checked** and the evidence column is real
(a passing test, a file, or a verified run). Decisions are in
[orchestrator-decisions.md](./orchestrator-decisions.md). Update the checkboxes as each item
lands; do not mark a box without evidence.

Legend: ☐ not started · ◐ in progress · ☑ done.

## A. Durable activity feed (load-bearing — do first)

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `ActivityEvent` type added to `src/contracts.ts`, free of PostHog-specific fields | `contracts.ts` |
| ☑ | `PocStore` gains `saveActivityEvent` + `listActivityEvents(pocId,{limit})` (newest-first) | `state/types.ts` |
| ☑ | Implemented in in-memory, file, and sqlite stores | 3 store files |
| ☑ | Round-trip + ordering + limit test passes | `tests/activity-event-store.test.ts` |

## B. DECIDE (deterministic)

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `decide(report) → ProposedAction[]` pure module implementing the playbook table | `monitoring/decide.ts` |
| ☑ | Each action has `type`, `customerFacing`, `cadenceKey`, `reason`, `urgency` | type def |
| ☑ | Table-driven test covers all 6 statuses | `tests/pov-decide.test.ts` |
| ☑ | No PostHog-specific fields leak into `ProposedAction` | code review |

## C. LLM-activated drafting

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `NudgeDrafter` uses the injected `LlmJsonClient` to draft customer nudge `{subject, markdownBody}` | `monitoring/nudge-drafter.ts` |
| ☑ | Prompt includes criteria progress, missing events, prior-touch count | test asserts prompt |
| ☑ | Falls back to the deterministic `report.followUpDraft` if the LLM errors or returns a bad shape | test with throwing stub |
| ☑ | SE escalation summary drafting available | `nudge-drafter.ts` |

## D. The always-on loop

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `PovLoopRunner.runTick(pocId)` runs SENSE/CLASSIFY → DECIDE → dedup → GATE → ACT → RECORD | `monitoring/pov-loop-runner.ts` |
| ☑ | Customer-facing actions are drafted by the LLM then queued via `ApprovalTool` (SE gate) | loop test |
| ☑ | Internal actions (escalate/capture) bypass the gate | loop test |
| ☑ | Dedup: a second tick within the cooldown does **not** re-nudge | loop test |
| ☑ | Every step writes an `ActivityEvent` (tick, classification, llm_activated, action_gated, escalation, skipped) | loop test |
| ☑ | `runTick` imports **no** `@trigger.dev/sdk` (cloud/local agnostic) | grep |
| ☑ | Idempotency key `poc:{id}:{cadenceKey}:{date}` on waitpoints | code |

## E. Schedulers (event/recurring triggers)

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | Trigger `schedules.task` fans out one `runTick` per active POV | `trigger/pov-monitoring-schedule.ts` |
| ☑ | In-process `IntervalTicker` calls `runTick` for active POVs in local mode | `workflow/interval-ticker.ts` |
| ☑ | Ticker started in `startHttpServer` when `WORKFLOW_MODE=local`, gated by `POV_TICK_INTERVAL_MS` | `server/index.ts` |
| ☑ | Ticker test: invokes runner per active POV, clean shutdown | `tests/interval-ticker.test.ts` |

## F. Surface the feed

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `PocStatusReader.activity(pocId)` returns events | `status/poc-status-reader.ts` |
| ☑ | `GET /pocs/:id/activity` route returns the feed | `server/http-server.ts` |
| ☑ | Route test passes | `tests/http-server.test.ts` (activity case) |

## G. Wiring & quality gates

| ☑/☐ | Requirement | Evidence |
|---|---|---|
| ☑ | `createAgentSystem` exposes `llm` and a `povLoopRunner` factory | `app/create-agent-system.ts` |
| ☑ | `npm run build` (tsc) passes | build log |
| ☑ | `npm test` — full suite green, no regressions | test log |
| ☑ | New code has no `eslint` errors | lint log |

## Definition of done

All of A–G checked, `npm run build` + `npm test` green, and a local run shows the ticker
producing activity events (a nudge proposed + gated for an inactive POV, no duplicate on the
next tick).

### Verified — live run (local mode, real backend)

- `npm run build` ✅ · `npm test` ✅ **146/146** · `npm run lint` ✅ (web bundle excluded;
  see `eslint.config.js`).
- Backend booted with `POV_TICK_INTERVAL_MS=10000` → log: `[pov-loop] POV loop ticker started`.
- For the monitorable POV `poc_acme`, the activity feed (`GET /pocs/poc_acme/activity`) showed
  the full loop against the **real** PostHog + DeepSeek:
  `monitor_tick (inactive)` → `classification` → `llm_activated` (DeepSeek drafted a real
  customer nudge) → `action_gated` (queued for SE approval).
- Over **7 ticks**: `action_gated` for `nudge:inactive` = **1**, `skipped` = **6** — the agent
  is always-on but never re-nudges within the cooldown.
- Activity events remained readable after a server restart → durable store confirmed.
