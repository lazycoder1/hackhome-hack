import { config as loadDotenv } from "dotenv";
import { runPostHogMcpMutationSmokeCheck } from "../posthog/posthog-mcp-mutation-smoke-check.js";

loadDotenv();

const report = await runPostHogMcpMutationSmokeCheck();

console.log(JSON.stringify(report, null, 2));

if (report.status !== "pass") {
  process.exitCode = 1;
}
