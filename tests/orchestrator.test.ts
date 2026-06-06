import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import type { EmailTool, ApprovalTool, AuditTool } from "../src/tools/types.js";

describe("Orchestrator", () => {
  it("turns a requirements blob into a confirmation email and approval waitpoint", async () => {
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
          businessGoal: "Evaluate signup activation analytics.",
          successCriteria: ["Track signup funnel", "See activation dashboard"],
          appContext: {
            platform: ["web"],
          },
          posthogContext: {
            projectId: "project-1",
            projectName: "Acme PoC",
            useExistingProject: true,
          },
          analyticsScope: {
            events: [
              {
                name: "signup_completed",
                description: "A user completes signup",
                required: true,
              },
            ],
          },
          assumptions: ["Use a pre-created PostHog project"],
          openQuestions: [],
        };
      },
    };
    const sentEmails: unknown[] = [];
    const email: EmailTool = {
      async sendEmail(input) {
        sentEmails.push(input);
        return {
          emailId: "email-1",
          threadId: "thread-1",
          sentAt: "2026-06-04T00:00:00.000Z",
        };
      },
    };
    const approval: ApprovalTool = {
      async createApprovalWaitpoint(input) {
        return {
          tokenId: `token-${input.pocId}`,
          publicApprovalUrl: `https://approve.test/${input.pocId}`,
          expiresAt: "2026-06-11T00:00:00.000Z",
        };
      },
      async completeApprovalWaitpoint() {
        return { success: true };
      },
    };
    const auditEvents: unknown[] = [];
    const audit: AuditTool = {
      async writeAuditLog(input) {
        auditEvents.push(input);
        return { auditEventId: `audit-${auditEvents.length}` };
      },
    };

    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      idGenerator: () => "poc_123",
    });

    const result = await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants to evaluate PostHog for signup activation analytics.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "call-summary-1" },
    });

    expect(result).toMatchObject({
      pocId: "poc_123",
      status: "confirmation_sent",
      approvalUrl: "https://approve.test/poc_123",
      approvalTokenId: "token-poc_123",
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      to: ["buyer@acme.test"],
      subject: "Please confirm your PostHog PoC plan",
    });
    expect((await store.getPoc("poc_123"))?.status).toBe("confirmation_sent");
    expect((await store.getPlan("poc_123", 1))?.product).toBe("posthog");
    expect(auditEvents).toHaveLength(3);
  });

  it("merges structured business clarifications into the generated plan", async () => {
    const store = new InMemoryPocStore();
    const llm: LlmJsonClient = {
      async completeJson() {
        return {
          customer: {
            companyName: "Acme",
            contacts: [{ email: "buyer@acme.test", isPrimary: true }],
          },
          product: "posthog",
          businessGoal: "Evaluate analytics.",
          successCriteria: [],
          appContext: { platform: ["web"] },
          posthogContext: { projectId: "project-1", useExistingProject: true },
          analyticsScope: { events: [] },
          assumptions: ["LLM assumption"],
          openQuestions: ["LLM question?"],
        };
      },
    };
    const email: EmailTool = {
      async sendEmail() {
        return {
          emailId: "email-1",
          threadId: "thread-1",
          sentAt: "2026-06-04T00:00:00.000Z",
        };
      },
    };
    const approval: ApprovalTool = {
      async createApprovalWaitpoint(input) {
        return {
          tokenId: `token-${input.pocId}`,
          publicApprovalUrl: `https://approve.test/${input.pocId}`,
          expiresAt: "2026-06-11T00:00:00.000Z",
        };
      },
      async completeApprovalWaitpoint() {
        return { success: true };
      },
    };
    const audit: AuditTool = {
      async writeAuditLog() {
        return { auditEventId: "audit-1" };
      },
    };
    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      idGenerator: () => "poc_123",
    });

    await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants a PostHog dashboard.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      structuredHints: {
        successCriteria: ["Hint success criterion"],
        assumptions: ["Operator clarification"],
        openQuestions: ["Hint question?"],
        analyticsScope: {
          events: [
            {
              name: "widget_email_submitted",
              description: "Email submitted in the widget.",
              required: false,
            },
          ],
        },
      },
      sourceMetadata: { sourceId: "call-summary-1" },
    });

    const plan = await store.getPlan("poc_123", 1);
    expect(plan?.successCriteria).toEqual(["Hint success criterion"]);
    expect(plan?.assumptions).toEqual(["Operator clarification", "LLM assumption"]);
    expect(plan?.openQuestions).toEqual(
      expect.arrayContaining(["Hint question?", "LLM question?"]),
    );
    expect(plan?.setup.events.map((event) => event.name)).toEqual(["widget_email_submitted"]);
  });

  it("requests clarification instead of approval when the PostHog project target is missing", async () => {
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
          businessGoal: "Evaluate signup activation analytics.",
          successCriteria: ["Track signup funnel"],
          appContext: { platform: ["web"] },
          analyticsScope: {
            events: [
              {
                name: "signup_completed",
                description: "A user completes signup",
                required: true,
              },
            ],
          },
          assumptions: [],
          openQuestions: [],
        };
      },
    };
    const sentEmails: unknown[] = [];
    const email: EmailTool = {
      async sendEmail(input) {
        sentEmails.push(input);
        return {
          emailId: "email-clarify-1",
          threadId: "thread-clarify-1",
          sentAt: "2026-06-04T00:00:00.000Z",
        };
      },
    };
    const createdApprovals: unknown[] = [];
    const approval: ApprovalTool = {
      async createApprovalWaitpoint(input) {
        createdApprovals.push(input);
        return {
          tokenId: "token-poc_123",
          publicApprovalUrl: "https://approve.test/poc_123",
          expiresAt: "2026-06-11T00:00:00.000Z",
        };
      },
      async completeApprovalWaitpoint() {
        return { success: true };
      },
    };
    const audit: AuditTool = {
      async writeAuditLog() {
        return { auditEventId: "audit-1" };
      },
    };
    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      idGenerator: () => "poc_123",
    });

    const result = await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants to evaluate PostHog for signup activation analytics.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "call-summary-1" },
    });

    expect(result).toMatchObject({
      pocId: "poc_123",
      status: "needs_clarification",
      missingDetails: [
        expect.objectContaining({
          key: "posthog.projectId",
          severity: "blocking",
        }),
      ],
    });
    expect(createdApprovals).toEqual([]);
    expect(sentEmails).toEqual([
      expect.objectContaining({
        to: ["buyer@acme.test"],
        subject: "Clarification needed for your PostHog PoC",
      }),
    ]);
    expect(await store.getPoc("poc_123")).toMatchObject({
      status: "needs_clarification",
      confirmationEmailId: "email-clarify-1",
      confirmationThreadId: "thread-clarify-1",
    });
    expect(await store.getPlan("poc_123", 1)).toBeUndefined();
  });
});
