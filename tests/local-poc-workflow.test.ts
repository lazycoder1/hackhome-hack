import { HandoffGenerator } from "../src/handoff/handoff-generator.js";
import { Orchestrator } from "../src/orchestrator/orchestrator.js";
import { PostHogPocSetupAgent } from "../src/posthog/posthog-poc-setup-agent.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import {
  InMemoryApprovalTool,
  InMemoryAuditTool,
  InMemoryEmailTool,
  InMemoryPostHogGateway,
  InMemorySecretsTool,
  ResourceValidationTool,
} from "../src/tools/in-memory-tools.js";
import { LocalPocWorkflow } from "../src/workflow/local-poc-workflow.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import type { PocPlan, SetupResult } from "../src/contracts.js";

describe("LocalPocWorkflow", () => {
  it("approves a confirmed plan, runs PostHog setup, and sends handoff email", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const approval = new InMemoryApprovalTool({ baseApprovalUrl: "https://approve.test", clock });
    const audit = new InMemoryAuditTool({ clock });
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
          assumptions: [],
          openQuestions: [],
        };
      },
    };

    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock,
      idGenerator: () => "poc_123",
    });
    const setupAgent = new PostHogPocSetupAgent({
      posthog: new InMemoryPostHogGateway(),
      secrets: new InMemorySecretsTool({ baseSecretUrl: "https://secrets.test", clock }),
      validation: new ResourceValidationTool({ clock }),
      audit,
      clock,
    });
    const workflow = new LocalPocWorkflow({
      store,
      setupAgent,
      handoffGenerator: new HandoffGenerator(),
      email,
      audit,
      clock,
    });

    await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants to evaluate PostHog for signup activation analytics.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "requirements-1" },
    });

    const result = await workflow.approveAndRunSetup({
      pocId: "poc_123",
      approvedBy: "buyer@acme.test",
      approvalSource: "approval_link",
    });

    expect(result.setupResult.status).toBe("succeeded");
    expect(result.handoffEmailId).toBe("email-2");
    expect(email.sentEmails[1]?.subject).toBe(
      "Your PostHog PoC is ready: testing plan and access details",
    );
    expect(email.sentEmails[1]?.markdownBody).toContain(
      "https://posthog.example.test/project/project-1",
    );
    expect((await store.getPoc("poc_123"))?.status).toBe("handoff_sent");
    expect((await store.getSetupResult("poc_123"))?.validationReport?.status).toBe("pass");
  });

  it("runs setup and sends handoff when an inbound customer email approves the plan", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const approval = new InMemoryApprovalTool({ baseApprovalUrl: "https://approve.test", clock });
    const audit = new InMemoryAuditTool({ clock });
    const llm: LlmJsonClient = {
      async completeJson(input) {
        if (input.model === "deepseek-v4-flash") {
          return {
            intent: "approved",
            confidence: 0.98,
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
    const orchestrator = new Orchestrator({
      store,
      llm,
      email,
      approval,
      audit,
      clock,
      idGenerator: () => "poc_123",
    });
    const workflow = new LocalPocWorkflow({
      store,
      setupAgent: new PostHogPocSetupAgent({
        posthog: new InMemoryPostHogGateway(),
        secrets: new InMemorySecretsTool({ baseSecretUrl: "https://secrets.test", clock }),
        validation: new ResourceValidationTool({ clock }),
        audit,
        clock,
      }),
      handoffGenerator: new HandoffGenerator(),
      email,
      audit,
      replyProcessor: orchestrator,
      clock,
    });

    await orchestrator.submitRequirementsBlob({
      source: "api",
      text: "Acme wants to evaluate PostHog for signup activation analytics.",
      participants: [{ email: "buyer@acme.test", company: "Acme" }],
      sourceMetadata: { sourceId: "requirements-1" },
    });

    const replyResult = await workflow.processEmailReply({
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

    expect(replyResult).toEqual({
      intent: "approved",
      completedApproval: true,
      requiresSetup: true,
      changes: [],
    });
    expect((await store.getPoc("poc_123"))?.status).toBe("handoff_sent");
    expect((await store.getSetupResult("poc_123"))?.status).toBe("succeeded");
    expect(email.sentEmails).toHaveLength(2);
    expect(email.sentEmails[1]?.subject).toBe(
      "Your PostHog PoC is ready: testing plan and access details",
    );
  });

  it("persists failed setup results and moves the PoC to human review", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const audit = new InMemoryAuditTool({ clock });
    const setupAgent = {
      async setup(plan: PocPlan): Promise<SetupResult> {
        return {
          pocId: plan.pocId,
          status: "failed",
          posthog: {
            projectId: "project-1",
            projectName: "Acme PoC",
            projectUrl: "",
            hostUrl: "",
          },
          createdResources: [],
          updatedResources: [],
          skippedResources: [],
          credentialRefs: [],
          sdkInstructions: [],
          knownGaps: ["PostHog setup failed: MCP tool project-get failed"],
          validationReport: {
            pocId: plan.pocId,
            status: "fail",
            checkedAt: "2026-06-04T00:00:00.000Z",
            checks: [
              {
                id: "setup-exception",
                name: "PostHog setup failed",
                status: "fail",
              },
            ],
            summary: "PostHog setup failed before validation could complete.",
            knownGaps: ["PostHog setup failed: MCP tool project-get failed"],
          },
          auditEventIds: [],
        };
      },
    } as PostHogPocSetupAgent;
    const workflow = new LocalPocWorkflow({
      store,
      setupAgent,
      handoffGenerator: new HandoffGenerator(),
      email,
      audit,
      clock,
    });

    await store.createPoc({
      pocId: "poc_123",
      status: "confirmation_sent",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      activePlanVersion: 1,
      sourceText: "Acme wants PostHog.",
    });
    await store.savePlan({
      pocId: "poc_123",
      version: 1,
      status: "sent_for_confirmation",
      product: "posthog",
      customer: {
        companyName: "Acme",
        companySlug: "acme",
        contacts: [{ email: "buyer@acme.test", isPrimary: true }],
      },
      objective: "Evaluate signup activation analytics.",
      successCriteria: ["Track signup funnel"],
      assumptions: [],
      openQuestions: [],
      posthogTarget: {
        projectId: "project-1",
        projectName: "Acme PoC",
        projectStrategy: "existing_project",
      },
      setup: {
        projectSettings: {},
        events: [],
        actions: [],
        dashboards: [],
        cohorts: [],
        featureFlags: [],
        experiments: [],
        surveys: [],
        alerts: [],
      },
      validationPlan: {
        syntheticEvents: [],
        requiredChecks: ["project"],
        acceptanceThreshold: "all_pass",
      },
      handoffPlan: {
        recipients: ["buyer@acme.test"],
        includeSdkInstructions: true,
        includeTestingPlan: true,
        includeCredentialLinks: true,
      },
      approval: {},
    });

    await expect(
      workflow.approveAndRunSetup({
        pocId: "poc_123",
        approvedBy: "buyer@acme.test",
        approvalSource: "approval_link",
      }),
    ).rejects.toThrow("PostHog setup failed for PoC poc_123");

    expect((await store.getPoc("poc_123"))?.status).toBe("needs_human_review");
    expect((await store.getSetupResult("poc_123"))?.validationReport?.checks[0]).toMatchObject({
      id: "setup-exception",
      status: "fail",
    });
  });

  it("emails the buyer when DeepSeek needs business clarification before setup can finish", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const audit = new InMemoryAuditTool({ clock });
    const setupAgent = {
      async setup(plan: PocPlan): Promise<SetupResult> {
        return {
          pocId: plan.pocId,
          status: "failed",
          posthog: {
            projectId: "project-1",
            projectName: "Acme PoC",
            projectUrl: "",
            hostUrl: "",
          },
          createdResources: [],
          updatedResources: [],
          skippedResources: [],
          credentialRefs: [],
          sdkInstructions: [],
          knownGaps: [
            "DeepSeek requested business clarification before dashboard creation: What should count as an engaged session?; Should demo intent include opened forms or submitted forms?",
          ],
          validationReport: {
            pocId: plan.pocId,
            status: "fail",
            checkedAt: "2026-06-04T00:00:00.000Z",
            checks: [],
            summary: "Needs business clarification.",
            knownGaps: [],
          },
          auditEventIds: [],
        };
      },
    };
    const workflow = new LocalPocWorkflow({
      store,
      setupAgent,
      handoffGenerator: new HandoffGenerator(),
      email,
      audit,
      clock,
    });

    await store.createPoc({
      pocId: "poc_123",
      status: "confirmation_sent",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      activePlanVersion: 1,
      confirmationThreadId: "thread-1",
      sourceText: "Acme wants PostHog.",
    });
    await store.savePlan(approvedPlan());

    await expect(
      workflow.retryPocStage({
        pocId: "poc_123",
        stage: "setup",
        requestedBy: "operator@example.test",
      }),
    ).rejects.toThrow("PostHog setup needs customer clarification");

    expect((await store.getPoc("poc_123"))?.status).toBe("needs_clarification");
    expect(email.sentEmails).toHaveLength(1);
    expect(email.sentEmails[0]).toMatchObject({
      to: ["buyer@acme.test"],
      threadId: "thread-1",
      subject: "Quick clarification on your Acme PostHog PoC",
    });
    expect(email.sentEmails[0]?.markdownBody).toContain(
      "What should count as an engaged session?",
    );
  });

  it("retries the handoff stage from a persisted approved plan and setup result", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const audit = new InMemoryAuditTool({ clock });
    const workflow = new LocalPocWorkflow({
      store,
      setupAgent: {
        async setup() {
          throw new Error("setup should not run when retrying handoff");
        },
      } as unknown as PostHogPocSetupAgent,
      handoffGenerator: new HandoffGenerator(),
      email,
      audit,
      clock,
    });

    await store.createPoc({
      pocId: "poc_123",
      status: "handoff_ready",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      activePlanVersion: 1,
      sourceText: "Acme wants PostHog.",
    });
    await store.savePlan({
      pocId: "poc_123",
      version: 1,
      status: "approved",
      product: "posthog",
      customer: {
        companyName: "Acme",
        companySlug: "acme",
        contacts: [{ email: "buyer@acme.test", isPrimary: true }],
      },
      objective: "Evaluate signup activation analytics.",
      successCriteria: ["Track signup funnel"],
      assumptions: [],
      openQuestions: [],
      posthogTarget: {
        projectId: "project-1",
        projectName: "Acme PoC",
        projectStrategy: "existing_project",
      },
      setup: {
        projectSettings: {},
        events: [],
        actions: [],
        dashboards: [],
        cohorts: [],
        featureFlags: [],
        experiments: [],
        surveys: [],
        alerts: [],
      },
      validationPlan: {
        syntheticEvents: [],
        requiredChecks: ["project"],
        acceptanceThreshold: "all_pass",
      },
      handoffPlan: {
        recipients: ["buyer@acme.test"],
        includeSdkInstructions: true,
        includeTestingPlan: true,
        includeCredentialLinks: true,
      },
      approval: {
        approvedBy: "buyer@acme.test",
        approvedAt: "2026-06-04T00:00:00.000Z",
        approvalSource: "email_reply",
      },
    });
    await store.saveSetupResult({
      pocId: "poc_123",
      status: "succeeded_with_warnings",
      posthog: {
        projectId: "project-1",
        projectName: "Acme PoC",
        projectUrl: "https://posthog.example.test/project/project-1",
        hostUrl: "https://posthog.example.test",
      },
      createdResources: [],
      updatedResources: [],
      skippedResources: [],
      credentialRefs: [],
      sdkInstructions: [],
      knownGaps: ["Dashboard has no validated adoption query yet."],
      auditEventIds: [],
    });

    const result = await workflow.retryPocStage({
      pocId: "poc_123",
      stage: "handoff",
      requestedBy: "operator@example.test",
    });

    expect(result).toMatchObject({
      pocId: "poc_123",
      stage: "handoff",
      status: "handoff_sent_with_gaps",
      setupStatus: "succeeded_with_warnings",
      handoffEmailId: "email-1",
      handoffThreadId: "thread-1",
    });
    expect(email.sentEmails).toHaveLength(1);
    expect(email.sentEmails[0]?.subject).toBe(
      "Your PostHog PoC is ready: testing plan and access details",
    );
    expect((await store.getPoc("poc_123"))?.status).toBe("handoff_sent_with_gaps");
  });
});

