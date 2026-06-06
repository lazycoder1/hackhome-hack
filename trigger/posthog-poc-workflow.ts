import { task, wait } from "@trigger.dev/sdk";
import { createInboxGateway, createTriggerSystem } from "../src/app/create-trigger-system.js";
import type { SubmitRequirementsBlobInput } from "../src/orchestrator/orchestrator.js";
import { PocStatusReader } from "../src/status/poc-status-reader.js";
import { GmailInboxMonitor } from "../src/workflow/gmail-inbox-monitor.js";

type ApprovalDecision = {
  decision: "approved" | "rejected" | "needs_changes";
  decidedBy: string;
  notes?: string;
  changes?: string[];
};

type SetupApprovedPayload = {
  pocId: string;
  approvedBy: string;
  approvalSource: "email_reply" | "approval_link" | "internal_operator";
};

type MonitorActivePocPayload = {
  pocId: string;
  window?: {
    from: string;
    to: string;
  };
};

type RetryPocStagePayload = {
  pocId: string;
  stage: "setup" | "handoff";
  requestedBy?: string;
};

type MonitorGmailInboxPayload = {
  query?: string;
  maxThreads?: number;
  pocId?: string;
  processedLabelIds?: string[];
};

export const setupApprovedPosthogPocTask = task({
  id: "setup-approved-posthog-poc",
  run: async (payload: SetupApprovedPayload) => {
    const { system } = createTriggerSystem();

    return await system.workflow.approveAndRunSetup(payload);
  },
});

export const processPosthogPocEmailReplyTask = task({
  id: "process-posthog-poc-email-reply",
  run: async (payload: {
    pocId: string;
    message: {
      id: string;
      threadId: string;
      from: string;
      to: string[];
      subject: string;
      textBody: string;
      receivedAt: string;
    };
  }) => {
    const { system } = createTriggerSystem();

    return await system.workflow.processEmailReply(payload);
  },
});

export const monitorActivePosthogPocTask = task({
  id: "monitor-active-posthog-poc",
  run: async (payload: MonitorActivePocPayload) => {
    const { system } = createTriggerSystem();

    return await system.workflow.monitorActivePoc(payload);
  },
});

export const retryPosthogPocStageTask = task({
  id: "retry-posthog-poc-stage",
  run: async (payload: RetryPocStagePayload) => {
    const { system } = createTriggerSystem();

    return await system.workflow.retryPocStage(payload);
  },
});

export const monitorGmailInboxTask = task({
  id: "monitor-gmail-inbox",
  run: async (payload: MonitorGmailInboxPayload = {}) => {
    const { system, gmailToken } = createTriggerSystem();
    const monitor = new GmailInboxMonitor({
      gateway: createInboxGateway(gmailToken),
      workflow: system.workflow,
      pocStatus: new PocStatusReader(system.store),
    });

    return await monitor.monitor({
      query: payload.query ?? process.env.GMAIL_INBOX_QUERY,
      maxThreads: payload.maxThreads ?? maxThreadsFromEnv(),
      pocId: payload.pocId,
      processedLabelIds: payload.processedLabelIds ?? processedLabelIdsFromEnv(),
    });
  },
});

export const posthogPocWorkflowTask = task({
  id: "posthog-poc-workflow",
  run: async (payload: SubmitRequirementsBlobInput) => {
    const { system } = createTriggerSystem();

    const intake = await system.orchestrator.submitRequirementsBlob(payload);
    if (intake.status === "needs_clarification" || !intake.approvalTokenId) {
      return intake;
    }

    let approval = await wait.forToken<ApprovalDecision>(intake.approvalTokenId).unwrap();

    while (approval.decision === "needs_changes") {
      const revision = await system.orchestrator.revisePlanFromChanges({
        pocId: intake.pocId,
        changes: approval.changes ?? [],
        requestedBy: approval.decidedBy,
      });
      approval = await wait.forToken<ApprovalDecision>(revision.approvalTokenId).unwrap();
    }

    if (approval.decision === "approved") {
      return await system.workflow.approveAndRunSetup({
        pocId: intake.pocId,
        approvedBy: approval.decidedBy,
        approvalSource: "approval_link",
      });
    }

    const now = new Date().toISOString();
    await system.store.updateStatus(
      intake.pocId,
      approval.decision === "rejected" ? "rejected" : "needs_clarification",
      now,
    );

    return {
      pocId: intake.pocId,
      status: approval.decision,
      changes: approval.changes ?? [],
    };
  },
});

function processedLabelIdsFromEnv(): string[] | undefined {
  const raw = process.env.GMAIL_PROCESSED_LABEL_IDS;
  if (!raw) {
    return undefined;
  }

  const labels = raw
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  return labels.length ? labels : undefined;
}

function maxThreadsFromEnv(): number | undefined {
  const value = Number(process.env.GMAIL_INBOX_MAX_THREADS);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 50) : undefined;
}
