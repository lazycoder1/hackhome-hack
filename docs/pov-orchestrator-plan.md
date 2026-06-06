# PoC Pilot → POV Orchestrator — Product & Build Plan

> **Thesis.** We are building a horizontal, always-on **agent that runs enterprise
> Proof-of-Value evaluations end to end** — from "customer is interested" to a recorded
> **go / no-go**. The agent does the work; the Solution Engineer is a firefighter who
> approves customer-facing moves and handles exceptions. Configuring the product (today:
> PostHog) is just the *execution surface*. **PostHog is our own first POV** — proof the
> orchestrator works on a real product before we go horizontal.

Positioning in one line: incumbents (Provarity, Success.app, Vivun) are **systems of
record** an SE updates by hand. We are a **system of action** that drives the evaluation
and produces the record as a byproduct.

> **Build status.** The always-on orchestrator (the §4 loop) is the active Phase-1 build.
> Gap analysis + decisions: [orchestrator-decisions.md](./orchestrator-decisions.md).
> The build is verified against [orchestrator-adherence.md](./orchestrator-adherence.md).

---

## 1. Operating model — agent-first (the RACI, corrected)

The agent is the operator. The SE is not a project manager doing busywork — they are
an escalation point with veto power on anything the customer sees.

| Job | Agent | SE (firefighter) | Customer champion |
|---|---|---|---|
| Draft the POV plan (pain → value → feature → criteria) | **R** | A (approve) | C (co-sign) |
| Schedule / sequence milestones | **R** | I | C |
| Configure the product (account, dashboards, events) | **R** | A on risky changes | I |
| Measure success criteria from real usage | **R** | I | I |
| Nudge the customer when they stall | **R** (proposes) | **A (approves send)** | — |
| Escalate when broken / results bad / champion silent | **R** (detects) | **R (fixes)** | I |
| Status updates to both sides | **R** | I | I |
| Go / no-go decision | facilitates | I | **R** |

**R** = Responsible (does it), **A** = Accountable (signs off), **C** = Consulted, **I** = Informed.

Design rule: **the agent proposes, the SE disposes — but only on customer-facing
actions.** Internal work (measuring, drafting, sequencing) is fully autonomous. This is
the trust boundary, and it is a *feature* (see §5).

---

## 2. What we own (the four moats)

1. **The POV plan** — the mutually-agreed value contract (not a feature checklist).
2. **The orchestration loop** — 24/7 sense → decide → act → record across many POVs.
3. **The signal (telemetry)** — real product-usage data proving value is/ isn't landing.
   The hardest integration and the deepest moat. **Build now.**
4. **The system of record** — every POV's signals, actions, and verdict, plus portfolio
   metrics leadership buys for.

Incumbents have 1 and 4 (manually). 2 and 3 are open, and 3 is where we're defensible.

---

## 3. The POV Plan (the core artifact)

A Mutual Action Plan fused with a value scorecard. Schema (drives the builder UI and the
agent):

```
PovPlan {
  pain: string                      // problem in the customer's words
  valueHypothesis: {                // the outcome that matters
    metric: string                  // e.g. "trial→paid conversion"
    baseline?: number
    target: number                  // QUANTIFIED — non-negotiable
    unit: string                    // %, $, hours, ...
  }[]
  featureValueMap: {                // which capability delivers which value
    feature: string
    deliversValue: string           // ref to valueHypothesis
  }[]
  successCriteria: {                // 3–4 numeric, co-signed thresholds
    id, statement, metric, threshold, comparator, measuredBy   // measuredBy = telemetry source
  }[]
  scope: { inScope[], outOfScope[], environment, dataSources[] }
  milestones: {                     // owners are mostly agent | customer
    title, owner: "agent"|"customer"|"se_exception", dueDate, dependsOn[]
  }[]
  stakeholders: {                   // the buying committee
    name, role, type: "champion"|"economic_buyer"|"influencer"|"blocker", engagement
  }[]
  goNoGoDate: date
  commercialNextStep: string        // what "yes" triggers — laddering to the deal
  risks: { risk, mitigation, owner }[]
}
```

