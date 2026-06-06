# End-to-End Trigger.dev Runbook

Drive the full PoC lifecycle through **Trigger.dev Cloud**: intake → plan → confirmation
(Gmail draft) → durable approval waitpoint → real PostHog setup → validation → handoff.

This exercises the path `WORKFLOW_MODE=local` cannot: the cloud-suspended
`wait.forToken` approval waitpoint and the cross-process file store.

## What it touches (real side effects)

- **PostHog project `212567`**: creates a real dashboard + insights. Clean up after.
- **Gmail (`EMAIL_MODE=gmail_api`)**: **sends** confirmation + handoff email via the Gmail REST
  API (`messages/send`) as the OAuth'd account. The hosted Gmail MCP (`gmail_mcp`) is Google
  **Workspace-gated** and returns "caller does not have permission" for a consumer `@gmail.com`
  account, so `gmail_api` (direct REST) is required for a personal Google account.
- **DeepSeek**: requirements extraction, reply classification, agentic dashboard drafting.
- **Trigger.dev Cloud** project `PostHog PoC Testing` (`proj_cqdjxrystsxcxqayyzfu`).

## Prerequisites (one-time)

| Need | How | Status |
|------|-----|--------|
| Trigger CLI logged in | `npx trigger.dev@4.4.6 whoami` | ✅ already logged in (`nihaliddya@gmail.com`) |
| `.env` populated | `TRIGGER_*`, `DEEPSEEK_API_KEY`, `POSTHOG_MCP_API_KEY`, `POSTHOG_PROJECT_ID`, `GMAIL_*` | ✅ confirmed set |
| `WORKFLOW_MODE=trigger` | the server reads this to dispatch to the cloud | ✅ (effective value in `.env`) |

> Note: `.env` has two `WORKFLOW_MODE=` lines; dotenv keeps the **last** (`trigger`).
> If in doubt, prefix the server command with `WORKFLOW_MODE=trigger` (step 2).

## Terminals

You need **three** terminals, all from the repo root.

### Terminal 1 — Trigger.dev worker (you already have this running)

```bash
npm run build          # compile trigger/ + src/ to dist first
npm run trigger:dev    # registers the 6 tasks, executes their run() bodies locally vs cloud
```

Leave it running. Every real PostHog/DeepSeek/Gmail call fires from **this** process.
Watch it for live task logs (`posthog-poc-workflow`, `process-posthog-poc-email-reply`).

### Terminal 2 — API server (the dispatcher)

```bash
npm run build
WORKFLOW_MODE=trigger node dist/src/server/index.js
# -> "PostHog PoC automation API listening on http://127.0.0.1:3000"
```

This is the only new process you start. It turns HTTP calls into `task.trigger()`.

### Terminal 3 — driver (you run these steps)

## Step 1 — Submit requirements (intake → plan → confirmation → waitpoint)

```bash
node scripts/e2e-submit.mjs
```

- POSTs the widget-adoption transcript + structured hints to `/requirements`.
- Prints the Trigger `runId`, then polls `GET /pocs` until the worker mints a PoC and
  reaches `confirmation_sent` (the run is now **suspended on the cloud** at the waitpoint).
- Prints the **`pocId`** — copy it.

In **Terminal 1** you'll see `posthog-poc-workflow` run, draft the plan, create the Gmail
draft, and then "Waiting for waitpoint token…".

## Step 2 — Approve (completes the cloud waitpoint, resumes setup)

```bash
POCID=<pocId-from-step-1> node scripts/e2e-approve.mjs
```

- POSTs a "Confirmed, please proceed" reply to `/email/inbound`.
- The worker's `process-posthog-poc-email-reply` task DeepSeek-classifies it as `approved`
  and completes the waitpoint from the persisted `approvalTokenId`.
- `posthog-poc-workflow` resumes → `approveAndRunSetup` → agentic dashboard creation against
  PostHog `212567` → validation.
- The script polls `GET /pocs/:pocId` and prints the final detail when `setupStatus` is
  `succeeded` / `failed`.

## Step 2b — Approve by a REAL email reply (optional, more end-to-end)

Instead of the simulated `/email/inbound` POST in Step 2, you can approve by actually
replying to the confirmation email:

