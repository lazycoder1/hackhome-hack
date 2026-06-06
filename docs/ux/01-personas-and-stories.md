# PoC Pilot — Personas & User Stories

PoC Pilot is the human-facing layer on top of the PostHog PoC automation pipeline.
The backend already runs the agentic workflow (intake → plan → approval → setup →
validation → handoff); PoC Pilot gives the two human roles in that loop a place to
**see, steer, and trust** it.

This doc defines who uses the product, the jobs they hire it for, and the user
stories each surface satisfies. Stories map directly to the routes built in `web/`.

---

## Personas

### 1. Sasha — Solutions Engineer (primary / "operator")

> "I run six PostHog PoCs at once. I don't want to *do* the setup — I want to know
> which one needs me right now, and trust the rest is handled."

| | |
|---|---|
| **Role** | Pre-sales Solutions Engineer at PostHog |
| **Context** | Juggles 4–8 active PoCs across the sales funnel |
| **Goals** | Convert discovery calls into working demos fast; never drop a customer; prove setup actually works before promising it |
| **Frustrations** | Manual project setup is repetitive; status lives in her head and Slack threads; she finds out setup failed *after* she's told the customer it's ready |
| **Success looks like** | One screen that shows every PoC's true state, surfaces only the items that need a human, and gives the customer a polished experience without her hand-assembling it |
| **Primary surface** | Operator Console (`/`, `/poc/:id`, `/approvals`, `/intake`) |

### 2. Dana — Customer / Buyer Champion

> "I sat through the call. Now I just want to confirm the plan is right and get a
> working dashboard I can show my team."

| | |
|---|---|
| **Role** | Head of Product at the evaluating company (e.g. Northwind Logistics) |
| **Context** | Sponsoring a PostHog trial; busy, non-technical-adjacent |
| **Goals** | Make sure the PoC measures the *right* thing; get access fast; feel safe about PII/security |
| **Frustrations** | Vague setup emails; long credential threads; not knowing what was actually built |
| **Success looks like** | A one-screen plan she can approve in 20 seconds, then a single handoff page with links, a testing plan, and secure credentials |
| **Primary surface** | Customer journey (`/approval`, `/handoff/:id`, `/secrets/:token`) |

### 3. The Agents (the system itself)

The orchestrator and setup agents are not users, but PoC Pilot is their **window
to the humans**. Every agent decision (extracted plan, created resource, validation
verdict, escalation) must be legible to Sasha and, where relevant, to Dana. The UI's
job is to make autonomous work *inspectable* and *interruptible* at the two gates that
matter: customer approval and human review.

---

## User Stories — Operator (Sasha)

Format: *As a … I want … so that …* · **AC** = acceptance criteria · **Surface** = where it lives.

### Pipeline visibility

- **US-O1** — As an SE, I want every PoC grouped by the phase it's in so that I can
  see the whole funnel at a glance.
  **AC:** 18 backend lifecycle states collapse into 6 human phases (Intake,
  Confirmation, Setup, Validation, Handoff, Live & Done); each card shows customer,
  objective, status, and validation badge. **Surface:** `BoardPage` (`/`).

- **US-O2** — As an SE, I want top-line counts (total, awaiting approval, in flight,
  needs review) so that I know where to spend attention first.
  **AC:** four stat tiles; "in flight" and "needs review" pulse when > 0.
  **Surface:** `BoardPage`.

- **US-O3** — As an SE, I want the board to refresh itself so that I trust it reflects
  reality without a manual reload.
  **AC:** polls `GET /pocs` every 4s; newly-appeared PoCs flash. **Surface:**
  `usePocs` hook.

### Inspecting a single PoC

- **US-O4** — As an SE, I want a lifecycle stepper on each PoC so that I can see how
  far it's progressed and what's next.
  **AC:** horizontal stepper over the happy path; current state highlighted; failed/
  review states render in the flame accent. **Surface:** `PocDetailPage` → `Stepper`.

- **US-O5** — As an SE, I want to read the agent's extracted plan (objective, success
  criteria, event taxonomy, dashboards, optional assets, security) so that I can
  sanity-check it before it reaches the customer.
  **AC:** "Plan" tab renders plan if present, else falls back to raw requirements.
  **Surface:** `PocDetailPage` → `PlanView`.

