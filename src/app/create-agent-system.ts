import { HandoffGenerator } from "../handoff/handoff-generator.js";
import { DeepSeekClient } from "../llm/deepseek-client.js";
import type { LlmJsonClient } from "../llm/types.js";
import { PocMonitoringAgent } from "../monitoring/poc-monitoring-agent.js";
import { NudgeDrafter } from "../monitoring/nudge-drafter.js";
import { PovLoopRunner } from "../monitoring/pov-loop-runner.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { HttpPostHogEventCaptureTool } from "../posthog/posthog-event-capture-tool.js";
import { PostHogMcpGateway } from "../posthog/posthog-mcp-gateway.js";
import { PostHogMcpUsageSnapshotTool } from "../posthog/posthog-mcp-usage-snapshot-tool.js";
import { PostHogMcpValidationTool } from "../posthog/posthog-mcp-validation-tool.js";
import { PostHogPocSetupAgent } from "../posthog/posthog-poc-setup-agent.js";
import { PostHogMcpSyntheticEventVerifier } from "../posthog/posthog-synthetic-event-verifier.js";
import { createPocStore, type PocStoreMode } from "../state/create-poc-store.js";
import type { PocStore } from "../state/types.js";
import {
  InMemoryApprovalTool,
  InMemoryEmailTool,
  InMemoryPostHogEventCaptureTool,
  InMemoryPostHogGateway,
  InMemoryPostHogUsageSnapshotTool,
  ResourceValidationTool,
} from "../tools/in-memory-tools.js";
import { StoreBackedAuditTool } from "../tools/store-backed-audit-tool.js";
import { createSecretsTool, type SecretsMode } from "../tools/create-secrets-tool.js";
import { GmailApiEmailTool } from "../tools/gmail-api-email-tool.js";
import { GmailMcpEmailTool, type GmailMcpGateway } from "../tools/gmail-mcp-email-tool.js";
import { GmailRemoteMcpGateway } from "../tools/gmail-remote-mcp-gateway.js";
import { TriggerApprovalTool } from "../tools/trigger-approval-tool.js";
import type {
  ApprovalTool,
  AuditTool,
  EmailTool,
  PostHogEventCaptureTool,
  PostHogSyntheticEventVerifier,
  PostHogToolGateway,
  PostHogUsageSnapshotTool,
  SecretsTool,
  ValidationTool,
} from "../tools/types.js";
import { LocalPocWorkflow } from "../workflow/local-poc-workflow.js";
import { loadConfig, type AppConfig } from "../config.js";

export type AgentSystem = {
  store: PocStore;
  llm: LlmJsonClient;
  orchestrator: Orchestrator;
  setupAgent: PostHogPocSetupAgent;
  monitoringAgent: PocMonitoringAgent;
  povLoopRunner: PovLoopRunner;
  workflow: LocalPocWorkflow;
  tools: {
    email: EmailTool;
    approval: ApprovalTool;
    audit: AuditTool;
    posthog: PostHogToolGateway;
    eventCapture: PostHogEventCaptureTool;
    syntheticEventVerifier?: PostHogSyntheticEventVerifier;
    usageSnapshot: PostHogUsageSnapshotTool;
    secrets: SecretsTool;
    validation: ValidationTool;
  };
};

export type CreateAgentSystemOptions = {
  config?: AppConfig;
  store?: PocStore;
  storeMode?: PocStoreMode;
  storePath?: string;
  env?: NodeJS.ProcessEnv;
  llm?: LlmJsonClient;
  email?: EmailTool;
  emailMode?: "local" | "gmail_mcp" | "gmail_api";
  gmailAccessTokenProvider?: () => string | undefined | Promise<string | undefined>;
  gmailMcpGateway?: GmailMcpGateway;
  approval?: ApprovalTool;
  approvalMode?: "trigger" | "local";
  audit?: AuditTool;
  posthog?: PostHogToolGateway;
  posthogMode?: "local" | "mcp";
  eventCapture?: PostHogEventCaptureTool;
  eventCaptureMode?: "local" | "posthog_http";
  syntheticEventVerifier?: PostHogSyntheticEventVerifier;
  usageSnapshot?: PostHogUsageSnapshotTool;
  usageSnapshotMode?: "local" | "posthog_mcp";
  secrets?: SecretsTool;
  secretsMode?: SecretsMode;
  validation?: ValidationTool;
  validationMode?: "local" | "posthog_mcp";
  clock?: () => Date;
  idGenerator?: () => string;
};

