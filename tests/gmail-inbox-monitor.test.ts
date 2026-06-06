import { GmailInboxMonitor } from "../src/workflow/gmail-inbox-monitor.js";
import type { GmailMcpGateway } from "../src/tools/gmail-mcp-email-tool.js";

describe("GmailInboxMonitor", () => {
  it("searches Gmail threads, fetches full messages, and submits customer replies", async () => {
    const processed: unknown[] = [];
    const labels: unknown[] = [];
    const gateway: GmailMcpGateway = {
      async createDraft() {
        return { id: "draft_123" };
      },
      async searchThreads(input) {
        expect(input).toEqual({
          query: "in:inbox newer_than:7d -in:draft",
          pageSize: 5,
        });
        return {
          threads: [{ id: "thread_123", messages: [] }],
        };
      },
      async getThread(input) {
        expect(input).toEqual({
          threadId: "thread_123",
          messageFormat: "FULL_CONTENT",
        });
        return {
          id: "thread_123",
          messages: [
            {
              id: "msg_123",
              threadId: "thread_123",
              sender: "buyer@acme.test",
              toRecipients: ["poc_123@inbound.example.test"],
              subject: "Re: PostHog PoC approval",
              plaintextBody: "Approved",
              date: "2026-06-04T00:05:00Z",
            },
          ],
        };
      },
      async labelThread(input) {
        labels.push(input);
        return { success: true };
      },
    };
    const monitor = new GmailInboxMonitor({
      gateway,
      workflow: {
        async processEmailReply(input) {
          processed.push(input);
          return {
            intent: "approved",
            completedApproval: true,
            requiresSetup: true,
            changes: [],
          };
        },
      },
    });

    const result = await monitor.monitor({
      query: "in:inbox newer_than:7d -in:draft",
      maxThreads: 5,
      processedLabelIds: ["Label_123"],
    });

    expect(result).toEqual({
      searchedThreads: 1,
      processedMessages: 1,
      skippedMessages: 0,
      labeledThreads: 1,
    });
    expect(processed).toEqual([
      {
        pocId: "poc_123",
        message: {
          id: "msg_123",
          threadId: "thread_123",
          from: "buyer@acme.test",
          to: ["poc_123@inbound.example.test"],
          subject: "Re: PostHog PoC approval",
          textBody: "Approved",
          receivedAt: "2026-06-04T00:05:00.000Z",
        },
      },
    ]);
    expect(labels).toEqual([
      {
        threadId: "thread_123",
        labelIds: ["Label_123"],
      },
    ]);
  });

  it("skips messages that cannot be mapped to a PoC", async () => {
    const monitor = new GmailInboxMonitor({
      gateway: {
        async createDraft() {
          return { id: "draft_123" };
        },
        async searchThreads() {
          return {
            threads: [{ id: "thread_123", messages: [] }],
          };
        },
        async getThread() {
          return {
            id: "thread_123",
            messages: [
              {
                id: "msg_123",
                threadId: "thread_123",
                sender: "buyer@acme.test",
                toRecipients: ["hello@example.test"],
                subject: "No matching PoC",
                plaintextBody: "Hello",
                date: "2026-06-04T00:05:00Z",
              },
            ],
          };
        },
      },
      workflow: {
        async processEmailReply() {
          throw new Error("should not process unmapped messages");
        },
      },
    });

    await expect(monitor.monitor({})).resolves.toMatchObject({
      searchedThreads: 1,
      processedMessages: 0,
      skippedMessages: 1,
    });
  });

  it("maps a normal Gmail reply to the PoC by confirmation thread and customer email", async () => {
    const processed: unknown[] = [];
    const monitor = new GmailInboxMonitor({
      gateway: {
        async createDraft() {
          return { id: "draft_123" };
        },
        async searchThreads() {
          return {
            threads: [{ id: "thread_confirm_vgs", messages: [] }],
          };
        },
        async getThread() {
          return {
            id: "thread_confirm_vgs",
            messages: [
              {
                id: "msg_vgs_approval",
                threadId: "thread_confirm_vgs",
                from: "VGS <vgs@getconvinced.ai>",
                toRecipients: ["ggs@getconvinced.ai"],
                subject: "Re: Please confirm your PostHog PoC plan",
                plaintextBody: "Approved, please proceed with the POC.",
                date: "2026-06-05T12:00:00Z",
              },
            ],
          };
        },
      },
      workflow: {
        async processEmailReply(input) {
          processed.push(input);
          return {
            intent: "approved",
            completedApproval: true,
            requiresSetup: true,
            changes: [],
          };
        },
      },
      pocStatus: {
        async list() {
          return {
            pocs: [
              {
                pocId: "poc_convinced_widget",
                status: "confirmation_sent",
                createdAt: "2026-06-05T11:55:00Z",
                updatedAt: "2026-06-05T11:55:00Z",
                confirmationThreadId: "thread_confirm_vgs",
                hasRequirements: true,
                hasActivePlan: true,
                hasSetupResult: false,
              },
            ],
          };
        },
        async detail() {
          return {
            pocId: "poc_convinced_widget",
            status: "confirmation_sent",
            createdAt: "2026-06-05T11:55:00Z",
            updatedAt: "2026-06-05T11:55:00Z",
            hasRequirements: true,
            hasActivePlan: true,
            hasSetupResult: false,
            requirements: {
              pocId: "poc_convinced_widget",
              product: "posthog",
              customer: {
                companyName: "Convinced",
                companySlug: "convinced",
                contacts: [{ email: "vgs@getconvinced.ai", isPrimary: true }],
              },
              businessGoal: "Measure chat widget usage by landing page.",
              successCriteria: ["Acceptance reply from VGS approves the PoC."],
              appContext: { platform: ["web"] },
              analyticsScope: { events: [] },
              assumptions: [],
              openQuestions: [],
              source: {
                sourceKind: "api",
                receivedAt: "2026-06-05T11:55:00Z",
              },
            },
          };
        },
      },
    });

    await expect(monitor.monitor({})).resolves.toMatchObject({
      searchedThreads: 1,
      processedMessages: 1,
      skippedMessages: 0,
    });
    expect(processed).toEqual([
      {
        pocId: "poc_convinced_widget",
        message: {
          id: "msg_vgs_approval",
          threadId: "thread_confirm_vgs",
          from: "vgs@getconvinced.ai",
          to: ["ggs@getconvinced.ai"],
          subject: "Re: Please confirm your PostHog PoC plan",
          textBody: "Approved, please proceed with the POC.",
          receivedAt: "2026-06-05T12:00:00.000Z",
        },
      },
    ]);
  });

  it("processes customer feedback replies after the PoC has been approved", async () => {
    const processed: unknown[] = [];
    const monitor = new GmailInboxMonitor({
      gateway: {
        async createDraft() {
          return { id: "draft_123" };
        },
        async searchThreads() {
          return {
            threads: [{ id: "thread_confirm_vgs", messages: [] }],
          };
        },
        async getThread() {
          return {
            id: "thread_confirm_vgs",
            messages: [
              {
                id: "msg_vgs_feedback",
                threadId: "thread_confirm_vgs",
                from: "VGS <vgs@getconvinced.ai>",
                toRecipients: ["ggs@getconvinced.ai"],
                subject: "Re: Please confirm your PostHog PoC plan",
                plaintextBody:
                  "I just looked at dashboard. Too many numbers, not enough graphs. Hard to understand.",
                date: "2026-06-05T12:00:00Z",
              },
            ],
          };
        },
      },
      workflow: {
        async processEmailReply(input) {
          processed.push(input);
          return {
            intent: "needs_changes",
            completedApproval: false,
            requiresSetup: false,
            changes: ["Please make the dashboard more graph-heavy."],
          };
        },
      },
      pocStatus: {
        async list() {
          return {
            pocs: [
              {
                pocId: "poc_convinced_widget",
                status: "approved",
                createdAt: "2026-06-05T11:55:00Z",
                updatedAt: "2026-06-05T11:55:00Z",
                confirmationThreadId: "thread_confirm_vgs",
                hasRequirements: true,
                hasActivePlan: true,
                hasSetupResult: true,
              },
            ],
          };
        },
        async detail() {
          return {
            pocId: "poc_convinced_widget",
            status: "approved",
            createdAt: "2026-06-05T11:55:00Z",
            updatedAt: "2026-06-05T11:55:00Z",
            hasRequirements: true,
            hasActivePlan: true,
            hasSetupResult: true,
            requirements: {
              pocId: "poc_convinced_widget",
              product: "posthog",
              customer: {
                companyName: "Convinced",
                companySlug: "convinced",
                contacts: [{ email: "vgs@getconvinced.ai", isPrimary: true }],
              },
              businessGoal: "Measure chat widget usage by landing page.",
              successCriteria: ["Acceptance reply from VGS approves the PoC."],
              appContext: { platform: ["web"] },
              analyticsScope: { events: [] },
              assumptions: [],
              openQuestions: [],
              source: {
                sourceKind: "api",
                receivedAt: "2026-06-05T11:55:00Z",
              },
            },
          };
        },
      },
    });

    await expect(monitor.monitor({})).resolves.toMatchObject({
      searchedThreads: 1,
      processedMessages: 1,
      skippedMessages: 0,
    });
    expect(processed).toHaveLength(1);
  });

  it("skips confirmation-thread replies when the PoC has no active plan", async () => {
    const monitor = new GmailInboxMonitor({
      gateway: {
        async createDraft() {
          return { id: "draft_123" };
        },
        async searchThreads() {
          return {
            threads: [{ id: "thread_missing_plan", messages: [] }],
          };
        },
        async getThread() {
          return {
            id: "thread_missing_plan",
            messages: [
              {
                id: "msg_approval_no_plan",
                threadId: "thread_missing_plan",
                from: "Buyer <buyer@acme.test>",
                toRecipients: ["poc@example.test"],
                subject: "Re: clarification",
                plaintextBody: "Approved, please proceed.",
                date: "2026-06-05T12:00:00Z",
              },
            ],
          };
        },
      },
      workflow: {
        async processEmailReply() {
          throw new Error("should not process replies for no-plan PoCs");
        },
      },
      pocStatus: {
        async list() {
          return {
            pocs: [
              {
                pocId: "poc_missing_plan",
                status: "needs_clarification",
                createdAt: "2026-06-05T11:55:00Z",
                updatedAt: "2026-06-05T11:55:00Z",
                confirmationThreadId: "thread_missing_plan",
                hasRequirements: true,
                hasActivePlan: false,
                hasSetupResult: false,
              },
            ],
          };
        },
        async detail() {
          return {
            pocId: "poc_missing_plan",
            status: "needs_clarification",
            createdAt: "2026-06-05T11:55:00Z",
            updatedAt: "2026-06-05T11:55:00Z",
            hasRequirements: true,
            hasActivePlan: false,
            hasSetupResult: false,
            requirements: {
              pocId: "poc_missing_plan",
              product: "posthog",
              customer: {
                companyName: "Acme",
                companySlug: "acme",
                contacts: [{ email: "buyer@acme.test", isPrimary: true }],
              },
              businessGoal: "Missing plan.",
              successCriteria: [],
              appContext: { platform: ["web"] },
              analyticsScope: { events: [] },
              assumptions: [],
              openQuestions: [],
              source: {
                sourceKind: "api",
                receivedAt: "2026-06-05T11:55:00Z",
              },
            },
          };
        },
      },
    });

    await expect(monitor.monitor({})).resolves.toMatchObject({
      searchedThreads: 1,
      processedMessages: 0,
      skippedMessages: 1,
    });
  });
});
