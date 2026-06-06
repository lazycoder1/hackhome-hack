import type { AgentSystem } from "../app/create-agent-system.js";
import type { SubmitRequirementsBlobInput } from "../orchestrator/orchestrator.js";
import type { ApprovalCompletionInput, WorkflowApi } from "./workflow-api.js";
import type { InboundEmailMessage, PocMonitoringReport } from "../contracts.js";

/**
 * In-process {@link WorkflowApi} backed by the real agent system. Lets the HTTP server run the
 * full orchestrator → setup → monitoring flow locally (WORKFLOW_MODE=local) without a Trigger.dev
 * deploy, returning real results instead of the async-dispatch placeholders TriggerWorkflowClient
 * returns. Intended for local demos.
 */
export class LocalWorkflowApi implements WorkflowApi {
  constructor(private readonly system: AgentSystem) {}

  async startPosthogPocWorkflow(input: SubmitRequirementsBlobInput): Promise<{ runId: string }> {
    const intake = await this.system.orchestrator.submitRequirementsBlob(input);
    return { runId: intake.pocId };
  }

  async completeApproval(input: ApprovalCompletionInput): Promise<{ success: boolean }> {
    const pocId = await this.findPocIdByToken(input.tokenId);
    if (!pocId) {
      throw new Error(`No PoC found for approval token ${input.tokenId}`);
    }

    if (input.decision === "approved") {
      await this.system.workflow.approveAndRunSetup({
        pocId,
        approvedBy: input.decidedBy,
        approvalSource: "approval_link",
      });
    } else if (input.decision === "needs_changes") {
      await this.system.orchestrator.revisePlanFromChanges({
        pocId,
        changes: input.changes ?? [],
        requestedBy: input.decidedBy,
      });
    } else {
      await this.system.store.updateStatus(pocId, "rejected", new Date().toISOString());
    }

    return { success: true };
  }

  processEmailReply(input: {
    pocId: string;
    message: InboundEmailMessage;
  }): ReturnType<WorkflowApi["processEmailReply"]> {
    return this.system.workflow.processEmailReply(input);
  }

  monitorActivePoc(input: {
    pocId: string;
    window?: { from: string; to: string };
  }): Promise<PocMonitoringReport> {
    return this.system.workflow.monitorActivePoc(input);
  }

  retryPocStage(input: Parameters<WorkflowApi["retryPocStage"]>[0]) {
    return this.system.workflow.retryPocStage(input);
  }

  /** Resolve a Trigger-style approval token to its PoC via the stored `approvalTokenId`. */
  private async findPocIdByToken(tokenId: string): Promise<string | undefined> {
    const pocs = await this.system.store.listPocs({ limit: 200 });
    return pocs.find((poc) => poc.approvalTokenId === tokenId)?.pocId;
  }
}
