import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import {
  InMemoryApprovalTool,
  InMemoryAuditTool,
  InMemoryEmailTool,
} from "../src/tools/in-memory-tools.js";
import type { LlmJsonClient } from "../src/llm/types.js";

describe("Orchestrator missing-detail detection + customer summary", () => {
  it("adds a plan summary and surfaces confirmable gaps as open questions", async () => {
    const store = new InMemoryPocStore();
    const llm: LlmJsonClient = {
      async completeJson() {
        return {
          customer: {
            companyName: "Acme",
            companySlug: "acme",
            contacts: [{ email: "buyer@acme.test", isPrimary: true }],
          },
          product: "posthog",
          businessGoal: "Evaluate PostHog for activation analytics.",
          successCriteria: ["Track activation"],
          // No appContext -> platform defaults to ["unknown"]; no events captured.
          posthogContext: { projectId: "project-1", useExistingProject: true },
          analyticsScope: { events: [] },
          assumptions: [],
          openQuestions: [],
        };
      },
    };
    const email = new InMemoryEmailTool();
    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval: new InMemoryApprovalTool({ baseApprovalUrl: "https://approve.test" }),
      audit: new InMemoryAuditTool(),
      idGenerator: () => "poc_summary_1",
    });

    const result = await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants PostHog.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "req-1" },
    });

    expect(result.status).toBe("confirmation_sent");

    const plan = await store.getPlan("poc_summary_1", 1);
    expect(plan?.customerSummaryMarkdown).toContain("PostHog PoC for Acme");
    expect(plan?.openQuestions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("product events"),
        expect.stringContaining("platform"),
      ]),
    );
    expect(email.sentEmails.at(-1)?.markdownBody).toContain("PostHog PoC for Acme");
  });
});
