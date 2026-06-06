# PoC Pilot — User Flows

These flows show how the two humans move through PoC Pilot's screens, and where the
UI touches the real backend API. Routes and endpoints are exactly what's implemented
in `web/` and `src/server/http-server.ts`.

---

## Flow 0 — Map of surfaces

```mermaid
flowchart TB
  subgraph Operator["Operator Console (Sasha)"]
    BOARD["/  · Pipeline board"]
    INTAKE["/intake · New PoC"]
    APPROVALS["/approvals · Gates"]
    DETAIL["/poc/:id · Detail (Plan / Setup / Validation / Handoff)"]
  end
  subgraph Customer["Customer journey (Dana)"]
    APPROVAL["/approval · Confirm plan"]
    HANDOFF["/handoff/:id · Live PoC package"]
    SECRET["/secrets/:token · One-time secret"]
  end
  BOARD --> DETAIL
  INTAKE --> DETAIL
  APPROVALS --> DETAIL
  DETAIL -->|preview / deep-link| APPROVAL
  DETAIL -->|preview| HANDOFF
  APPROVAL -.email link.-> HANDOFF
  HANDOFF --> SECRET
```

---

## Flow 1 — Operator turns a call into a plan (US-O11)

```mermaid
flowchart TD
  A["Sasha clicks + New PoC"] --> B["/intake form"]
  B --> C{"Paste transcript<br/>or Use sample call"}
  C --> D["Extract plan →"]
  D --> E["POST /requirements"]
  E --> F{"Backend"}
  F -- "DEEPSEEK_API_KEY set" --> G["Orchestrator extracts<br/>PocRequirements + PocPlan"]
  F -- "key missing" --> H["Banner: add DEEPSEEK_API_KEY"]
  G --> I["Returns pocId"]
  I --> J["Auto-route to /poc/:id"]
  J --> K["PoC appears on board (Intake column, flashes)"]
```

**Trust boundary:** the pasted text is untrusted. It shapes the plan but never
executes a tool call. Setup cannot start here — only after the approval gate (Flow 3).

---

## Flow 2 — Operator triages the pipeline (US-O1, O2, O8)

```mermaid
flowchart TD
  A["Open / (board)"] --> B["usePocs polls GET /pocs every 4s"]
  B --> C["Cards grouped into 6 phases"]
  C --> D{"Stat tiles"}
  D -- "Needs review > 0" --> E["Go to /approvals → escalations"]
  D -- "Awaiting approval > 0" --> F["Go to /approvals → customer gates"]
  C -- "click card" --> G["/poc/:id detail"]
  G --> H{"Which tab tells the story?"}
  H --> I["Plan · what the agent understood"]
  H --> J["Setup · what it built in PostHog"]
  H --> K["Validation · proof it works"]
  H --> L["Handoff · what the customer gets"]
```

---

## Flow 3 — Customer confirms the plan (US-C1, C2, C3)

```mermaid
flowchart TD
  A["Dana gets confirmation email"] --> B["Opens /approval?tokenId&publicAccessToken&pocId"]
  B --> C["Page fetches GET /pocs/:id → renders plan"]
  C --> D{"Decision"}
  D -- "Approve" --> E["POST /approval/complete {decision: approved}"]
  D -- "Request changes" --> F["POST /approval/complete {decision: needs_changes, changes[]}"]
  D -- "Decline" --> G["POST /approval/complete {decision: rejected}"]
  E --> H["Success: 'Setup is starting now'"]
  F --> I["Plan revised → new confirmation (loop)"]
  G --> J["Request closed"]
  H --> K["Backend: status → approved → setup_queued"]
```

The operator can preview or drive this exact page from `/poc/:id` via **Open approval
page** (US-O9), so Sasha and Dana see the same artifact.

---

## Flow 4 — Setup, validation, and the human-review gate (US-O7, O10)

```mermaid
flowchart TD
  A["Approved → setup_running"] --> B["Setup agent creates PostHog resources"]
  B --> C["validation_running"]
  C --> D{"Validation verdict"}
  D -- "pass / warn" --> E["handoff_ready → handoff_sent"]
  D -- "fail" --> F["needs_human_review"]
  F --> G["Detail shows warning banner"]
  F --> H["Card appears in /approvals (flame border)"]
  G --> I{"Sasha decides"}
  I -- "override" --> E
  I -- "rerun setup" --> B
  E --> J["Customer handoff available"]
```

While a PoC is in `setup_running` or `validation_running`, its board card shows a live
pulse dot (US-O3) so Sasha can watch progress without opening it.

---

## Flow 5 — Customer receives the handoff (US-C4, C5, C6)

```mermaid
flowchart TD
  A["Dana opens /handoff/:id"] --> B["Fetch GET /pocs/:id → setupResult + plan"]
  B --> C["Open PostHog project / Main dashboard"]
  B --> D["Validation status banner"]
  B --> E["What we configured · testing plan mapped to success criteria"]
  B --> F["SDK snippet to start sending events"]
  B --> G{"Needs credentials?"}
  G --> H["Click one-time link → GET /secrets/:token"]
  H --> I["Secret shown once, then burned"]
  H --> J{"Re-open?"}
  J --> K["'Secret unavailable' (used)"]
```

---

## Edge & failure states the UI handles

| Condition | What the user sees |
|---|---|
| Backend unreachable | Board shows a red banner with the start command; sidebar status dot turns red |
| No PoCs in a phase | Column renders an "Empty" ticker tile, not a blank gap |
| Intake without `DEEPSEEK_API_KEY` | Friendly banner telling the operator to set the key and restart |
| PoC not found (`/poc/:id`) | "PoC not found" page with the error and a back link |
| Validation `fail` | Detail warning banner + `/approvals` escalation card; handoff held |
| Secret link reused/expired | Branded "Secret unavailable" page (`used` / `expired` / `not_found`) |
| Approval link missing tokens | Approval page disables actions and tells the buyer to reply to the email |
