import type { SubmitRequirementsBlobInput } from "../orchestrator/orchestrator.js";
import type { ApprovalCompletionInput, WorkflowApi } from "./workflow-api.js";

type TriggerableTask<TPayload> = {
  trigger(
    payload: TPayload,
    options?: { tags?: string[] },
  ): Promise<{
    id: string;
  }>;
};

export type TriggerWorkflowClientOptions = {
  posthogPocWorkflowTask?: TriggerableTask<SubmitRequirementsBlobInput>;
  processEmailReplyTask?: TriggerableTask<Parameters<WorkflowApi["processEmailReply"]>[0]>;
  monitorActivePocTask?: TriggerableTask<Parameters<WorkflowApi["monitorActivePoc"]>[0]>;
  retryPocStageTask?: TriggerableTask<Parameters<WorkflowApi["retryPocStage"]>[0]>;
  fetchImpl?: typeof fetch;
};

export class TriggerWorkflowClient implements WorkflowApi {
  private readonly task?: TriggerableTask<SubmitRequirementsBlobInput>;
  private readonly processEmailReplyTask?: TriggerableTask<
    Parameters<WorkflowApi["processEmailReply"]>[0]
  >;
  private readonly monitorActivePocTask?: TriggerableTask<
    Parameters<WorkflowApi["monitorActivePoc"]>[0]
  >;
  private readonly retryPocStageTask?: TriggerableTask<Parameters<WorkflowApi["retryPocStage"]>[0]>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TriggerWorkflowClientOptions = {}) {
    this.task = options.posthogPocWorkflowTask;
    this.processEmailReplyTask = options.processEmailReplyTask;
    this.monitorActivePocTask = options.monitorActivePocTask;
    this.retryPocStageTask = options.retryPocStageTask;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async startPosthogPocWorkflow(input: SubmitRequirementsBlobInput): Promise<{ runId: string }> {
    const task = await this.getTask();
    const run = await task.trigger(input, {
      tags: ["product:posthog", "stage:intake"],
    });

    return { runId: run.id };
  }

  async completeApproval(input: ApprovalCompletionInput): Promise<{ success: boolean }> {
    const response = await this.fetchImpl(
      `https://api.trigger.dev/api/v1/waitpoints/tokens/${input.tokenId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.publicAccessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: {
            decision: input.decision,
            decidedBy: input.decidedBy,
            notes: input.notes,
            changes: input.changes,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to complete Trigger waitpoint token: ${response.status}`);
    }

    return { success: true };
  }

  async processEmailReply(
    input: Parameters<WorkflowApi["processEmailReply"]>[0],
  ): ReturnType<WorkflowApi["processEmailReply"]> {
    const task = await this.getProcessEmailReplyTask();
    const run = await task.trigger(input, {
      tags: [`poc:${input.pocId}`, "product:posthog", "stage:inbound-email"],
    });

    return {
      intent: "unclear",
      completedApproval: false,
      requiresSetup: false,
      changes: [`Triggered email reply processing run ${run.id}`],
    };
  }

  async monitorActivePoc(
    input: Parameters<WorkflowApi["monitorActivePoc"]>[0],
  ): ReturnType<WorkflowApi["monitorActivePoc"]> {
    const task = await this.getMonitorActivePocTask();
    const run = await task.trigger(input, {
      tags: [`poc:${input.pocId}`, "product:posthog", "stage:monitoring"],
    });

    return {
      pocId: input.pocId,
      planVersion: 0,
      runId: run.id,
      checkedAt: new Date().toISOString(),
      window: input.window ?? {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      },
      status: "unknown",
      riskLevel: "medium",
      usageSummary: {
        hasRealCustomerActivity: false,
        syntheticOnly: false,
      },
      eventProgress: [],
      successCriteriaProgress: [],
      planDrift: {
        missingExpectedEvents: [],
        unexpectedObservedEvents: [],
        notes: [`Triggered monitoring run ${run.id}`],
      },
      recommendedActions: [],
    };
  }

  async retryPocStage(
    input: Parameters<WorkflowApi["retryPocStage"]>[0],
  ): ReturnType<WorkflowApi["retryPocStage"]> {
    const task = await this.getRetryPocStageTask();
    await task.trigger(input, {
      tags: [`poc:${input.pocId}`, "product:posthog", `stage:retry-${input.stage}`],
    });

    return {
      pocId: input.pocId,
      stage: input.stage,
      status: "setup_queued",
    };
  }

  private async getTask(): Promise<TriggerableTask<SubmitRequirementsBlobInput>> {
    if (this.task) {
      return this.task;
    }

    const module = await import("../../trigger/posthog-poc-workflow.js");
    return module.posthogPocWorkflowTask;
  }

  private async getProcessEmailReplyTask(): Promise<
    TriggerableTask<Parameters<WorkflowApi["processEmailReply"]>[0]>
  > {
    if (this.processEmailReplyTask) {
      return this.processEmailReplyTask;
    }

    const module = await import("../../trigger/posthog-poc-workflow.js");
    return module.processPosthogPocEmailReplyTask;
  }

  private async getMonitorActivePocTask(): Promise<
    TriggerableTask<Parameters<WorkflowApi["monitorActivePoc"]>[0]>
  > {
    if (this.monitorActivePocTask) {
      return this.monitorActivePocTask;
    }

    const module = await import("../../trigger/posthog-poc-workflow.js");
    return module.monitorActivePosthogPocTask;
  }

  private async getRetryPocStageTask(): Promise<
    TriggerableTask<Parameters<WorkflowApi["retryPocStage"]>[0]>
  > {
    if (this.retryPocStageTask) {
      return this.retryPocStageTask;
    }

    const module = await import("../../trigger/posthog-poc-workflow.js");
    return module.retryPosthogPocStageTask;
  }
}