Quantified criteria are mandatory — qualitative criteria cause post-evaluation disputes
that stall deals. The builder refuses to finalize a plan without a measurable threshold +
a `measuredBy` telemetry source per criterion.

---

## 4. The orchestration loop (the product)

Tri-directional: **customer ⇄ agent ⇄ SE.** Runs continuously per POV.

```
SENSE      pull telemetry (usage), criteria progress, email/Slack sentiment, milestone slippage
  ↓
CLASSIFY   on_track | getting_value | not_testing | stuck | broke | results_poor | champion_silent
  ↓
DECIDE     map state → proposed action
  ↓
GATE       customer-facing? → SE approves/overrides (§5).  internal-only? → auto-execute
  ↓
ACT        nudge customer | escalate to SE | advance milestone | capture proof | re-plan
  ↓
RECORD     append signal + action to the system of record
```

Per-state playbook:

| State | Proposed action |
|---|---|
| getting_value | capture proof, advance milestone, surface win to champion |
| not_testing / stuck | **nudge** customer (cadenced, SE-approved) |
| broke / results_poor | **escalate to SE** with full context — never rot silently |
| champion_silent | flag engagement gap to SE; suggest multi-thread |
| on_track | quiet status update both sides |

The agent's goal: **get every POV to an honest go/no-go.** A fast, well-reasoned *no*
is a win — it frees SE hours (this is the resource-efficiency ROI).

---

## 5. The SE-approval gate (the trust primitive)

**This is the whole point, not a limitation.** An autonomous agent emailing enterprise
buyers unsupervised loses deals. So:

- Every **customer-facing** action (email, nudge, plan change, status the customer sees)
  is generated by the agent and **queued for SE approval** with one-click approve / edit /
  reject. Generalize the approval gate already built today.
- Internal actions (measuring, sequencing, drafting, escalation *to the SE*) run fully
  autonomously.
- The gate is configurable per SE / per account: from "approve everything" → "auto-send
  routine nudges, gate anything novel." Trust earns autonomy over time.
- Everything gated and acted is logged → the **Agent Activity Feed** (auditable).

Sell it as: *"a tireless SE that never sends anything you didn't sign off on."*

---

## 6. Telemetry — own the signal (BUILD NOW)

"Is the customer getting value?" needs real product-usage data. We own this.

- **PostHog is the native case.** The product under evaluation *is* an analytics tool, and
  we already hold its project API key + MCP `execute-sql`. We can directly query whether
  the success-criteria events are flowing and compute criteria attainment from live data.
  → ship `Live POV Health` powered by real usage, this phase.
- **Horizontal abstraction:** a `TelemetryAdapter` interface —
  `getUsage(criteria) → signal[]`. PostHog adapter ships first; future adapters pull from
  the evaluated product's API / webhooks / the customer's own warehouse.
- This converts success criteria from "the SE eyeballs it" into a **measured number the
  agent reacts to** — the input to the whole orchestration loop.

---

## 7. Screens

| # | Screen | When | Notes |
|---|---|---|---|
| 1 | **POV Plan Builder** | Phase 1 | upgrade today's plan/approval into the §3 schema + co-sign |
| 2 | **Live POV Health** | **NOW** | criteria progress from real telemetry, usage, slippage |
| 3 | **Agent Activity Feed + Intervention Console** | Phase 1 | the SE-gate surface (§5) |
| 4 | **Customer Collaboration Space** | Phase 2 | the customer's POV home — the tri-directional surface |
| 5 | **Stakeholder / Champion Map** | Phase 2 | buying-committee + engagement |
| 6 | **Go/No-Go Decision Room** | Phase 3 | value report / business case the champion takes internally |
| 7 | **Portfolio Analytics** | Phase 3 | the leadership/buyer screen — win rate, health, hours saved, forecast |
| 8 | **Integrations / Settings** | Phase 3 | CRM (Salesforce), Slack/Teams, telemetry sources |

