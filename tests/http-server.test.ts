import { AddressInfo } from "node:net";
import { createHttpApiServer } from "../src/server/http-server.js";
import type { PocStatusReadApi } from "../src/status/poc-status-reader.js";
import type { WorkflowApi } from "../src/workflow/workflow-api.js";

describe("createHttpApiServer", () => {
  it("serves health checks", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await close(server);
    }
  });

  it("allows configured Vercel frontend origins", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const origin = "https://agentic-presales.vercel.app";
      const response = await fetch(`${baseUrl}/health`, {
        headers: { origin },
      });
      const preflight = await fetch(`${baseUrl}/requirements`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
      expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    } finally {
      await close(server);
    }
  });

  it("serves and clears Google OAuth connector status", async () => {
    let connected = true;
    const server = createHttpApiServer({
      workflow: fakeWorkflow(),
      googleOAuth: {
        status() {
          return {
            configured: true,
            connected,
            email: connected ? "tester@example.test" : undefined,
            expiresAt: connected ? "2026-06-05T11:00:00.000Z" : undefined,
            scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.compose"],
            provider: "workspace",
            deliveryMode: "draft",
            memoryOnly: true,
            storage: "memory",
          };
        },
        createAuthorizationUrl() {
          return "https://accounts.example.test/oauth";
        },
        async handleCallback() {
          return { returnTo: "/settings", expiresAt: "2026-06-05T11:00:00.000Z" };
        },
        forget() {
          connected = false;
          return this.status();
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const status = await fetch(`${baseUrl}/integrations/google/status`);
      const cleared = await fetch(`${baseUrl}/integrations/google/oauth/forget`, {
        method: "POST",
      });

      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        configured: true,
        connected: true,
        email: "tester@example.test",
        memoryOnly: true,
        storage: "memory",
      });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({
        configured: true,
        connected: false,
        memoryOnly: true,
        storage: "memory",
      });
    } finally {
      await close(server);
    }
  });

  it("creates a Google OAuth test draft through the configured email tool", async () => {
    const emails: unknown[] = [];
    const server = createHttpApiServer({
      workflow: fakeWorkflow(),
      googleTestEmail: {
        async sendEmail(input) {
          emails.push(input);
          return {
            emailId: "draft_123",
            threadId: "thread_123",
            sentAt: "2026-06-05T12:00:00.000Z",
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/integrations/google/test-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: "buyer@example.test",
          subject: "OAuth smoke test",
          body: "Draft body",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        mode: "draft",
        transport: "gmail_mcp",
        emailId: "draft_123",
        threadId: "thread_123",
        sentAt: "2026-06-05T12:00:00.000Z",
      });
      expect(emails).toEqual([
        {
          to: ["buyer@example.test"],
          subject: "OAuth smoke test",
          markdownBody: "Draft body",
          tags: ["test:gmail-oauth", "delivery:draft"],
        },
      ]);
    } finally {
      await close(server);
    }
  });

  it("falls back to Gmail API draft creation when Gmail MCP draft creation fails", async () => {
    const apiDrafts: unknown[] = [];
    const server = createHttpApiServer({
      workflow: fakeWorkflow(),
      googleTestEmail: {
        async sendEmail() {
          throw new Error("The caller does not have permission");
        },
      },
      googleApiDraftEmail: {
        async sendEmail() {
          throw new Error("send should not be called");
        },
        async createDraft(input) {
          apiDrafts.push(input);
          return {
            emailId: "draft_api_123",
            threadId: "thread_api_123",
            sentAt: "2026-06-05T12:05:00.000Z",
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/integrations/google/test-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: "buyer@example.test",
          subject: "OAuth smoke test",
          body: "Draft body",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        mode: "draft",
        transport: "gmail_api_fallback",
        mcpError: "The caller does not have permission",
        emailId: "draft_api_123",
        threadId: "thread_api_123",
        sentAt: "2026-06-05T12:05:00.000Z",
      });
      expect(apiDrafts).toHaveLength(1);
    } finally {
      await close(server);
    }
  });

  it("accepts requirements blobs and starts the Trigger workflow", async () => {
    const calls: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async startPosthogPocWorkflow(input) {
          calls.push(input);
          return { runId: "run_123" };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/requirements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "api",
          text: "Acme wants PostHog.",
          participants: [{ email: "buyer@acme.test", company: "Acme" }],
          sourceMetadata: { sourceId: "requirements-1" },
        }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ runId: "run_123" });
      expect(calls).toHaveLength(1);
    } finally {
      await close(server);
    }
  });

  it("serves compact PoC status lists", async () => {
    const statusReader: PocStatusReadApi = {
      async activity() {
        return { events: [] };
      },
      async list(_input) {
        return {
          pocs: [
            {
              pocId: "poc_123",
              status: "handoff_sent",
              createdAt: "2026-06-04T00:00:00.000Z",
              updatedAt: "2026-06-04T00:10:00.000Z",
              customerCompany: "Acme",
              product: "posthog",
              hasRequirements: true,
              hasActivePlan: true,
              hasSetupResult: true,
              setupStatus: "succeeded",
            },
          ],
        };
      },
      async detail() {
        return undefined;
      },
      async monitoringReports() {
        return { reports: [] };
      },
    };
    const server = createHttpApiServer({ workflow: fakeWorkflow(), statusReader });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs?limit=5`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        pocs: [
          {
            pocId: "poc_123",
            status: "handoff_sent",
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:10:00.000Z",
            customerCompany: "Acme",
            product: "posthog",
            hasRequirements: true,
            hasActivePlan: true,
            hasSetupResult: true,
            setupStatus: "succeeded",
          },
        ],
      });
    } finally {
      await close(server);
    }
  });

  it("serves PoC status detail", async () => {
    const statusReader: PocStatusReadApi = {
      async activity() {
        return { events: [] };
      },
      async list() {
        return { pocs: [] };
      },
      async detail(pocId) {
        if (pocId !== "poc_123") {
          return undefined;
        }

        return {
          pocId,
          status: "confirmation_sent",
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:05:00.000Z",
          activePlanVersion: 1,
          customerCompany: "Acme",
          customerSlug: "acme",
          product: "posthog",
          objective: "Evaluate signup activation analytics.",
          hasRequirements: true,
          hasActivePlan: true,
          hasSetupResult: false,
          requirements: {
            pocId,
            product: "posthog",
            customer: {
              companyName: "Acme",
              companySlug: "acme",
              contacts: [{ email: "buyer@acme.test", isPrimary: true }],
            },
            businessGoal: "Evaluate signup activation analytics.",
            successCriteria: ["Track signup funnel"],
            appContext: { platform: ["web"] },
            analyticsScope: { events: [] },
            assumptions: [],
            openQuestions: [],
            source: {
              sourceKind: "api",
              receivedAt: "2026-06-04T00:00:00.000Z",
            },
          },
        };
      },
      async monitoringReports() {
        return { reports: [] };
      },
    };
    const server = createHttpApiServer({ workflow: fakeWorkflow(), statusReader });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/poc_123`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        pocId: "poc_123",
        status: "confirmation_sent",
        customerCompany: "Acme",
        requirements: {
          businessGoal: "Evaluate signup activation analytics.",
        },
      });
    } finally {
      await close(server);
    }
  });

  it("serves the agent activity feed for a PoC", async () => {
    const statusReader: PocStatusReadApi = {
      async list() {
        return { pocs: [] };
      },
      async detail() {
        return undefined;
      },
      async monitoringReports() {
        return { reports: [] };
      },
      async activity(pocId) {
        return {
          events: [
            {
              id: "evt_1",
              pocId,
              ts: "2026-06-05T12:00:00.000Z",
              kind: "action_gated",
              actor: "pov_loop",
              status: "gated",
              summary: "Customer nudge queued for SE approval",
              cadenceKey: "nudge:inactive",
              refs: { approvalTokenId: "tok_1" },
            },
          ],
        };
      },
    };
    const server = createHttpApiServer({ workflow: fakeWorkflow(), statusReader });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/poc_123/activity`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        events: [{ id: "evt_1", kind: "action_gated", cadenceKey: "nudge:inactive" }],
      });
    } finally {
      await close(server);
    }
  });

  it("serves monitoring reports for a PoC", async () => {
    const statusReader: PocStatusReadApi = {
      async activity() {
        return { events: [] };
      },
      async list() {
        return { pocs: [] };
      },
      async detail() {
        return undefined;
      },
      async monitoringReports(pocId) {
        return {
          reports: [
            {
              pocId,
              planVersion: 1,
              runId: "monitor-run-1",
              checkedAt: "2026-06-05T12:00:00.000Z",
              window: {
                from: "2026-06-05T00:00:00.000Z",
                to: "2026-06-05T12:00:00.000Z",
              },
              status: "criteria_met",
              riskLevel: "none",
              usageSummary: {
                hasRealCustomerActivity: true,
                syntheticOnly: false,
                totalEvents: 5,
                uniqueUsers: 2,
              },
              eventProgress: [],
              successCriteriaProgress: [],
              planDrift: {
                missingExpectedEvents: [],
                unexpectedObservedEvents: [],
                notes: [],
              },
              recommendedActions: [],
            },
          ],
        };
      },
    };
    const server = createHttpApiServer({ workflow: fakeWorkflow(), statusReader });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/poc_123/monitoring`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        reports: [
          {
            pocId: "poc_123",
            runId: "monitor-run-1",
            status: "criteria_met",
          },
        ],
      });
    } finally {
      await close(server);
    }
  });

  it("runs an on-demand monitoring check for a PoC", async () => {
    const runs: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async monitorActivePoc(input) {
          runs.push(input);
          return {
            pocId: input.pocId,
            planVersion: 1,
            runId: "monitor-run-1",
            checkedAt: "2026-06-05T12:00:00.000Z",
            window: input.window ?? {
              from: "2026-06-04T12:00:00.000Z",
              to: "2026-06-05T12:00:00.000Z",
            },
            status: "inactive",
            riskLevel: "high",
            usageSummary: {
              hasRealCustomerActivity: false,
              syntheticOnly: false,
              totalEvents: 0,
            },
            eventProgress: [],
            successCriteriaProgress: [],
            planDrift: {
              missingExpectedEvents: [],
              unexpectedObservedEvents: [],
              notes: [],
            },
            recommendedActions: [],
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/poc_123/monitoring/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          window: {
            from: "2026-06-05T00:00:00.000Z",
            to: "2026-06-05T12:00:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        runId: "monitor-run-1",
        status: "inactive",
      });
      expect(runs).toEqual([
        {
          pocId: "poc_123",
          window: {
            from: "2026-06-05T00:00:00.000Z",
            to: "2026-06-05T12:00:00.000Z",
          },
        },
      ]);
    } finally {
      await close(server);
    }
  });

  it("retries a persisted PoC stage", async () => {
    const calls: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async retryPocStage(input) {
          calls.push(input);
          return {
            pocId: input.pocId,
            stage: input.stage,
            status: "handoff_sent_with_gaps",
            setupStatus: "succeeded_with_warnings",
            handoffEmailId: "email-1",
            handoffThreadId: "thread-1",
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/poc_123/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage: "handoff",
          requestedBy: "operator@example.test",
        }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        pocId: "poc_123",
        stage: "handoff",
        status: "handoff_sent_with_gaps",
      });
      expect(calls).toEqual([
        {
          pocId: "poc_123",
          stage: "handoff",
          requestedBy: "operator@example.test",
        },
      ]);
    } finally {
      await close(server);
    }
  });

  it("returns 404 for unknown PoC status detail", async () => {
    const statusReader: PocStatusReadApi = {
      async activity() {
        return { events: [] };
      },
      async list() {
        return { pocs: [] };
      },
      async detail() {
        return undefined;
      },
      async monitoringReports() {
        return { reports: [] };
      },
    };
    const server = createHttpApiServer({ workflow: fakeWorkflow(), statusReader });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/pocs/missing`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "poc_not_found" });
    } finally {
      await close(server);
    }
  });

  it("serves and consumes one-time secrets", async () => {
    const consumed: string[] = [];
    const server = createHttpApiServer({
      workflow: fakeWorkflow(),
      secrets: {
        async consumeOneTimeSecretLink(input) {
          consumed.push(input.token);
          if (consumed.length > 1) {
            return { status: "used" };
          }
          return {
            status: "consumed",
            name: "posthog_project_access",
            value: "raw-secret-value",
            expiresAt: "2026-06-11T00:00:00.000Z",
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const first = await fetch(`${baseUrl}/secrets/one-time-token`);
      const firstHtml = await first.text();
      const second = await fetch(`${baseUrl}/secrets/one-time-token`);
      const secondHtml = await second.text();

      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(firstHtml).toContain("posthog_project_access");
      expect(firstHtml).toContain("raw-secret-value");
      expect(second.status).toBe(410);
      expect(secondHtml).toContain("already been used");
      expect(consumed).toEqual(["one-time-token", "one-time-token"]);
    } finally {
      await close(server);
    }
  });

  it("serves the approval page with waitpoint token context", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(
        `${baseUrl}/approval?tokenId=waitpoint_123&publicAccessToken=public-token`,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("PostHog PoC Approval");
      expect(html).toContain('"tokenId":"waitpoint_123"');
      expect(html).toContain('"publicAccessToken":"public-token"');
      expect(html).toContain("/approval/complete");
    } finally {
      await close(server);
    }
  });

  it("rejects approval page links without token context", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/approval`);
      const html = await response.text();

      expect(response.status).toBe(400);
      expect(html).toContain("missing required token parameters");
      expect(html).toContain("disabled");
    } finally {
      await close(server);
    }
  });

  it("completes approval waitpoints", async () => {
    const completed: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async completeApproval(input) {
          completed.push(input);
          return { success: true };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/approval/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId: "waitpoint_123",
          publicAccessToken: "public-token",
          decision: "approved",
          decidedBy: "buyer@acme.test",
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(completed).toEqual([
        {
          tokenId: "waitpoint_123",
          publicAccessToken: "public-token",
          decision: "approved",
          decidedBy: "buyer@acme.test",
        },
      ]);
    } finally {
      await close(server);
    }
  });

  it("accepts inbound email replies", async () => {
    const replies: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async processEmailReply(input) {
          replies.push(input);
          return {
            intent: "approved",
            completedApproval: true,
            requiresSetup: true,
            changes: [],
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/email/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pocId: "poc_123",
          message: {
            id: "inbound-1",
            threadId: "thread-1",
            from: "buyer@acme.test",
            to: ["poc@example.test"],
            subject: "Re: Please confirm",
            textBody: "Approved",
            receivedAt: "2026-06-04T00:05:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        intent: "approved",
        completedApproval: true,
        requiresSetup: true,
        changes: [],
      });
      expect(replies).toHaveLength(1);
    } finally {
      await close(server);
    }
  });

  it("accepts Gmail MCP inbound email messages", async () => {
    const replies: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async processEmailReply(input) {
          replies.push(input);
          return {
            intent: "approved",
            completedApproval: true,
            requiresSetup: true,
            changes: [],
          };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/email/inbound/gmail-mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: {
            id: "msg_123",
            thread_id: "thread_123",
            from: "Buyer <buyer@acme.test>",
            to: "PoC <poc_123@inbound.example.test>",
            subject: "Re: Please confirm",
            body: "Approved",
            timestamp: "2026-06-04T00:05:00.000Z",
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "approved",
        completedApproval: true,
      });
      expect(replies[0]).toMatchObject({
        pocId: "poc_123",
        message: {
          id: "msg_123",
          textBody: "Approved",
        },
      });
    } finally {
      await close(server);
    }
  });

  it("rejects malformed requirements blobs with 400 and does not start a workflow", async () => {
    const calls: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async startPosthogPocWorkflow(input) {
          calls.push(input);
          return { runId: "run_123" };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/requirements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "api" }), // missing text, participants, sourceMetadata
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
      expect(calls).toHaveLength(0);
    } finally {
      await close(server);
    }
  });

  it("rejects approval completions with an invalid decision", async () => {
    const completed: unknown[] = [];
    const server = createHttpApiServer({
      workflow: {
        ...fakeWorkflow(),
        async completeApproval(input) {
          completed.push(input);
          return { success: true };
        },
      },
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/approval/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId: "waitpoint_123",
          publicAccessToken: "public-token",
          decision: "maybe",
          decidedBy: "buyer@acme.test",
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
      expect(completed).toHaveLength(0);
    } finally {
      await close(server);
    }
  });

  it("rejects inbound email replies that are missing message fields", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/email/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pocId: "poc_123", message: { id: "inbound-1" } }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error: string;
        details: { path: string }[];
      };
      expect(body.error).toBe("invalid_request");
      expect(body.details.some((detail) => detail.path.startsWith("message."))).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("rejects non-JSON request bodies with 400", async () => {
    const server = createHttpApiServer({ workflow: fakeWorkflow() });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/requirements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json{",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_json" });
    } finally {
      await close(server);
    }
  });
});

function fakeWorkflow(): WorkflowApi {
  return {
    async startPosthogPocWorkflow() {
      return { runId: "run_fake" };
    },
    async completeApproval() {
      return { success: true };
    },
    async processEmailReply() {
      return {
        intent: "unclear",
        completedApproval: false,
        requiresSetup: false,
        changes: [],
      };
    },
    async monitorActivePoc() {
      throw new Error("monitorActivePoc was not expected");
    },
    async retryPocStage() {
      throw new Error("retryPocStage was not expected");
    },
  };
}

async function listen(server: ReturnType<typeof createHttpApiServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createHttpApiServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