export function createAgentSystem(options: CreateAgentSystemOptions = {}): AgentSystem {
  const env = options.env ?? process.env;
  const config = options.config ?? (options.llm ? undefined : loadConfig());
  const clock = options.clock ?? (() => new Date());
  const emailMode = options.emailMode ?? emailModeFromEnv(env.EMAIL_MODE);
  const store =
    options.store ??
    createPocStore({
      storeMode: options.storeMode,
      storePath: options.storePath,
      env,
    });
  const llm =
    options.llm ??
    new DeepSeekClient({
      apiKey: requiredConfig(config).deepseek.apiKey,
      baseUrl: requiredConfig(config).deepseek.baseUrl,
    });
  const email =
    options.email ??
    (emailMode === "gmail_api"
      ? new GmailApiEmailTool({ env, clock, accessTokenProvider: options.gmailAccessTokenProvider })
      : emailMode === "gmail_mcp"
        ? new GmailMcpEmailTool({
            gateway:
              options.gmailMcpGateway ??
              new GmailRemoteMcpGateway({
                env,
                accessTokenProvider: options.gmailAccessTokenProvider,
              }),
            deliveryMode: gmailMcpDeliveryModeFromEnv(env.GMAIL_MCP_DELIVERY_MODE),
            clock,
          })
        : new InMemoryEmailTool({ clock }));
  const approval =
    options.approval ??
    (options.approvalMode === "local"
      ? new InMemoryApprovalTool({ clock })
      : new TriggerApprovalTool({ baseApprovalUrl: env.APPROVAL_BASE_URL }));
  const audit = options.audit ?? new StoreBackedAuditTool({ store, clock });
  const posthog =
    options.posthog ??
    (options.posthogMode === "mcp" || (!options.posthogMode && env.POSTHOG_MCP_API_KEY)
      ? new PostHogMcpGateway()
      : new InMemoryPostHogGateway());
  const shouldUseHttpEventCapture =
    options.eventCaptureMode === "posthog_http" ||
    (!options.eventCaptureMode && Boolean(env.POSTHOG_PROJECT_API_KEY));
  const eventCapture =
    options.eventCapture ??
    (shouldUseHttpEventCapture
      ? new HttpPostHogEventCaptureTool({ clock })
      : new InMemoryPostHogEventCaptureTool({ clock }));
  const syntheticEventVerifier =
    options.syntheticEventVerifier ??
    (env.POSTHOG_MCP_API_KEY ? new PostHogMcpSyntheticEventVerifier({ clock }) : undefined);
  const usageSnapshot =
    options.usageSnapshot ??
    (options.usageSnapshotMode === "posthog_mcp" ||
    (!options.usageSnapshotMode && env.POSTHOG_MCP_API_KEY)
      ? new PostHogMcpUsageSnapshotTool()
      : new InMemoryPostHogUsageSnapshotTool());
  const secrets = options.secrets ?? createSecretsTool({ mode: options.secretsMode, clock });
  const validation =
    options.validation ??
    (options.validationMode === "posthog_mcp" ||
    (!options.validationMode && env.POSTHOG_MCP_API_KEY)
      ? new PostHogMcpValidationTool({ clock })
      : new ResourceValidationTool({ clock }));
  const handoffGenerator = new HandoffGenerator();

  const orchestrator = new Orchestrator({
    store,
    llm,
    email,
    approval,
    audit,
    defaultStructuredHints: defaultStructuredHintsFromEnv(env),
    clock,
    idGenerator: options.idGenerator,
  });
  const setupAgent = new PostHogPocSetupAgent({
    posthog,
    secrets,
    validation,
    eventCapture,
    syntheticEventVerifier,
    llm,
    audit,
    clock,
  });
  const monitoringAgent = new PocMonitoringAgent({
    store,
    usageSnapshotTool: usageSnapshot,
    audit,
    clock,
  });
  const povLoopRunner = new PovLoopRunner({
    store,
    monitoringAgent,
    nudgeDrafter: new NudgeDrafter({ llm }),
    approval,
    email,
    operatorEmails: operatorEmailsFromEnv(env),
    cooldownHours: nudgeCooldownHoursFromEnv(env),
    clock,
  });
  const workflow = new LocalPocWorkflow({
    store,
    setupAgent,
    monitoringAgent,
    handoffGenerator,
    email,
    audit,
    replyProcessor: orchestrator,
    clock,
  });

  return {
    store,
    llm,
    orchestrator,
    setupAgent,
    monitoringAgent,
    povLoopRunner,
    workflow,
    tools: {
      email,
      approval,
      audit,
      posthog,
      eventCapture,
      syntheticEventVerifier,
      usageSnapshot,
      secrets,
      validation,
    },
  };
}