Today we have: pipeline board, POV detail, one-shot approval + handoff, intake, settings.
That's the **operator console** — keep it; it becomes the SE's firefighter cockpit.

---

## 8. System of record + metrics

**Per-POV (the customer record):** success-criteria attainment %, time-to-first-value,
time-to-technical-win, milestone velocity & slippage, stakeholder breadth + champion depth,
real usage/activation, issues open/closed, sentiment trend, **go/no-go outcome + reason.**

**Portfolio (what the CRO buys):** technical win rate (benchmark 25–35%, elite 40%+),
POV→closed-won conversion, POV cycle time (mid-market evals run 60–120 days — compression
is the story), % low-probability POVs cut early, **SE hours saved per POV**, forecast
accuracy / technical-health score, value realized ($).

Anchor the pitch on two numbers: **win-rate lift** (action-plan engagement → ~+26%) and
**SE hours reclaimed.**

---

## 9. Architecture for horizontal

```
                 ┌─────────────────────────────┐
                 │   POV Orchestration Core     │  product-agnostic
                 │  plan · loop · gate · record │
                 └───────────────┬─────────────┘
        ┌────────────────┬───────┴────────┬─────────────────┐
   TelemetryAdapter   SetupAdapter     CommsAdapter      CRMAdapter
   (read usage)      (configure)      (email/slack)     (sync record)
        │                │                │                 │
   PostHog #1        PostHog #1        Gmail (today)     Salesforce (later)
   (future: any)     (future: any)     Slack (later)
```

The core never imports a product SDK. PostHog is the first set of adapters and proves the
seams. Adding product #2 = new adapters, no core change.

---

## 10. Roadmap

**Phase 0 — done.** Execution surface + operator console: configure PostHog, board, POV
detail, approval/handoff, intake, settings, in-process (`local`) + Trigger modes.

**Phase 1 — Make it a POV and own the signal (NOW).**
1. **Telemetry: PostHog adapter + Live POV Health** — query real events, compute criteria
   attainment, show it live. (the moat, first)
2. **POV Plan Builder** — adopt the §3 schema, quantified criteria + `measuredBy`, co-sign.
3. **SE-approval gate generalized + Agent Activity Feed** — every customer-facing action
   proposed → approve/edit/reject → logged.

**Phase 2 — Tri-directional orchestration.**
4. Orchestration loop (sense→classify→decide→gate→act) with nudge + escalation engines.
5. Customer Collaboration Space.
6. Stakeholder / Champion map.

**Phase 3 — Decision + the buyer's screen.**
7. Go/No-Go Decision Room + value report.
8. Portfolio Analytics.
9. CRM + Slack integrations.

**Phase 4 — Prove horizontal.**
10. Extract adapter interfaces cleanly; onboard a 2nd product end-to-end.

---

## 11. Risks / open questions

- **Telemetry access for non-PostHog products** — the horizontal bet hinges on it. PostHog
  is free; design the adapter so the next product isn't a rewrite.
- **Buyer = SE leader / CRO**, not the end customer. Portfolio Analytics + hours-saved is
  what we actually sell; don't let the demo over-index on the customer screens.
- **"Promise to set up"** — acceptance is a plan, not a contract. Keep the language a
  commitment-to-evaluate, not a purchase obligation.
- **Nudge fatigue** — enterprise execs hate being pestered. Cadence limits + SE gate + a
  "the customer asked us to back off" state.
- **Distribution** — incumbents sit in Salesforce. Our wedge is autonomy + signal they
  can't bolt on; CRM sync (Phase 3) neutralizes their lock-in.

---

## 12. Our success metrics (the company)

Per POV we run: hours of SE time saved, days of cycle-time compression, % criteria
auto-measured (vs manual), and whether we drove a clean go/no-go. Across the book:
technical-win-rate lift vs. their baseline. If we can't move win-rate or save SE hours,
we don't have a business — instrument both from day one.
