# PoC Pilot — Operator Console & Customer Journey (web)

A Vite + React + Tailwind frontend for the PostHog PoC automation backend. It is the
human-facing layer over the agentic pipeline: a pipeline board and PoC detail view for
the operator (Solutions Engineer), and polished approval + handoff pages for the
customer. It talks to the existing JSON API in `src/server/http-server.ts` — no backend
changes are required to read data.

PostHog-inspired design system: warm cream canvas, near-black ink, hard 2px borders
with offset shadows, and the blue / red-orange / yellow accent triad.

## Surfaces

| Route | Audience | What it is |
|---|---|---|
| `/` | Operator | Pipeline board — 8 demo PoCs across 6 phase columns, live stats |
| `/poc/:pocId` | Operator | Detail: lifecycle stepper + Plan / Setup & Resources / Validation / Handoff tabs |
| `/approvals` | Operator | Human gates: awaiting customer approval + escalated for review |
| `/intake` | Operator | Paste a call summary → `POST /requirements` → extracted plan |
| `/approval` | Customer | Confirm the plan (approve / request changes / decline) |
| `/handoff/:pocId` | Customer | Live PoC package: links, testing plan, validation, secure credentials |

The server also renders the one-time secret page at `/secrets/:token` (branded to match).

### Story mode

Toggle **Story mode** in the sidebar (on by default) to show small `O1`/`C4`-style
badges next to key elements and action links. Hover a badge — or the link it annotates,
like **Open approval page** or **Customer handoff** — to read the exact user story that
element satisfies. Operator stories are blue, customer stories berry. The registry lives
in [`src/stories.ts`](./src/stories.ts) and mirrors
[`docs/ux/01-personas-and-stories.md`](../docs/ux/01-personas-and-stories.md).

## Run it (live, against the real backend)

From the repo root:

```bash
# 1. Build the backend and seed a realistic pipeline (no API keys needed to read).
npm install
npm run build
node scripts/seed-demo.mjs        # writes .data/pocs.json (8 PoCs across all phases)
npm run api:start                 # backend on http://127.0.0.1:3000
```

In a second terminal:

```bash
cd web
npm install
npm run dev                       # app on http://localhost:5173 (proxies API to :3000)
```

Open http://localhost:5173.

### The live AI intake moment

`GET /pocs` and `/pocs/:id` work with zero credentials, so the whole read-side
(board, detail, approval render, handoff) is fully live from the seed. The only path
that needs a key is **New PoC** (`/intake` → `POST /requirements`), which runs the
orchestrator agent:

```bash
# in repo root .env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5-high
```

Restart `npm run api:start` and the intake form will extract a real plan from pasted
call text and route you to the new PoC on the board.

## How it connects

- `src/api.ts` — typed fetch client for `/pocs`, `/pocs/:id`, `/requirements`,
  `/approval/complete`, `/health`.
- `src/types.ts` — TypeScript mirror of `src/contracts.ts` (kept in sync by hand so the
  web app stays a standalone build).
- `src/lifecycle.ts` — maps the backend's 18 lifecycle states into the 6 operator
  phases, status pill styling, and the detail-page stepper order.
- `src/hooks.ts` — `usePocs` (board, polls every 4s, flashes new PoCs) and `usePoc`
  (detail).
- `vite.config.ts` — dev proxy so the SPA and backend share one origin (no CORS).

## Build

```bash
npm run build        # tsc -b && vite build → dist/
npm run lint         # tsc --noEmit
```

## Vercel

Production is the Vite app in this `web/` directory. `vercel.json` proxies backend
API paths to the Railway API at `https://hackhome-hack-production.up.railway.app`
and falls back all other paths to `index.html` so client routes such as `/settings`
load directly.

Optional Vercel env:

```bash
VITE_API_BASE_URL=https://hackhome-hack-production.up.railway.app
```

Leave it unset when relying on the committed rewrites.