function clock(): Date {
  return new Date("2026-06-04T00:00:00.000Z");
}

function approvedPlan(): PocPlan {
  return {
    pocId: "poc_123",
    version: 1,
    status: "approved",
    product: "posthog",
    customer: {
      companyName: "Acme",
      companySlug: "acme",
      contacts: [{ email: "buyer@acme.test", isPrimary: true }],
    },
    objective: "Evaluate signup activation analytics.",
    successCriteria: ["Track signup funnel"],
    assumptions: [],
    openQuestions: [],
    posthogTarget: {
      projectId: "project-1",
      projectName: "Acme PoC",
      projectStrategy: "existing_project",
    },
    setup: {
      projectSettings: {},
      events: [],
      actions: [],
      dashboards: [],
      cohorts: [],
      featureFlags: [],
      experiments: [],
      surveys: [],
      alerts: [],
    },
    validationPlan: {
      syntheticEvents: [],
      requiredChecks: ["project"],
      acceptanceThreshold: "all_pass",
    },
    handoffPlan: {
      recipients: ["buyer@acme.test"],
      includeSdkInstructions: true,
      includeTestingPlan: true,
      includeCredentialLinks: true,
    },
    approval: {
      approvedBy: "buyer@acme.test",
      approvedAt: "2026-06-04T00:00:00.000Z",
      approvalSource: "email_reply",
    },
  };
}
