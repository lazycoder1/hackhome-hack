import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createHttpApiServer } from "./http-server.js";
import { TriggerWorkflowClient } from "../workflow/trigger-workflow-client.js";
import { LocalWorkflowApi } from "../workflow/local-workflow-api.js";
import { IntervalTicker } from "../workflow/interval-ticker.js";
import { NudgeApprovalService } from "../workflow/nudge-approval-service.js";
import type { WorkflowApi } from "../workflow/workflow-api.js";
import { createAgentSystem } from "../app/create-agent-system.js";
import { createPocStore } from "../state/create-poc-store.js";
import type { PocStore } from "../state/types.js";
import { PocStatusReader } from "../status/poc-status-reader.js";
import { createSecretsTool } from "../tools/create-secrets-tool.js";
import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import type { EmailTool } from "../tools/types.js";
import { GmailApiEmailTool } from "../tools/gmail-api-email-tool.js";
import { isRailwayRuntime } from "../runtime/railway-runtime.js";
import { createInboxGateway } from "../app/create-trigger-system.js";
import { GmailInboxMonitor } from "../workflow/gmail-inbox-monitor.js";

export function startHttpServer(
  options: {
    port?: number;
    host?: string;
  } = {},
) {
  loadDotenv();

  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? (isRailwayRuntime() ? "0.0.0.0" : "127.0.0.1");
  const googleOAuth = new GoogleOAuthTestService();

  // WORKFLOW_MODE=local runs the full flow in-process (real results, no Trigger deploy needed);
  // default "trigger" dispatches to Trigger.dev workers. In local mode the workflow and the
  // status reader share one store so reads reflect what the in-process workflow just wrote.
  let workflow: WorkflowApi;
  let store: PocStore;
  let googleTestEmail: EmailTool | undefined;
  let googleApiDraftEmail: GmailApiEmailTool | undefined;
  let nudges: NudgeApprovalService | undefined;
  if ((process.env.WORKFLOW_MODE ?? "trigger").toLowerCase() === "local") {
    const system = createAgentSystem({
      approvalMode: "local",
      gmailAccessTokenProvider: () => googleOAuth.freshAccessToken(),
    });
    workflow = new LocalWorkflowApi(system);
    store = system.store;
    googleTestEmail = system.tools.email;
    googleApiDraftEmail = new GmailApiEmailTool({
      accessTokenProvider: () => googleOAuth.freshAccessToken(),
      fromProvider: () => googleOAuth.status().email,
    });
    nudges = new NudgeApprovalService({
      store: system.store,
      email: system.tools.email,
      approval: system.tools.approval,
    });

    // Always-on loop for local mode: the in-process mirror of the Trigger.dev schedule.
    // Set POV_TICK_INTERVAL_MS to enable (e.g. 60000 for a 60s heartbeat).
    const tickIntervalMs = Number(process.env.POV_TICK_INTERVAL_MS);
    if (Number.isFinite(tickIntervalMs) && tickIntervalMs > 0) {
      new IntervalTicker({
        store: system.store,
        runner: system.povLoopRunner,
        intervalMs: tickIntervalMs,
        log: (message) => console.log(`[pov-loop] ${message}`),
        onError: (error, pocId) =>
          console.error(`[pov-loop] tick error${pocId ? ` for ${pocId}` : ""}: ${error.message}`),
      }).start();
    }
  } else {
    workflow = new TriggerWorkflowClient();
    store = createPocStore();
  }

  const statusReader = new PocStatusReader(store);
  startGmailInboxPoller({
    workflow,
    statusReader,
    googleOAuth,
  });

  const server = createHttpApiServer({
    workflow,
    statusReader,
    secrets: createSecretsTool(),
    googleOAuth,
    googleTestEmail,
    googleApiDraftEmail,
    nudges,
  });

  server.listen(port, host, () => {
    console.log(`PostHog PoC automation API listening on http://${host}:${port}`);
  });

  return server;
}

function startGmailInboxPoller(input: {
  workflow: WorkflowApi;
  statusReader: PocStatusReader;
  googleOAuth: GoogleOAuthTestService;
}): void {
  const intervalMs = gmailInboxPollIntervalMs();
  if (!intervalMs) {
    return;
  }

  const monitor = new GmailInboxMonitor({
    gateway: createInboxGateway(() => input.googleOAuth.freshAccessToken()),
    workflow: input.workflow,
    pocStatus: input.statusReader,
    ownEmailProvider: () => input.googleOAuth.status().email,
  });
  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await monitor.monitor({
        query: process.env.GMAIL_INBOX_QUERY,
        maxThreads: maxGmailThreadsFromEnv(),
        processedLabelIds: processedGmailLabelIdsFromEnv(),
      });
      console.log(
        `[gmail-inbox] searched=${result.searchedThreads} processed=${result.processedMessages} skipped=${result.skippedMessages} labeled=${result.labeledThreads}`,
      );
    } catch (error) {
      console.error(`[gmail-inbox] poll error: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  console.log(`[gmail-inbox] poller started (every ${Math.round(intervalMs / 1000)}s)`);
  void tick();
}

function gmailInboxPollIntervalMs(): number | undefined {
  const raw = process.env.GMAIL_INBOX_POLL_INTERVAL_MS;
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function maxGmailThreadsFromEnv(): number | undefined {
  const value = Number(process.env.GMAIL_INBOX_MAX_THREADS);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 50) : undefined;
}

function processedGmailLabelIdsFromEnv(): string[] | undefined {
  const labels = (process.env.GMAIL_PROCESSED_LABEL_IDS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  return labels.length ? labels : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
