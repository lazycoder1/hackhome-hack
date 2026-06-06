import type { ApprovalTool } from "./types.js";

export type TriggerWaitApi = {
  createToken(input: { timeout: string; idempotencyKey: string; tags: string[] }): Promise<{
    id: string;
    url?: string;
    publicAccessToken?: string;
    timeoutAt?: Date;
  }>;
  completeToken<TOutput>(tokenId: string, output: TOutput): Promise<{ success: boolean }>;
};

export type TriggerApprovalToolOptions = {
  waitApi?: TriggerWaitApi;
  baseApprovalUrl?: string;
};

export class TriggerApprovalTool implements ApprovalTool {
  private readonly waitApi?: TriggerWaitApi;
  private readonly baseApprovalUrl?: string;

  constructor(options: TriggerApprovalToolOptions = {}) {
    this.waitApi = options.waitApi;
    this.baseApprovalUrl = options.baseApprovalUrl ?? process.env.APPROVAL_BASE_URL;
  }

  async createApprovalWaitpoint(input: {
    pocId: string;
    timeout: string;
    approverEmails: string[];
    idempotencyKey: string;
  }): Promise<{ tokenId: string; publicApprovalUrl: string; expiresAt: string }> {
    const waitApi = await this.getWaitApi();
    const token = await waitApi.createToken({
      timeout: input.timeout,
      idempotencyKey: input.idempotencyKey,
      tags: [`poc:${input.pocId}`, "product:posthog", "stage:approval"],
    });

    return {
      tokenId: token.id,
      publicApprovalUrl: this.approvalUrl(token),
      expiresAt: token.timeoutAt?.toISOString() ?? "",
    };
  }

  async completeApprovalWaitpoint(input: {
    tokenId: string;
    decision: "approved" | "rejected" | "needs_changes";
    decidedBy: string;
    notes?: string;
    changes?: string[];
  }): Promise<{ success: boolean }> {
    const waitApi = await this.getWaitApi();
    return await waitApi.completeToken(input.tokenId, {
      decision: input.decision,
      decidedBy: input.decidedBy,
      notes: input.notes,
      changes: input.changes,
    });
  }

  private approvalUrl(token: { id: string; url?: string; publicAccessToken?: string }): string {
    if (this.baseApprovalUrl && token.publicAccessToken) {
      const url = new URL(this.baseApprovalUrl);
      url.searchParams.set("tokenId", token.id);
      url.searchParams.set("publicAccessToken", token.publicAccessToken);
      return url.toString();
    }

    return token.url ?? token.id;
  }

  private async getWaitApi(): Promise<TriggerWaitApi> {
    if (this.waitApi) {
      return this.waitApi;
    }

    const sdk = await import("@trigger.dev/sdk");
    return sdk.wait;
  }
}
