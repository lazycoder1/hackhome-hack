import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createHttpApiServer } from "./http-server.js";
import { TriggerWorkflowClient } from "../workflow/trigger-workflow-client.js";
import { LocalWorkflowApi } from "../workflow/local-workflow-api.js";
import type { WorkflowApi } from "../workflow/workflow-api.js";
import { createAgentSystem } from "../app/create-agent-system.js";
import { createPocStore } from "../state/create-poc-store.js";
import type { PocStore } from "../state/types.js";
import { PocStatusReader } from "../status/poc-status-reader.js";
import { createSecretsTool } from "../tools/create-secrets-tool.js";
import { GoogleOAuthTestService } from "../integrations/google-oauth-test-service.js";
import type { EmailTool } from "../tools/types.js";
import { GmailApiEmailTool } from "../tools/gmail-api-email-tool.js";

export function startHttpServer(
  options: {
    port?: number;
    host?: string;
  } = {},
) {
  loadDotenv();

  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const googleOAuth = new GoogleOAuthTestService();

  // WORKFLOW_MODE=local runs the full flow in-process (real results, no Trigger deploy needed);
  // default "trigger" dispatches to Trigger.dev workers. In local mode the workflow and the
  // status reader share one store so reads reflect what the in-process workflow just wrote.
  let workflow: WorkflowApi;
  let store: PocStore;
  let googleTestEmail: EmailTool | undefined;
  let googleApiDraftEmail: GmailApiEmailTool | undefined;
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
  } else {
    workflow = new TriggerWorkflowClient();
    store = createPocStore();
  }

  const server = createHttpApiServer({
    workflow,
    statusReader: new PocStatusReader(store),
    secrets: createSecretsTool(),
    googleOAuth,
    googleTestEmail,
    googleApiDraftEmail,
  });

  server.listen(port, host, () => {
    console.log(`PostHog PoC automation API listening on http://${host}:${port}`);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
