import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Trigger.dev task exports", () => {
  it("exports stable task IDs for the PostHog PoC workflow", () => {
    const source = readFileSync(join(process.cwd(), "trigger/posthog-poc-workflow.ts"), "utf8");

    expect(source).toContain('id: "posthog-poc-workflow"');
    expect(source).toContain('id: "setup-approved-posthog-poc"');
    expect(source).toContain('id: "process-posthog-poc-email-reply"');
    expect(source).toContain('id: "monitor-active-posthog-poc"');
    expect(source).toContain('id: "retry-posthog-poc-stage"');
    expect(source).toContain('id: "monitor-gmail-inbox"');
    expect(source).toContain("wait.forToken<ApprovalDecision>");
    expect(source).toContain("system.workflow.processEmailReply(payload)");
    expect(source).toContain("system.workflow.retryPocStage(payload)");
    expect(source).toContain("new GmailInboxMonitor");
    expect(source).toContain('approval.decision === "needs_changes"');
    expect(source).toContain("system.orchestrator.revisePlanFromChanges");
  });
});
