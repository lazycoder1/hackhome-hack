// Trigger the monitor-gmail-inbox task once and report what it found. Use this
// AFTER a real human (vgs@/ggs@) replies to the confirmation email: the worker
// reads the inbox over Gmail REST (EMAIL_MODE=gmail_api), classifies the reply,
// and completes the Trigger.dev approval waitpoint — resuming setup.
//
//   POCID=<pocId> node scripts/e2e-poll-inbox.mjs
//
// POCID is optional; if omitted the monitor resolves the PoC from the email
// thread, but passing it is more reliable.
import { config as loadDotenv } from "dotenv";
import { tasks, runs } from "@trigger.dev/sdk";

loadDotenv();

const TERMINAL = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "INTERRUPTED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
]);

const pocId = process.env.POCID;
const payload = pocId ? { pocId } : {};
console.log(`Triggering monitor-gmail-inbox${pocId ? ` for ${pocId}` : " (thread-resolved)"} ...`);

const handle = await tasks.trigger("monitor-gmail-inbox", payload);
console.log(`run: ${handle.id} — waiting for it to finish ...`);

const run = await waitForRun(handle.id);
console.log(`\nstatus: ${run.status}`);
if (run.output) console.log("result:", JSON.stringify(run.output, null, 2));
if (run.error) console.log("error:", JSON.stringify(run.error, null, 2));

const processed = run.output?.processedMessages ?? 0;
console.log(
  processed > 0
    ? `\n✓ Processed ${processed} reply message(s) — if one was an approval, the waitpoint is now complete and setup is resuming. Check the PoC detail.`
    : "\n• No matching reply found yet. Make sure vgs@/ggs@ replied (it lands in your inbox), then run this again.",
);

async function waitForRun(runId, attempts = 60, delayMs = 4000) {
  for (let i = 0; i < attempts; i++) {
    const run = await runs.retrieve(runId);
    process.stdout.write(`  [${i}] ${run.status}\r`);
    if (TERMINAL.has(run.status)) return run;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Timed out waiting for monitor-gmail-inbox to finish.");
}
