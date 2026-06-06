import { config as loadDotenv } from "dotenv";
import { runPostHogMcpSmokeCheck } from "../posthog/posthog-mcp-smoke-check.js";

loadDotenv();

const report = await runPostHogMcpSmokeCheck();

console.log(JSON.stringify(report, null, 2));

if (report.status !== "pass") {
  process.exitCode = 1;
}
