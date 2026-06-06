import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createAgentSystem } from "../app/create-agent-system.js";
import type { PosthogResourceRef } from "../contracts.js";
import { PostHogMcpGateway } from "../posthog/posthog-mcp-gateway.js";
import { PostHogMcpValidationTool } from "../posthog/posthog-mcp-validation-tool.js";
import { InMemoryEmailTool, ResourceValidationTool } from "../tools/in-memory-tools.js";
import type { PostHogProject, PostHogToolGateway } from "../tools/types.js";

class DryRunPostHogGateway implements PostHogToolGateway {
  readonly mutations: { tool: string; name?: string; id?: string }[] = [];
  private nextId = 1;

  constructor(private readonly live: PostHogToolGateway) {}

  async getProject(projectId: string): Promise<PostHogProject> {
    return await this.live.getProject(projectId);
  }

  async updateProjectSettings(projectId: string): Promise<void> {
    this.mutations.push({ tool: "project-settings-update", id: projectId });
  }

  async createAction(input: {
    projectId: string;
    name: string;
    description: string;
    matchEvents: string[];
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.dryRunResource("action", input.name);
  }

  async createDashboard(input: {
    projectId: string;
    name: string;
    description?: string;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.dryRunResource(
      "dashboard",
      input.name,
      `https://us.posthog.com/project/${input.projectId}/dashboard/dry-run-${this.nextId}`,
    );
  }

  async createInsight(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    description?: string;
    type: string;
    sourceEvents?: string[];
    query?: Record<string, unknown>;
    tags?: string[];
  }): Promise<PosthogResourceRef> {
    return this.dryRunResource("insight", input.name);
  }

  async readDataSchema(input: {
    projectId: string;
    query?: Record<string, unknown>;
  }): Promise<unknown> {
    return await this.live.readDataSchema?.(input);
  }

  async executeSql(input: { projectId: string; query: string }): Promise<unknown> {
    if (!this.live.executeSql) {
      throw new Error("Live PostHog gateway does not support executeSql.");
    }
    return await this.live.executeSql(input);
  }

  private dryRunResource(
    type: PosthogResourceRef["type"],
    name: string,
    url?: string,
  ): PosthogResourceRef {
    const id = `dry-run-${type}-${this.nextId++}`;
    this.mutations.push({ tool: `${type}-create`, name, id });
    return { type, id, name, url };
  }
}

loadDotenv();

type Mode = "dry-run" | "create";

const args = new Set(process.argv.slice(2));
const mode: Mode = args.has("--create") ? "create" : "dry-run";
const projectId = requiredEnv("POSTHOG_PROJECT_ID");
const transcriptPath = resolve(
  process.cwd(),
  "docs/sample-transcripts/widget-adoption-enmovil-bizom.md",
);

const livePosthog = new PostHogMcpGateway({
  apiKey: process.env.POSTHOG_MCP_API_KEY,
  organizationId: process.env.POSTHOG_ORGANIZATION_ID,
  projectId,
});
const posthog = mode === "create" ? livePosthog : new DryRunPostHogGateway(livePosthog);
const email = new InMemoryEmailTool();

const system = createAgentSystem({
  env: {
    ...process.env,
    EMAIL_MODE: "local",
    POSTHOG_MCP_API_KEY: undefined,
    POSTHOG_PROJECT_API_KEY: undefined,
  },
  email,
  approvalMode: "local",
  posthog,
  eventCaptureMode: "local",
  usageSnapshotMode: "local",
  validation:
    mode === "create"
      ? new PostHogMcpValidationTool({
          apiKey: process.env.POSTHOG_MCP_API_KEY,
          organizationId: process.env.POSTHOG_ORGANIZATION_ID,
          projectId,
        })
      : new ResourceValidationTool(),
  idGenerator: () => `agentic-smoke-${Date.now()}`,
});

const transcript = await readFile(transcriptPath, "utf8");
const intake = await system.orchestrator.submitRequirementsBlob({
  source: "file",
  filename: transcriptPath,
  text: transcript,
  participants: [
    {
      name: "VGS",
      email: "vgs@getconvinced.ai",
      company: "Convinced",
      role: "Product/Growth stakeholder",
    },
  ],
  structuredHints: {
    businessGoal:
      "Create a PM dashboard for landing-page widget adoption, email capture, and demo intent across the deployed Convinced widget.",
    successCriteria: [
      "Show widget adoption by landing page and company.",
      "Show email capture and demo intent trends with clear chart axes.",
      "Call out caveats when live event volume is low or data is session-based.",
    ],
    assumptions: [
      "Operator clarification for this smoke: use live observed production event names when they differ from planned metric labels.",
      "Email capture may be represented by widget_email_submitted, widget_email_captured, identity-capture email fields, resource-request email fields, or demo-request email fields.",
      "Demo intent may include submitted demo request events from chat or voice flows; include voice_only.demo_request_submitted when live evidence supports it.",
      "Low event volume should be treated as a dashboard caveat, not a blocker for this smoke.",
      "The buyer audience is PM/growth; ask follow-up only for business definitions not answerable from the transcript and live evidence.",
    ],
    appContext: {
      appName: "Convinced widget",
      platform: ["web"],
      environments: ["prod"],
    },
    posthogContext: {
      projectId,
      projectName: process.env.POSTHOG_PROJECT_NAME ?? "Convinced",
      organizationId: process.env.POSTHOG_ORGANIZATION_ID,
      region: "US",
      useExistingProject: true,
    },
    analyticsScope: {
      events: [
        {
          name: "widget_session_started",
          description: "Visitor starts a widget session.",
          required: false,
        },
        {
          name: "widget_first_message_sent",
          description: "Visitor sends the first message in a widget session.",
          required: false,
        },
        {
          name: "widget_engaged_session",
          description: "Visitor reaches the agreed engaged-session threshold.",
          required: false,
        },
        {
          name: "widget_email_captured",
          description: "Visitor email is captured from identity, resource, or demo flow.",
          required: false,
        },
        {
          name: "widget_demo_requested",
          description: "Visitor submits a demo or book-a-demo request.",
          required: false,
        },
      ],
      dashboards: [
        {
          name: "Widget adoption PM dashboard",
          description:
            "Agentic PM dashboard for widget sessions, conversion, landing pages, and company/page adoption.",
          tiles: [],
        },
      ],
    },
  },
  sourceMetadata: {
    sourceId: "sample-transcript:widget-adoption-enmovil-bizom",
    receivedAt: new Date().toISOString(),
  },
});

if (intake.status !== "confirmation_sent") {
  console.log(
    JSON.stringify(
      {
        mode,
        status: "blocked",
        stage: "intake",
        pocId: intake.pocId,
        missingDetails: intake.missingDetails,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  const confirmation = email.sentEmails.at(-1);
  let reply:
    | Awaited<ReturnType<typeof system.workflow.processEmailReply>>
    | { error: string; intent?: undefined };
  try {
    reply = await system.workflow.processEmailReply({
      pocId: intake.pocId,
      message: {
        id: `agentic-smoke-reply-${Date.now()}`,
        threadId: confirmation?.threadId ?? "agentic-smoke-thread",
        from: "vgs@getconvinced.ai",
        to: ["gautamgsabhahit@gmail.com"],
        subject: `Re: ${confirmation?.subject ?? "PostHog PoC plan"}`,
        textBody:
          "Confirmed. This is the dashboard we need for the pilot. Please proceed and send the final dashboard view when it is ready.",
        receivedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    reply = { error: (error as Error).message };
  }
  let setupResult = await system.store.getSetupResult(intake.pocId);
  let operatorRetry:
    | {
        applied: true;
        planVersion: number;
        setupStatus?: string;
        error?: string;
      }
    | {
        applied: false;
      } = { applied: false };

  if (setupResult?.status === "failed" && needsBusinessClarification(setupResult.knownGaps)) {
    const revision = await system.orchestrator.revisePlanFromChanges({
      pocId: intake.pocId,
      changes: smokeOperatorClarifications(),
      requestedBy: "operator@convinced.local",
    });
    try {
      const retry = await system.workflow.approveAndRunSetup({
        pocId: intake.pocId,
        approvedBy: "operator@convinced.local",
        approvalSource: "internal_operator",
      });
      setupResult = retry.setupResult;
      operatorRetry = {
        applied: true,
        planVersion: revision.planVersion,
        setupStatus: setupResult.status,
      };
    } catch (error) {
      // runSetup persists the (failed) setup result before throwing on clarification,
      // so re-fetch it to surface knownGaps instead of crashing the smoke.
      setupResult = await system.store.getSetupResult(intake.pocId);
      operatorRetry = {
        applied: true,
        planVersion: revision.planVersion,
        setupStatus: setupResult?.status,
        error: (error as Error).message,
      };
    }
  }

  const dashboard = setupResult?.createdResources.find((resource) => resource.type === "dashboard");
  const insights =
    setupResult?.createdResources.filter((resource) => resource.type === "insight") ?? [];
  const auditEvents = auditEventsFrom(system.tools.audit);

  console.log(
    JSON.stringify(
      {
        mode,
        transcriptPath,
        pocId: intake.pocId,
        reply,
        operatorRetry,
        setupStatus: setupResult?.status,
        validationStatus: setupResult?.validationReport?.status,
        validationChecks: (setupResult?.validationReport?.checks ?? []).map((check) => ({
          name: check.name,
          status: check.status,
          error: check.error,
        })),
        dashboard,
        insightCount: insights.length,
        insights,
        knownGaps: setupResult?.knownGaps ?? [],
        caveats: auditEvents
          .filter((event) => event.action === "dashboard_caveats_recorded")
          .flatMap((event) => (event.outputSummary ?? "").split(" | "))
          .filter((caveat) => caveat.length > 0),
        dryRunMutations: posthog instanceof DryRunPostHogGateway ? posthog.mutations : undefined,
        auditTrail: auditEvents.map((event) => ({
          action: event.action,
          status: event.status,
          summary: event.outputSummary,
          error: event.error,
        })),
      },
      null,
      2,
    ),
  );

  if (!setupResult || setupResult.status === "failed" || !dashboard || insights.length === 0) {
    process.exitCode = 1;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function needsBusinessClarification(knownGaps: string[]): boolean {
  return knownGaps.some((gap) =>
    gap.startsWith("DeepSeek requested business clarification before dashboard creation:"),
  );
}

function smokeOperatorClarifications(): string[] {
  return [
    "For this smoke, use widget_email_submitted as the primary email capture signal; include widget_email_captured only as a low-volume fallback if live evidence supports it.",
    "For this smoke, use voice_only.demo_request_submitted as submitted demo intent; include widget_demo_requested only as a low-volume fallback if live evidence supports it.",
    "Identify company and landing page from live URL properties such as $current_url, $session_entry_url, and $referrer. Map URLs containing enmovil to Enmovil, URLs containing bizom to Bizom, and all other non-local URLs to Other.",
    "Low event volume is acceptable for this test account. Create the dashboard with visible caveats instead of blocking on volume.",
  ];
}

function auditEventsFrom(audit: typeof system.tools.audit): {
  action: string;
  status: string;
  outputSummary?: string;
  error?: string;
}[] {
  if (!("events" in audit) || !Array.isArray(audit.events)) {
    return [];
  }
  return audit.events.filter(
    (
      event,
    ): event is {
      action: string;
      status: string;
      outputSummary?: string;
      error?: string;
    } => typeof event === "object" && event !== null && "action" in event && "status" in event,
  );
}
