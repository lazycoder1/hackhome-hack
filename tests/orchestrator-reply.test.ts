import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import type { ApprovalTool, AuditTool, EmailTool } from "../src/tools/types.js";

describe("Orchestrator reply handling", () => {
  it("stores approval waitpoint and confirmation thread during intake", async () => {
    const { orchestrator, store } = systemWithReplyClassifier({ intent: "approved" });

    await orchestrator.submitRequirementsBlob(requirementsBlob());

    expect(await store.getPoc("poc_123")).toMatchObject({
      approvalTokenId: "token-poc_123-v1",
      approvalUrl: "https://approve.test/poc_123/v1",
      confirmationThreadId: "thread-1",
    });
  });

  it("classifies an approval email and completes the stored approval waitpoint", async () => {
    const completed: unknown[] = [];
    const { orchestrator, approval, store } = systemWithReplyClassifier({
      intent: "approved",
      completed,
    });
    await orchestrator.submitRequirementsBlob(requirementsBlob());

    const result = await orchestrator.processCustomerReply({
      pocId: "poc_123",
      message: {
        id: "inbound-1",
        threadId: "thread-1",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: Please confirm your PostHog PoC plan",
        textBody: "Approved, please proceed.",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      intent: "approved",
      completedApproval: true,
      requiresSetup: true,
      changes: [],
    });
    expect(completed).toEqual([
      {
        tokenId: "token-poc_123-v1",
        decision: "approved",
        decidedBy: "buyer@acme.test",
        notes: "Approved by customer reply",
        changes: [],
      },
    ]);
    expect((await store.getPoc("poc_123"))?.status).toBe("approved");
    expect(approval).toBeDefined();
  });

  it("does not approve a historical no-plan PoC from an approval reply", async () => {
    const completed: unknown[] = [];
    const { orchestrator, store } = systemWithReplyClassifier({
      intent: "approved",
      completed,
    });
    await orchestrator.submitRequirementsBlob(requirementsBlob());
    await store.updatePoc("poc_123", {
      status: "needs_clarification",
      updatedAt: "2026-06-04T00:00:00.000Z",
      activePlanVersion: undefined,
    });

    const result = await orchestrator.processCustomerReply({
      pocId: "poc_123",
      message: {
        id: "inbound-1",
        threadId: "thread-1",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: clarification",
        textBody: "Approved, please proceed.",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      intent: "approved",
      completedApproval: false,
      requiresSetup: false,
      changes: [],
    });
    expect(completed).toEqual([]);
    expect((await store.getPoc("poc_123"))?.status).toBe("needs_clarification");
  });

  it("creates a revised plan and resends confirmation when the customer requests changes", async () => {
    const completed: unknown[] = [];
    const sentEmails: unknown[] = [];
    const createdWaitpoints: unknown[] = [];
    const { orchestrator, store } = systemWithReplyClassifier({
      intent: "needs_changes",
      extractedChanges: ["Use EU region"],
      completed,
      sentEmails,
      createdWaitpoints,
    });
    await orchestrator.submitRequirementsBlob(requirementsBlob());

    const result = await orchestrator.processCustomerReply({
      pocId: "poc_123",
      message: {
        id: "inbound-1",
        threadId: "thread-1",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: Please confirm your PostHog PoC plan",
        textBody: "Looks good, but use EU region.",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      intent: "needs_changes",
      completedApproval: false,
      requiresSetup: false,
      changes: ["Use EU region"],
    });
    expect(completed).toEqual([]);
    expect(await store.getPoc("poc_123")).toMatchObject({
      status: "confirmation_sent",
      activePlanVersion: 2,
      approvalTokenId: "token-poc_123-v2",
      approvalUrl: "https://approve.test/poc_123/v2",
      confirmationThreadId: "thread-1",
    });
    expect(await store.getPlan("poc_123", 1)).toMatchObject({
      status: "superseded",
    });
    expect(await store.getPlan("poc_123", 2)).toMatchObject({
      version: 2,
      status: "sent_for_confirmation",
      posthogTarget: {
        region: "EU",
      },
      assumptions: expect.arrayContaining(["Customer requested change: Use EU region"]),
    });
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1]).toMatchObject({
      threadId: "thread-1",
      subject: "Please confirm your updated PostHog PoC plan",
    });
    expect(createdWaitpoints).toEqual([
      expect.objectContaining({ idempotencyKey: "poc:poc_123:approval:v1" }),
      expect.objectContaining({ idempotencyKey: "poc:poc_123:approval:v2" }),
    ]);
  });

  it("uses a DeepSeek suggested response for question replies on the same email thread", async () => {
    const sentEmails: unknown[] = [];
    const { orchestrator } = systemWithReplyClassifier({
      intent: "question",
      suggestedResponse: "Yes, we can keep the pilot running for a month and review weekly.",
      sentEmails,
    });
    await orchestrator.submitRequirementsBlob(requirementsBlob());

    const result = await orchestrator.processCustomerReply({
      pocId: "poc_123",
      message: {
        id: "inbound-1",
        threadId: "thread-1",
        from: "buyer@acme.test",
        to: ["poc@example.test"],
        subject: "Re: Please confirm your PostHog PoC plan",
        textBody: "Can this pilot run for a month?",
        receivedAt: "2026-06-04T00:05:00.000Z",
      },
    });

    expect(result).toEqual({
      intent: "question",
      completedApproval: false,
      requiresSetup: false,
      changes: [],
    });
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1]).toMatchObject({
      to: ["buyer@acme.test"],
      subject: "Re: Please confirm your PostHog PoC plan",
      markdownBody: "Yes, we can keep the pilot running for a month and review weekly.",
      threadId: "thread-1",
    });
  });
});

