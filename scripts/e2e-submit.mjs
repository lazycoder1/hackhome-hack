// Submit the widget-adoption requirements blob to the running API server
// (WORKFLOW_MODE=trigger), then poll GET /pocs until the new PoC reaches a
// terminal-for-now state and print its pocId. Pure driver for the E2E runbook;
// it does NOT approve — that is a separate, deliberate step.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT_ID = required("POSTHOG_PROJECT_ID");

const transcriptPath = resolve(
  process.cwd(),
  "docs/sample-transcripts/widget-adoption-enmovil-bizom.md",
);
const transcript = await readFile(transcriptPath, "utf8");

const beforeIds = new Set((await listPocs()).map((poc) => poc.pocId));
const run = await postJson("/requirements", buildPayload(transcript));
console.log(`Triggered posthog-poc-workflow run: ${run.runId}`);
console.log("Waiting for the worker to mint a PoC + reach confirmation_sent ...");

const poc = await pollForNewPoc(beforeIds);
console.log("\n=== NEW PoC ===");
console.log(JSON.stringify(poc, null, 2));
console.log(`\nNext: approve it with\n  POCID=${poc.pocId} node scripts/e2e-approve.mjs`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (load it from .env)`);
  return value;
}

async function listPocs() {
  const response = await fetch(`${BASE}/pocs?limit=25`);
  if (!response.ok) throw new Error(`GET /pocs failed: ${response.status}`);
  return (await response.json()).pocs ?? [];
}

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function pollForNewPoc(beforeIds, attempts = 60, delayMs = 3000) {
  for (let i = 0; i < attempts; i++) {
    const fresh = (await listPocs()).find((poc) => !beforeIds.has(poc.pocId));
    if (fresh && fresh.status !== "intake") return fresh;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Timed out waiting for the worker to create a confirmation_sent PoC.");
}

function buildPayload(text) {
  return {
    source: "file",
    filename: "docs/sample-transcripts/widget-adoption-enmovil-bizom.md",
    text,
    participants: [
      {
        name: "VGS",
        email: "vgs@getconvinced.ai",
        company: "Convinced",
        role: "Product/Growth stakeholder",
      },
      {
        name: "GGS",
        email: "ggs@getconvinced.ai",
        company: "Convinced",
        role: "Stakeholder",
      },
      {
        name: "Nihal",
        email: "nihaliddya@gmail.com",
        company: "Convinced",
        role: "Operator",
      },
    ],
    structuredHints: structuredHints(),
    sourceMetadata: {
      sourceId: `e2e-trigger-${Date.now()}`,
      receivedAt: new Date().toISOString(),
    },
  };
}

function structuredHints() {
  return {
    businessGoal:
      "Create a PM dashboard for landing-page widget adoption, email capture, and demo intent across the deployed Convinced widget.",
    successCriteria: [
      "Show widget adoption by landing page and company.",
      "Show email capture and demo intent trends with clear chart axes.",
      "Call out caveats when live event volume is low or data is session-based.",
    ],
    assumptions: [
      "Operator clarification for this run: use live observed production event names when they differ from planned metric labels.",
      "Email capture may be widget_email_submitted, widget_email_captured, identity-capture, resource-request, or demo-request email fields.",
      "Demo intent may include submitted demo request events from chat or voice flows; include voice_only.demo_request_submitted when live evidence supports it.",
      "Low event volume should be treated as a dashboard caveat, not a blocker.",
      "The buyer audience is PM/growth; ask follow-up only for business definitions not answerable from the transcript and live evidence.",
    ],
    appContext: { appName: "Convinced widget", platform: ["web"], environments: ["prod"] },
    posthogContext: {
      projectId: PROJECT_ID,
      projectName: process.env.POSTHOG_PROJECT_NAME ?? "Convinced",
      organizationId: process.env.POSTHOG_ORGANIZATION_ID,
      region: "US",
      useExistingProject: true,
    },
    analyticsScope: {
      events: [
        {
          name: "widget_session_started",
          description: "Visitor starts a widget session.",
          required: false,
        },
        {
          name: "widget_first_message_sent",
          description: "Visitor sends the first message.",
          required: false,
        },
        {
          name: "widget_engaged_session",
          description: "Visitor reaches the engaged-session threshold.",
          required: false,
        },
        {
          name: "widget_email_captured",
          description: "Visitor email captured from identity/resource/demo flow.",
          required: false,
        },
        {
          name: "widget_demo_requested",
          description: "Visitor submits a demo or book-a-demo request.",
          required: false,
        },
      ],
      dashboards: [
        {
          name: "Widget adoption PM dashboard",
          description:
            "Agentic PM dashboard for widget sessions, conversion, landing pages, and company/page adoption.",
          tiles: [],
        },
      ],
    },
  };
}
