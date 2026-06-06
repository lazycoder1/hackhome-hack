import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSystem } from "../src/app/create-agent-system.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import { SqlitePocStore } from "../src/state/sqlite-poc-store.js";
import { createPocStore } from "../src/state/create-poc-store.js";
import { GmailApiEmailTool } from "../src/tools/gmail-api-email-tool.js";
import { GmailMcpEmailTool } from "../src/tools/gmail-mcp-email-tool.js";
import type { GmailMcpGateway } from "../src/tools/gmail-mcp-email-tool.js";

describe("createAgentSystem", () => {
  it("wires orchestrator, setup workflow, file store, and default local tools", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-system-"));

    try {
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

      const system = createAgentSystem({
        storePath: join(dir, "pocs.json"),
        llm,
        approvalMode: "local",
        clock: () => new Date("2026-06-04T00:00:00.000Z"),
        idGenerator: () => "poc_123",
      });

      const intake = await system.orchestrator.submitRequirementsBlob({
        source: "api",
        text: "Acme wants to evaluate PostHog.",
        participants: [{ email: "buyer@acme.test", company: "Acme" }],
        sourceMetadata: { sourceId: "requirements-1" },
      });
      const handoff = await system.workflow.approveAndRunSetup({
        pocId: intake.pocId,
        approvedBy: "buyer@acme.test",
        approvalSource: "approval_link",
      });

      expect(handoff.setupResult.status).toBe("succeeded");
      expect((await system.store.getPoc("poc_123"))?.status).toBe("handoff_sent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the SQLite store when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-system-sqlite-"));

    try {
      const system = createAgentSystem({
        storeMode: "sqlite",
        storePath: join(dir, "pocs.sqlite"),
        llm: fakeLlm(),
        approvalMode: "local",
      });

      expect(system.store).toBeInstanceOf(SqlitePocStore);
      (system.store as SqlitePocStore).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects Postgres mode because this is a PoC without PGSQL dependencies", () => {
    expect(() =>
      createPocStore({
        env: { POC_STORE_MODE: "postgres" } as NodeJS.ProcessEnv,
      }),
    ).toThrow(/Invalid POC_STORE_MODE/);
  });

  it("uses SQLite automatically when SQLITE_DB_PATH is configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-system-sqlite-"));

    try {
      const system = createAgentSystem({
        llm: fakeLlm(),
        approvalMode: "local",
        env: {
          SQLITE_DB_PATH: join(dir, "pocs.sqlite"),
        },
      });

      expect(system.store).toBeInstanceOf(SqlitePocStore);
      (system.store as SqlitePocStore).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not auto-select database storage from DATABASE_URL", () => {
    const system = createAgentSystem({
      llm: fakeLlm(),
      approvalMode: "local",
      env: {
        DATABASE_URL: "postgres://ignored",
      },
    });

    expect(system.store).not.toBeInstanceOf(SqlitePocStore);
  });

  it("uses Gmail MCP email when a Gmail MCP gateway is configured", () => {
    const gmailMcpGateway: GmailMcpGateway = {
      async createDraft() {
        return { id: "draft_123", threadId: "thread_123" };
      },
      async searchThreads() {
        return { threads: [] };
      },
      async getThread() {
        return { id: "thread_123", messages: [] };
      },
    };
    const system = createAgentSystem({
      llm: fakeLlm(),
      approvalMode: "local",
      emailMode: "gmail_mcp",
      gmailMcpGateway,
    });

    expect(system.tools.email).toBeInstanceOf(GmailMcpEmailTool);
  });

  it("can wire Gmail MCP email from server startup environment", () => {
    const system = createAgentSystem({
      llm: fakeLlm(),
      approvalMode: "local",
      env: {
        EMAIL_MODE: "gmail_mcp",
        GMAIL_MCP_ENDPOINT: "https://gmailmcp.googleapis.com/mcp/v1",
        GMAIL_MCP_ACCESS_TOKEN: "ya29.test",
      },
    });

    expect(system.tools.email).toBeInstanceOf(GmailMcpEmailTool);
  });

  it("can wire raw Gmail API direct-send email from server startup environment", () => {
    const system = createAgentSystem({
      llm: fakeLlm(),
      approvalMode: "local",
      env: {
        EMAIL_MODE: "gmail_api",
        GMAIL_API_ACCESS_TOKEN: "ya29.test",
        GMAIL_API_USER_ID: "me",
        EMAIL_FROM: "PoC Team <poc@example.test>",
      },
    });

    expect(system.tools.email).toBeInstanceOf(GmailApiEmailTool);
  });
});

function fakeLlm(): LlmJsonClient {
  return {
    async completeJson() {
      return {};
    },
  };
}
