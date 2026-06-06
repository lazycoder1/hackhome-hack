# PoC Pilot — 2-Minute Demo Video Script

A shot-by-shot script for a 120-second walkthrough. Built to be recorded against the
**live app** (backend on `:3000`, Vite on `:5173`, seeded with `scripts/seed-demo.mjs`).
Frames referenced as `docs/screens/NN-*.png` are the exact states captured from the
running app, so you can storyboard before recording.

**Recording setup:** 1440×900, light mode, hide bookmarks bar. Cursor visible.
Total: 6 scenes, ~120s. Word count of VO is tuned to ~150 wpm.

---

### Scene 1 — The problem & the board (0:00–0:22) · `01-board.png`

**On screen:** Open on `/` — the full pipeline board, 8 PoCs across 6 phase columns.
Slow cursor drift across the columns. The "In flight" and "Needs review" tiles pulse.

**VO:**
> "A solutions engineer might run six PostHog proof-of-concepts at once. Each one is a
> dozen manual steps between a sales call and a working demo. This is PoC Pilot — every
> PoC, from discovery call to live handoff, on one board. Six phases, real-time status,
> and right away it's telling me one thing needs a human."

**On-screen text:** `8 PoCs · 1 awaiting approval · 1 needs review`

---

### Scene 2 — From a call to a plan (0:22–0:42) · `07-intake.png`

**On screen:** Click **+ New PoC** → `/intake`. Click **Use sample call** so the
textarea fills with the Northwind discovery summary. Hover **Extract plan →**.

**VO:**
> "It starts with a call. I paste the summary — no forms, no manual taxonomy. The
> orchestrator agent reads it and extracts a structured plan: the goal, the events,
> the dashboards. And notice: the customer's words shape the plan, but they never
> trigger any setup. Nothing gets built until a human approves."

**On-screen text:** `Paste transcript → agent extracts the plan`

---

### Scene 3 — Inspect what the agent understood (0:42–1:04) · `02-detail-plan.png` → `03-detail-setup.png`

**On screen:** Land on `/poc/:id`. Pan the lifecycle stepper. Stay on the **Plan** tab
(objective, success criteria, event taxonomy). Then click **Setup & Resources** — the
resource tree grouped by PostHog type, each row a deep link.

**VO:**
> "Every PoC has a full story. Here's the plan the agent built — the goal, the success
> criteria, the exact events it'll track. And once setup runs, I can see precisely what
> it created inside PostHog: the project, dashboards, insights, actions — each one a real
> link. I'm verifying the work, not taking its word for it."

**On-screen text:** `Plan → Setup → every resource is a real PostHog link`

---

### Scene 4 — Proof, and the safety net (1:04–1:28) · `04-detail-validation.png` → `09-validation-fail.png`

**On screen:** Click **Validation** on the passing PoC (Acme) — green checks. Then cut
to `/poc/poc_stark` Validation tab: the warning banner, the flame stepper node, FAIL
checks, the 2/0/2 tally.

**VO:**
> "Before I ever tell a customer 'it's ready,' PoC Pilot proves it. It fires synthetic
> events and runs checks — here everything passes. But when validation fails, like this
> one, the PoC is automatically held for human review. No broken PoC ever reaches a
> customer. The one thing that needs me is surfaced, not buried."

**On-screen text:** `Validation gates the handoff — failures escalate, never ship`

---

### Scene 5 — The customer's approval (1:28–1:46) · `05-approval.png`

**On screen:** Navigate to the customer `/approval` page for Northwind. Scroll the plan:
goal, success criteria, event chips, open questions. Hover **Approve & start setup**.

**VO:**
> "Here's what the customer sees — one screen. The goal, the success criteria, the events
> we'll track, even our open questions. They approve, request a change, or decline in a
> single click. No credential threads, no setup confusion. This is the moment that used
> to be a hand-written email."

**On-screen text:** `One click: approve, request changes, or decline`

---

### Scene 6 — The handoff & close (1:46–2:00) · `06-handoff.png`

**On screen:** Cut to `/handoff/:id`. Scroll: Open PostHog project, the green validation
banner, "what we configured," the numbered testing plan, the one-time credential link.
End on the PoC Pilot logo.

**VO:**
> "And the payoff: a live PoC, delivered. Project links, a testing plan mapped to exactly
> what they asked for, validation they can trust, and credentials as secure one-time links
> — never raw secrets in an email. Discovery call to working PostHog PoC, with a human in
> control at every gate. That's PoC Pilot."

**On-screen text:** `Call → configured, validated PostHog PoC. PoC Pilot.`

---

## Timing summary

| Scene | Time | Frame(s) | Beat |
|---|---|---|---|
| 1 | 0:00–0:22 | `01-board` | The board, the problem |
| 2 | 0:22–0:42 | `07-intake` | Call → plan (the AI moment) |
| 3 | 0:42–1:04 | `02`, `03` | Inspect plan + created resources |
| 4 | 1:04–1:28 | `04`, `09` | Validation pass + the fail safety net |
| 5 | 1:28–1:46 | `05-approval` | Customer one-click approval |
| 6 | 1:46–2:00 | `06-handoff` | The delivered PoC |

## Recording tips

- Pre-seed and warm both servers; do a dry run so the board is populated and the
  `usePocs` poll has settled (no loading spinners on camera).
- For Scene 2's "live AI" beat, set `DEEPSEEK_API_KEY` so **Extract plan** really runs
  and routes to a brand-new card that flashes onto the board — the strongest 6 seconds
  in the video. Without the key, narrate over the seeded PoCs instead.
- Use the browser zoom at 100%; the hard-border cards read crisply at 1440px.
- Keep the cursor moving slowly and deliberately; let each card breathe for ~1s.