function systemWithReplyClassifier(options: {
  intent: "approved" | "needs_changes" | "question" | "rejected" | "unclear";
  extractedChanges?: string[];
  suggestedResponse?: string;
  completed?: unknown[];
  sentEmails?: unknown[];
  createdWaitpoints?: unknown[];
}) {
  let callCount = 0;
  const store = new InMemoryPocStore();
  const llm: LlmJsonClient = {
    async completeJson() {
      callCount += 1;
      if (callCount === 1) {
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
          posthogContext: {
            projectId: "project-1",
            projectName: "Acme PoC",
            useExistingProject: true,
          },
          analyticsScope: {
            events: [
              { name: "signup_completed", description: "A user completes signup", required: true },
            ],
          },
          assumptions: [],
          openQuestions: [],
        };
      }

      return {
        intent: options.intent,
        confidence: 0.96,
        extractedChanges: options.extractedChanges ?? [],
        requiresHumanReview: false,
        suggestedResponse: options.suggestedResponse,
      };
    },
  };
  const email: EmailTool = {
    async sendEmail(input) {
      options.sentEmails?.push(input);
      return {
        emailId: `email-${options.sentEmails?.length ?? 1}`,
        threadId: input.threadId ?? "thread-1",
        sentAt: "2026-06-04T00:00:00.000Z",
      };
    },
  };
  const approval: ApprovalTool = {
    async createApprovalWaitpoint(input) {
      options.createdWaitpoints?.push(input);
      const version = /:v(\d+)$/.exec(input.idempotencyKey)?.[1] ?? "1";
      return {
        tokenId: `token-${input.pocId}-v${version}`,
        publicApprovalUrl: `https://approve.test/${input.pocId}/v${version}`,
        expiresAt: "2026-06-11T00:00:00.000Z",
      };
    },
    async completeApprovalWaitpoint(input) {
      options.completed?.push(input);
      return { success: true };
    },
  };
  const audit: AuditTool = {
    async writeAuditLog() {
      return { auditEventId: "audit-1" };
    },
  };

  return {
    store,
    approval,
    orchestrator: new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock: () => new Date("2026-06-04T00:00:00.000Z"),
      idGenerator: () => "poc_123",
    }),
  };
}

function requirementsBlob() {
  return {
    source: "api" as const,
    text: "Acme wants to evaluate PostHog for signup activation analytics.",
    participants: [{ email: "buyer@acme.test", company: "Acme" }],
    sourceMetadata: { sourceId: "requirements-1" },
  };
}
