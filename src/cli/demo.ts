import { createAgentSystem } from "../app/create-agent-system.js";
import { InMemoryEmailTool, InMemorySecretsTool } from "../tools/in-memory-tools.js";
import { InMemoryPocStore } from "../state/in-memory-poc-store.js";
import type { LlmJsonClient } from "../llm/types.js";
import type { SubmitRequirementsBlobInput } from "../orchestrator/orchestrator.js";

// A self-contained happy-path demo: it runs the real intake → plan → approve → setup → handoff
// pipeline fully in-process with in-memory tools and a deterministic offline LLM, so it needs
// zero external credentials. Run with: npm run demo
const SAMPLE_BLOB: SubmitRequirementsBlobInput = {
  source: "api",
  text: "Acme wants to evaluate PostHog for signup activation analytics — whether new users reach the activation moment within their first session.",
  participants: [
    { name: "Dana Buyer", email: "buyer@acme.test", company: "Acme", role: "Head of Growth" },
  ],
  sourceMetadata: { sourceId: "demo-requirements-1" },
};

const demoLlm: LlmJsonClient = {
  async completeJson(input) {
    if (input.model.includes("flash")) {
      return {
        intent: "approved",
        confidence: 0.97,
        extractedChanges: [],
        requiresHumanReview: false,
      };
    }
    return {
      customer: {
        companyName: "Acme",
        companySlug: "acme",
        contacts: [{ email: "buyer@acme.test", isPrimary: true }],
      },
      product: "posthog",
      businessGoal: "Evaluate PostHog for signup activation analytics.",
      successCriteria: ["Track the signup funnel", "Confirm activation within the first session"],
      appContext: { platform: ["web"] },
      posthogContext: {
        projectId: "demo-project-1",
        projectName: "Acme PoC",
        useExistingProject: true,
      },
      analyticsScope: {
        events: [
          { name: "signup_started", description: "User begins signup", required: true },
          { name: "signup_completed", description: "User completes signup", required: true },
          {
            name: "activation_reached",
            description: "User reaches the activation moment",
            required: true,
          },
        ],
      },
      assumptions: [],
      openQuestions: [],
    };
  },
};

function heading(title: string): void {
  console.log(`\n${"=".repeat(64)}\n  ${title}\n${"=".repeat(64)}`);
}

async function main(): Promise<void> {
  const email = new InMemoryEmailTool();
  const store = new InMemoryPocStore();
  const system = createAgentSystem({
    llm: demoLlm,
    store,
    email,
    secrets: new InMemorySecretsTool({ baseSecretUrl: "https://secrets.demo.test" }),
    approvalMode: "local",
    posthogMode: "local",
    eventCaptureMode: "local",
    usageSnapshotMode: "local",
    validationMode: "local",
  });

  heading("1. Intake — submit requirements blob");
  const intake = await system.orchestrator.submitRequirementsBlob(SAMPLE_BLOB);
  console.log(`pocId:        ${intake.pocId}`);
  console.log(`status:       ${intake.status}`);
  if (intake.approvalUrl) {
    console.log(`approval URL: ${intake.approvalUrl}`);
  }
  if (intake.status !== "confirmation_sent") {
    console.log("\nIntake is blocked for clarification; nothing to approve. Demo stops here.");
    return;
  }

  heading("2. Plan generated (awaiting approval)");
  const plan = await store.getPlan(intake.pocId, 1);
  console.log(`objective:    ${plan?.objective ?? "(n/a)"}`);
  console.log(`target proj:  ${plan?.posthogTarget.projectId ?? "(n/a)"}`);
  console.log(
    `events:       ${(plan?.setup.events ?? []).map((event) => event.name).join(", ") || "(none)"}`,
  );

  heading("3. Approve + run PostHog setup");
  const result = await system.workflow.approveAndRunSetup({
    pocId: intake.pocId,
    approvedBy: "buyer@acme.test",
    approvalSource: "approval_link",
  });
  console.log(`setup status:      ${result.setupResult.status}`);
  console.log(`validation status: ${result.setupResult.validationReport?.status ?? "(n/a)"}`);
  console.log(
    `resources created: ${result.setupResult.createdResources.length}` +
      ` (${result.setupResult.createdResources.map((resource) => resource.type).join(", ") || "none"})`,
  );
  console.log(
    `credential links:  ${result.setupResult.credentialRefs.map((ref) => ref.name).join(", ") || "none"}`,
  );

  heading("4. Handoff email (delivered to customer)");
  const handoff = email.sentEmails.at(-1);
  console.log(`subject: ${handoff?.subject ?? "(none)"}\n`);
  console.log(handoff?.markdownBody ?? "(no body)");

  heading("Done");
  console.log(`Final PoC status: ${(await store.getPoc(intake.pocId))?.status}`);
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exitCode = 1;
});
