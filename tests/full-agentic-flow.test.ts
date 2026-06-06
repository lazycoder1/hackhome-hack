import { AddressInfo } from "node:net";
import { createAgentSystem } from "../src/app/create-agent-system.js";
import { createHttpApiServer } from "../src/server/http-server.js";
import { PocStatusReader } from "../src/status/poc-status-reader.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import {
  InMemoryApprovalTool,
  InMemoryEmailTool,
  InMemorySecretsTool,
  ResourceValidationTool,
} from "../src/tools/in-memory-tools.js";
import type { LlmJsonClient } from "../src/llm/types.js";
import type { PostHogToolGateway } from "../src/tools/types.js";
import { LocalWorkflowApi } from "../src/workflow/local-workflow-api.js";

describe("full agentic PoC flow", () => {
  it("extracts requirements, accepts email approval, creates charted PostHog insights, and sends handoff", async () => {
    const store = new InMemoryPocStore();
    const email = new InMemoryEmailTool({ clock });
    const approval = new InMemoryApprovalTool({ baseApprovalUrl: "https://approve.test", clock });
    const secrets = new InMemorySecretsTool({ baseSecretUrl: "https://secrets.test", clock });
    const llmCalls: string[] = [];
    const insightQueries: Record<string, unknown>[] = [];
    const posthog = agenticPosthogGateway(insightQueries);
    const system = createAgentSystem({
      store,
      llm: deterministicLlm(llmCalls),
      email,
      approval,
      posthog,
      secrets,
      validation: new ResourceValidationTool({ clock }),
      env: {
        POSTHOG_REQUIRE_AGENTIC_DASHBOARD: "1",
        POC_SETUP_TIMEOUT_MS: "30000",
      },
      clock,
      idGenerator: () => "poc_e2e_agentic",
    });
    const server = createHttpApiServer({
      workflow: new LocalWorkflowApi(system),
      statusReader: new PocStatusReader(store),
      secrets,
    });
    const baseUrl = await listen(server);

    try {
      const intake = await postJson<{ runId: string }>(`${baseUrl}/requirements`, {
        source: "api",
        text: [
          "Build the Enmovil and Bizom PostHog PoC dashboard.",
          "Show page adoption, conversion, campaign performance, and chat versus voice usage.",
          "Use $pageview, widget_email_submitted, and voice_only.demo_request_submitted.",
        ].join(" "),
        participants: [{ email: "vgs@getconvinced.ai", company: "Convinced" }],
        sourceMetadata: { sourceId: "e2e-requirements" },
      });
      expect(intake).toEqual({ runId: "poc_e2e_agentic" });

      const confirmation = await getJson<Record<string, unknown>>(
        `${baseUrl}/pocs/poc_e2e_agentic`,
      );
      expect(confirmation).toMatchObject({
        pocId: "poc_e2e_agentic",
        status: "confirmation_sent",
        hasRequirements: true,
        hasActivePlan: true,
        hasSetupResult: false,
      });
      expect(email.sentEmails).toHaveLength(1);
      expect(email.sentEmails[0]?.subject).toBe("Please confirm your PostHog PoC plan");

      const approvalResult = await postJson<Record<string, unknown>>(`${baseUrl}/email/inbound`, {
        pocId: "poc_e2e_agentic",
        message: {
          id: "inbound-approval-1",
          threadId: String(confirmation.confirmationThreadId),
          from: "vgs@getconvinced.ai",
          to: ["agent@getconvinced.ai"],
          subject: "Re: Please confirm your PostHog PoC plan",
          textBody: "Approved. Please proceed with the dashboard.",
          receivedAt: "2026-06-06T11:10:00.000Z",
        },
      });
      expect(approvalResult).toEqual({
        intent: "approved",
        completedApproval: true,
        requiresSetup: true,
        changes: [],
      });

      const delivered = await getJson<Record<string, unknown>>(
        `${baseUrl}/pocs/poc_e2e_agentic`,
      );
      expect(delivered).toMatchObject({
        pocId: "poc_e2e_agentic",
        status: "handoff_sent",
        hasSetupResult: true,
        setupStatus: "succeeded",
        validationStatus: "pass",
      });
      expect(delivered.setupResult).toMatchObject({
        status: "succeeded",
        validationReport: { status: "pass" },
      });
      expect(email.sentEmails).toHaveLength(2);
      expect(email.sentEmails[1]?.subject).toBe(
        "Your PostHog PoC is ready: testing plan and access details",
      );
      expect(email.sentEmails[1]?.markdownBody).toContain(
        "https://us.posthog.com/project/project-1/dashboard/dashboard-1",
      );
      expect(llmCalls).toEqual(["extract", "classify", "dashboard"]);
      expect(insightQueries).toEqual([
        expect.objectContaining({
          kind: "DataVisualizationNode",
          display: "ActionsBar",
          chartSettings: expect.objectContaining({
            xAxis: { column: "path" },
            yAxis: [{ column: "views" }],
          }),
        }),
        expect.objectContaining({
          kind: "DataVisualizationNode",
          display: "ActionsLineGraph",
          chartSettings: expect.objectContaining({
            xAxis: { column: "day" },
            yAxis: [{ column: "sessions" }],
          }),
        }),
      ]);
    } finally {
      await close(server);
    }
  });
});