- **US-O6** — As an SE, I want to see exactly what was created in PostHog, with deep
  links, so that I can verify the setup rather than take the agent's word.
  **AC:** "Setup & Resources" tab groups created resources by type, each linking to
  its PostHog URL; shows project, skipped items, credentials, SDK snippet.
  **Surface:** `SetupView`.

- **US-O7** — As an SE, I want a per-check validation report so that I can defend
  "it's ready" to the customer.
  **AC:** "Validation" tab lists each check with pass/warn/fail/skipped, evidence or
  error, pass/warn/fail tallies, and known gaps. **Surface:** `ValidationView`.

### The two human gates

- **US-O8** — As an SE, I want one place that lists PoCs waiting on a customer and
  PoCs escalated to me so that nothing stalls silently.
  **AC:** `/approvals` shows `confirmation_sent` and `needs_human_review` buckets.
  **Surface:** `ApprovalsPage`.

- **US-O9** — As an SE, I want to open the exact page the customer sees so that I can
  preview or nudge the approval. **AC:** "Open approval page" deep-links to the
  customer `/approval` route with the PoC's tokens. **Surface:** `PocDetailPage`.

- **US-O10** — As an SE, when validation fails I want the PoC flagged and held before
  handoff so that I never ship a broken PoC.
  **AC:** `needs_human_review` renders a warning banner on detail and a flame-bordered
  card in `/approvals`. **Surface:** detail banner + `ApprovalsPage`.

### Creating work

- **US-O11** — As an SE, I want to paste a discovery-call summary and have a plan
  extracted so that I skip manual data entry.
  **AC:** `/intake` posts the blob to `POST /requirements`; on success it routes to
  the new PoC; a "Use sample call" button pre-fills a realistic transcript.
  **Surface:** `IntakePage`.

- **US-O12** — As an SE, I want a reminder that customer text is untrusted so that I
  trust the safety model. **AC:** intake page states input shapes the plan but never
  executes tools, and setup only starts after approval. **Surface:** `IntakePage`.

---

## User Stories — Customer (Dana)

- **US-C1** — As a buyer, I want to see the plan (goal, success criteria, events,
  open questions) on one screen so that I can confirm it's right.
  **AC:** `/approval?...&pocId=` fetches and renders the plan. **Surface:** `ApprovalPage`.

- **US-C2** — As a buyer, I want to approve, request changes, or decline in one click
  so that I'm not stuck writing an email. **AC:** three actions post to
  `POST /approval/complete`; success state confirms setup is starting. **Surface:** `ApprovalPage`.

- **US-C3** — As a buyer, I want reassurance that nothing is built until I approve so
  that I feel in control. **AC:** copy states "Setup only begins after your approval".
  **Surface:** `ApprovalPage`.

- **US-C4** — As a buyer, I want a single handoff page with project links, what was
  configured, a testing plan tied to my goals, and validation status so that I can
  start immediately. **Surface:** `HandoffPage` (`/handoff/:id`).

- **US-C5** — As a buyer, I want credentials delivered as one-time links (never raw
  secrets in email) so that security is respected. **AC:** handoff shows one-time
  links; `/secrets/:token` renders the secret once then burns it. **Surface:**
  `HandoffPage` + server `renderSecretPage`.

- **US-C6** — As a buyer, I want my testing plan to map to the exact success criteria
  I asked for so that the PoC proves *my* case. **AC:** handoff numbers each success
  criterion as a test step. **Surface:** `HandoffPage`.

---

## Story → Surface coverage map

| Surface (route) | Stories |
|---|---|
| `BoardPage` `/` | US-O1, O2, O3 |
| `PocDetailPage` `/poc/:id` | US-O4, O5, O6, O7, O9, O10 |
| `ApprovalsPage` `/approvals` | US-O8, O10 |
| `IntakePage` `/intake` | US-O11, O12 |
| `ApprovalPage` `/approval` | US-C1, C2, C3 |
| `HandoffPage` `/handoff/:id` | US-C4, C5, C6 |
| `/secrets/:token` (server) | US-C5 |
