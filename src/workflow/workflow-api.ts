import type { SubmitRequirementsBlobInput } from "../orchestrator/orchestrator.js";
import type {
  CustomerReplyClassification,
  InboundEmailMessage,
  PocLifecycleStatus,
  PocMonitoringReport,
  SetupResult,
} from "../contracts.js";

export type ApprovalCompletionInput = {
  tokenId: string;
  publicAccessToken: string;
  decision: "approved" | "rejected" | "needs_changes";
  decidedBy: string;
  notes?: string;
  changes?: string[];
};

export type RetryPocStageInput = {
  pocId: string;
  stage: "setup" | "handoff";
  requestedBy?: string;
};

export type RetryPocStageResult = {
  pocId: string;
  stage: RetryPocStageInput["stage"];
  status: PocLifecycleStatus;
  setupStatus?: SetupResult["status"];
  handoffEmailId?: string;
  handoffThreadId?: string;
};

export type UpdatePocStatusInput = {
  pocId: string;
  status: PocLifecycleStatus;
  requestedBy?: string;
  note?: string;
};

export type WorkflowApi = {
  startPosthogPocWorkflow(input: SubmitRequirementsBlobInput): Promise<{ runId: string }>;
  completeApproval(input: ApprovalCompletionInput): Promise<{ success: boolean }>;
  processEmailReply(input: { pocId: string; message: InboundEmailMessage }): Promise<{
    intent: CustomerReplyClassification["intent"];
    completedApproval: boolean;
    requiresSetup: boolean;
    requiresDashboardRevision?: boolean;
    changes: string[];
  }>;
  monitorActivePoc(input: {
    pocId: string;
    window?: {
      from: string;
      to: string;
    };
  }): Promise<PocMonitoringReport>;
  retryPocStage(input: RetryPocStageInput): Promise<RetryPocStageResult>;
  updatePocStatus(input: UpdatePocStatusInput): Promise<{
    pocId: string;
    status: PocLifecycleStatus;
  }>;
};