function deterministicLlm(calls: string[]): LlmJsonClient {
  return {
    async completeJson(input) {
      if (input.system.includes("Extract a PostHog PoC requirements object")) {
        calls.push("extract");
        return {
          customer: {
            companyName: "Convinced",
            companySlug: "convinced",
            contacts: [{ email: "vgs@getconvinced.ai", isPrimary: true }],
          },
          product: "posthog",
          businessGoal: "Measure Enmovil and Bizom widget adoption and conversion.",
          successCriteria: [
            "Show which pages get widget usage",
            "Show which pages convert into email capture or demo requests",
          ],
          appContext: {
            appName: "Convinced PoC dashboard",
            platform: ["web"],
          },
          posthogContext: {
            projectId: "project-1",
            projectName: "Convinced Widget PoC",
            useExistingProject: true,
          },
          analyticsScope: {
            events: [
              {
                name: "$pageview",
                description: "Page view context for widget pages",
                required: true,
              },
              {
                name: "widget_email_submitted",
                description: "Email or identity capture",
                required: true,
              },
              {
                name: "voice_only.demo_request_submitted",
                description: "Voice demo request",
                required: true,
              },
            ],
            dashboards: [
              {
                name: "Widget Adoption",
                description: "PM-readable adoption and conversion dashboard",
                tiles: [],
              },
            ],
          },
          assumptions: [],
          openQuestions: [],
        };
      }

      if (input.system.includes("Classify the customer's natural-language email reply")) {
        calls.push("classify");
        return {
          intent: "approved",
          confidence: 0.99,
          extractedChanges: [],
          requiresHumanReview: false,
        };
      }

      if (input.system.includes("You design PostHog PoC dashboards")) {
        calls.push("dashboard");
        expect(input.user).toContain("widget_email_submitted");
        return {
          dashboardName: "Widget Adoption and Conversion Dashboard",
          dashboardDescription:
            "PM-readable view of page adoption, conversion, and daily activity.",
          clarificationRequired: false,
          clarificationQuestions: [],
          notes: ["Uses live PostHog evidence from the target project."],
          tiles: [
            {
              title: "Top widget pages by pageviews",
              description: "Ranks pages where widget adoption is visible.",
              validationSql:
                "SELECT properties['$pathname'] AS path, count() AS views FROM events WHERE event = '$pageview' GROUP BY path ORDER BY views DESC LIMIT 10",
              insightQuery: {
                kind: "DataVisualizationNode",
                source: {
                  kind: "HogQLQuery",
                  query:
                    "SELECT properties['$pathname'] AS path, count() AS views FROM events WHERE event = '$pageview' GROUP BY path ORDER BY views DESC LIMIT 10",
                },
              },
            },
            {
              title: "Daily widget sessions",
              description: "Shows daily widget activity trend.",
              validationSql:
                "SELECT toDate(timestamp) AS day, count() AS sessions FROM events WHERE event LIKE 'voice_%' OR event LIKE 'voice_widget.%' GROUP BY day ORDER BY day",
              insightQuery: {
                kind: "DataVisualizationNode",
                source: {
                  kind: "HogQLQuery",
                  query:
                    "SELECT toDate(timestamp) AS day, count() AS sessions FROM events WHERE event LIKE 'voice_%' OR event LIKE 'voice_widget.%' GROUP BY day ORDER BY day",
                },
              },
            },
          ],
        };
      }

      throw new Error(`Unexpected LLM prompt: ${input.system}`);
    },
  };
}

function agenticPosthogGateway(insightQueries: Record<string, unknown>[]): PostHogToolGateway {
  return {
    async getProject(projectId) {
      return {
        id: projectId,
        name: "Convinced Widget PoC",
        url: `https://us.posthog.com/project/${projectId}`,
        hostUrl: "https://us.i.posthog.com",
      };
    },
    async updateProjectSettings() {
      return undefined;
    },
    async createAction(input) {
      return { type: "action", id: `action-${input.name}`, name: input.name };
    },
    async createDashboard(input) {
      return {
        type: "dashboard",
        id: "dashboard-1",
        name: input.name,
        url: `https://us.posthog.com/project/${input.projectId}/dashboard/dashboard-1`,
      };
    },
    async createInsight(input) {
      if (input.query) {
        insightQueries.push(input.query);
      }
      return {
        type: "insight",
        id: `insight-${insightQueries.length}`,
        name: input.name,
        url: `https://us.posthog.com/project/${input.projectId}/insights/${insightQueries.length}`,
      };
    },
    async readDataSchema() {
      return {
        events: [
          "$pageview",
          "widget_email_submitted",
          "voice_only.demo_request_submitted",
          "voice_widget.opened",
        ],
      };
    },
    async executeSql(input) {
      if (input.query.includes("bad_metric")) {
        throw new Error("Unknown identifier bad_metric");
      }
      return { results: [[1]], columns: ["ok"] };
    },
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
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

function clock(): Date {
  return new Date("2026-06-06T11:00:00.000Z");
}