1. Have **`vgs@` or `ggs@` reply** "approved / please proceed" to the confirmation email.
   The reply lands in **your** (`nihaliddya@gmail.com`) inbox, since that's the sending
   account. (A reply you send yourself sits in Sent, not Inbox, so it won't be picked up.)
2. Pull the inbox and let the worker classify + complete the waitpoint:
   ```bash
   POCID=<pocId-from-step-1> node scripts/e2e-poll-inbox.mjs
   ```
   This triggers the `monitor-gmail-inbox` task, which reads your inbox over the **Gmail REST
   API** (`GmailApiInboxGateway`, auto-selected because `EMAIL_MODE=gmail_api`), matches the
   reply to the PoC, and completes the approval — resuming setup. Re-run it if the reply
   hasn't arrived yet (nothing polls automatically).

> The inbox monitor picks its gateway by `EMAIL_MODE`: `gmail_api` → Gmail REST (works for
> personal Gmail); anything else → the Workspace-gated Gmail MCP. So the same Workspace
> limitation that blocks `gmail_mcp` *sending* also blocks `gmail_mcp` *reading*.

## Step 3 — Inspect the result

Look for, in the final detail JSON (or via `curl -s http://127.0.0.1:3000/pocs/<pocId> | jq`):

- `summary.status` → `handoff_sent` or `handoff_sent_with_gaps`
- `summary.setupStatus` → `succeeded`
- `summary.validationStatus` → `pass`
- `setupResult.createdResources[]` → the real dashboard URL + insight URLs
- The Gmail **handoff draft** in your inbox.

## Expected good outcome

```
status=handoff_sent  setupStatus=succeeded  validationStatus=pass
dashboard: https://us.posthog.com/project/212567/dashboard/<id>
insights:  4 (resolvable short_id URLs)
```

## Manual alternative (no helper scripts)

```bash
# Submit (returns {"runId": "..."}). Build the JSON body however you like.
curl -s -XPOST http://127.0.0.1:3000/requirements \
  -H 'content-type: application/json' --data @your-requirements.json

# Find the new pocId
curl -s 'http://127.0.0.1:3000/pocs?limit=5' | jq '.pocs[] | {pocId,status,setupStatus}'

# Approve via inbound reply
curl -s -XPOST http://127.0.0.1:3000/email/inbound -H 'content-type: application/json' -d '{
  "pocId":"<pocId>",
  "message":{"id":"m1","threadId":"t1","from":"vgs@getconvinced.ai","to":["poc@example.com"],
  "subject":"Re: Please confirm your PostHog PoC plan",
  "textBody":"Confirmed. Please proceed.","receivedAt":"2026-06-06T00:00:00Z"}}'

# Poll
curl -s http://127.0.0.1:3000/pocs/<pocId> | jq '.summary'
```

**Human-in-the-loop variant:** instead of `/email/inbound`, open the Gmail confirmation
**draft**, send it, then click the approval link (it carries `tokenId` +
`publicAccessToken` → the `/approval` page → `POST /approval/complete`). Requires
`APPROVAL_BASE_URL` to be reachable (default `http://localhost:3000/approval`).

## Troubleshooting

- **Submit times out at `intake`** → worker (Terminal 1) isn't running or can't reach the
  cloud. Check `npx trigger.dev@4.4.6 whoami` and Terminal 1 logs.
- **Approve never leaves `confirmation_sent`** → the reply was classified `unclear`. Make the
  `textBody` an unambiguous approval, or use the Gmail-link variant.
- **Gmail MCP 401 "missing required authentication credential"** → the stored Google OAuth
  access token expired. The worker now auto-refreshes it via `GoogleOAuthTestService`
  (`gmailAccessTokenProvider` wired into the trigger tasks), so this self-heals on the next
  run as long as the saved refresh token is valid. To force a refresh manually:
  `node -e 'require("dotenv").config();require("./dist/src/integrations/google-oauth-test-service.js").GoogleOAuthTestService.prototype;(async()=>{const {GoogleOAuthTestService}=require("./dist/src/integrations/google-oauth-test-service.js");await new GoogleOAuthTestService().freshAccessToken();})()'`
  If the refresh token itself is revoked, re-consent via the frontend settings page
  (`/settings` → Connect Google), then re-run. After editing any `trigger/*.ts`, make sure
  `npm run trigger:dev` hot-reloaded (or restart it) before re-triggering.
- **Setup `failed` with a dashboard gap** → the agentic harness ships the validated tile
  subset; check `setupResult.knownGaps` and Terminal 1 logs for the dropped tiles.
- **Duplicate runs** → each submit mints a fresh `pocId`; the submit script disambiguates by
  diffing `GET /pocs` before/after.

## Cleanup

PostHog MCP exposes **no delete tool**. After testing, manually delete the created
dashboard + insights in project `212567` (filter by tag `source:poc-automation`). Also
discard the Gmail drafts if you don't want them.
