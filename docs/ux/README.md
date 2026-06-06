# PoC Pilot — UX Documentation

PoC Pilot is the human-facing frontend for the PostHog PoC automation pipeline (this
repo's backend). It gives the **operator** (Solutions Engineer) a pipeline board and
deep PoC inspection, and gives the **customer** a polished approval + handoff journey —
all live against the existing JSON API.

The app lives in [`web/`](../../web/) (Vite + React + Tailwind). To run it, see
[`web/README.md`](../../web/README.md).

## Contents

| Doc | What's in it |
|---|---|
| [01 — Personas & User Stories](./01-personas-and-stories.md) | Sasha (operator), Dana (customer), the agents; 18 user stories mapped to routes |
| [02 — User Flows](./02-user-flows.md) | Surface map + 5 flows (intake, triage, approval, validation gate, handoff) with mermaid; edge/failure states |
| [03 — Journey Maps](./03-journey-maps.md) | Per-persona journeys with emotional arcs; the interlocking sequence |
| [04 — Demo Video Script](./04-demo-video-script.md) | Shot-by-shot 2-minute script tied to the captured frames |
| [Screens](../screens/) | Live screenshots captured from the running app |

## Captured screens

| File | Surface |
|---|---|
| `01-board.png` | Pipeline board (`/`) |
| `02-detail-plan.png` | PoC detail — Plan tab |
| `03-detail-setup.png` | PoC detail — Setup & Resources tab |
| `04-detail-validation.png` | PoC detail — Validation (pass) |
| `05-approval.png` | Customer approval page (`/approval`) |
| `06-handoff.png` | Customer handoff page (`/handoff/:id`) |
| `07-intake.png` | New PoC intake (`/intake`) |
| `08-approvals.png` | Approvals & reviews (`/approvals`) |
| `09-validation-fail.png` | PoC detail — Validation (fail → human review) |

## Design system in one line

PostHog-inspired: warm cream canvas, near-black ink, hard 2px borders with offset
shadows, and the blue / red-orange / yellow accent triad. Tokens live in
[`web/src/index.css`](../../web/src/index.css); the 18-state → 6-phase lifecycle model
lives in [`web/src/lifecycle.ts`](../../web/src/lifecycle.ts).
