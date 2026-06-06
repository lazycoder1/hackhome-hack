// Approve a PoC the realistic way: POST an inbound "confirmed, please proceed"
// reply to /email/inbound. The worker classifies it (DeepSeek) as approved and
// completes the Trigger.dev waitpoint, which resumes setup. Then poll the PoC
// detail until setup reaches a terminal state and print the result.
import { config as loadDotenv } from "dotenv";

loadDotenv();

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const POCID = required("POCID");

await postJson("/email/inbound", {
  pocId: POCID,
  message: {
    id: `e2e-approve-${Date.now()}`,
    threadId: `e2e-thread-${POCID}`,
    from: "vgs@getconvinced.ai",
    to: ["poc@example.com"],
    subject: "Re: Please confirm your PostHog PoC plan",
    textBody:
      "Confirmed. This is exactly the dashboard we need for the pilot. Please proceed and send the final dashboard view when it is ready.",
    receivedAt: new Date().toISOString(),
  },
});
console.log(`Approval reply dispatched for ${POCID}. Waiting for setup to finish ...`);

const detail = await pollForSetup();
console.log("\n=== FINAL PoC DETAIL ===");
console.log(JSON.stringify(detail, null, 2));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (e.g. POCID=... node scripts/e2e-approve.mjs)`);
  return value;
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

async function pollForSetup(attempts = 80, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(`${BASE}/pocs/${POCID}`);
    if (response.ok) {
      const detail = await response.json();
      const status = detail.summary?.status;
      const setupStatus = detail.summary?.setupStatus;
      process.stdout.write(`  [${i}] status=${status} setup=${setupStatus ?? "-"}\r`);
      if (setupStatus === "succeeded" || setupStatus === "failed") return detail;
      if (status === "rejected" || status === "needs_clarification") return detail;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Timed out waiting for setup to reach a terminal state.");
}