function requiredConfig(config: AppConfig | undefined): AppConfig {
  if (!config) {
    throw new Error("App config is required when no LLM client is injected");
  }
  return config;
}

function emailModeFromEnv(
  value: string | undefined,
): "local" | "gmail_mcp" | "gmail_api" | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === "gmail_api") {
    return "gmail_api";
  }
  if (normalized === "gmail_mcp") {
    return "gmail_mcp";
  }
  if (normalized === "local") {
    return "local";
  }
  return undefined;
}

function gmailMcpDeliveryModeFromEnv(value: string | undefined): "draft" | "send" {
  return value?.toLowerCase() === "send" ? "send" : "draft";
}

function operatorEmailsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OPERATOR_EMAILS;
  const parsed = raw
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parsed && parsed.length ? parsed : ["solutions-engineer@poc-pilot.local"];
}

function defaultStructuredHintsFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const posthogContext: Record<string, unknown> = {};
  if (env.POSTHOG_ORGANIZATION_ID) {
    posthogContext.organizationId = env.POSTHOG_ORGANIZATION_ID;
  }
  if (env.POSTHOG_ORGANIZATION_NAME) {
    posthogContext.organizationName = env.POSTHOG_ORGANIZATION_NAME;
  }
  if (env.POSTHOG_PROJECT_ID) {
    posthogContext.projectId = env.POSTHOG_PROJECT_ID;
    posthogContext.useExistingProject = true;
  }
  if (env.POSTHOG_PROJECT_NAME) {
    posthogContext.projectName = env.POSTHOG_PROJECT_NAME;
  }
  if (env.POSTHOG_REGION) {
    posthogContext.region = env.POSTHOG_REGION;
  }

  const appContext: Record<string, unknown> = {};
  const platform = env.POSTHOG_DEFAULT_PLATFORM ?? (env.POSTHOG_PROJECT_ID ? "web" : undefined);
  if (platform) {
    appContext.platform = commaSeparated(platform);
  }
  if (env.POSTHOG_DEFAULT_APP_NAME) {
    appContext.appName = env.POSTHOG_DEFAULT_APP_NAME;
  }
  if (env.POSTHOG_DEFAULT_APP_URL) {
    appContext.appUrl = env.POSTHOG_DEFAULT_APP_URL;
  }
  if (env.POSTHOG_DEFAULT_ENVIRONMENTS) {
    appContext.environments = commaSeparated(env.POSTHOG_DEFAULT_ENVIRONMENTS);
  }

  const analyticsScope: Record<string, unknown> = {};
  if (env.POSTHOG_DEFAULT_EVENTS) {
    analyticsScope.events = commaSeparated(env.POSTHOG_DEFAULT_EVENTS).map((name) => ({
      name,
      description: name,
      required: false,
      source: "agent_inferred",
    }));
  }

  return {
    ...(Object.keys(posthogContext).length ? { posthogContext } : {}),
    ...(Object.keys(appContext).length ? { appContext } : {}),
    ...(Object.keys(analyticsScope).length ? { analyticsScope } : {}),
  };
}

function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function nudgeCooldownHoursFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const value = Number(env.POV_NUDGE_COOLDOWN_HOURS);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
