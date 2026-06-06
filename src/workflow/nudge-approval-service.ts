import type { ActivityEvent } from "../contracts.js";
import type { PocStore } from "../state/types.js";
import type { ApprovalTool, EmailTool } from "../tools/types.js";

/**
 * Completes a monitoring-driven nudge that the loop queued for SE approval (the back half of the
 * gate). On approve it actually sends the drafted email to the customer and records `email_sent`;
 * on reject it records the decision. Either way it completes the underlying approval waitpoint.
 * Idempotent: a second decision on the same token is a no-op.
 */
export type NudgeDecisionInput = {
  pocId: string;
  tokenId: string;
  decision: "approved" | "rejected";
  editedBody?: string;
  decidedBy?: string;
};

export type NudgeDecisionResult = {
  status: "sent" | "rejected" | "not_found" | "already_decided";
  emailId?: string;
};

export class NudgeApprovalService {
  private readonly store: PocStore;
  private readonly email: EmailTool;
  private readonly approval: ApprovalTool;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(options: {
    store: PocStore;
    email: EmailTool;
    approval: ApprovalTool;
    clock?: () => Date;
    idGenerator?: () => string;
  }) {
    this.store = options.store;
    this.email = options.email;
    this.approval = options.approval;
    this.clock = options.clock ?? (() => new Date());
    let counter = 0;
    this.newId =
      options.idGenerator ??
      (() => `evt_${this.clock().getTime().toString(36)}_${(counter++).toString(36)}`);
  }

  async complete(input: NudgeDecisionInput): Promise<NudgeDecisionResult> {
    const events = await this.store.listActivityEvents(input.pocId, { limit: 300 });
    const gated = events.find(
      (event) => event.kind === "action_gated" && event.refs?.approvalTokenId === input.tokenId,
    );
    if (!gated) {
      return { status: "not_found" };
    }
    const alreadyDecided = events.some(
      (event) =>
        (event.kind === "email_sent" || event.kind === "nudge_decision") &&
        event.refs?.approvalTokenId === input.tokenId,
    );
    if (alreadyDecided) {
      return { status: "already_decided" };
    }

    if (input.decision === "approved") {
      const payload = gated.payload ?? {};
      const recipients = Array.isArray(payload.recipients) ? (payload.recipients as string[]) : [];
      const subject = String(payload.subject ?? "Your PoC check-in");
      const markdownBody = input.editedBody ?? String(payload.markdownBody ?? "");
      const sent = await this.email.sendEmail({
        to: recipients,
        subject,
        markdownBody,
        tags: ["pov:nudge", `poc:${input.pocId}`],
      });
      await this.record(input.pocId, {
        kind: "email_sent",
        actor: "human",
        status: "sent",
        cadenceKey: gated.cadenceKey,
        summary: `Nudge approved by ${input.decidedBy ?? "the SE"} and sent to ${recipients.join(", ") || "customer"}: "${subject}"`,
        refs: { emailId: sent.emailId, approvalTokenId: input.tokenId },
        payload: { recipients, subject },
      });
      await this.tryCompleteWaitpoint(input, "approved");
      return { status: "sent", emailId: sent.emailId };
    }

    await this.record(input.pocId, {
      kind: "nudge_decision",
      actor: "human",
      status: "skipped",
      cadenceKey: gated.cadenceKey,
      summary: `Drafted nudge rejected by ${input.decidedBy ?? "the SE"} — not sent.`,
      refs: { approvalTokenId: input.tokenId },
    });
    await this.tryCompleteWaitpoint(input, "rejected");
    return { status: "rejected" };
  }

  private async record(
    pocId: string,
    event: Omit<ActivityEvent, "id" | "pocId" | "ts">,
  ): Promise<void> {
    await this.store.saveActivityEvent({
      id: this.newId(),
      pocId,
      ts: this.clock().toISOString(),
      ...event,
    });
  }

  private async tryCompleteWaitpoint(
    input: NudgeDecisionInput,
    decision: "approved" | "rejected",
  ): Promise<void> {
    try {
      await this.approval.completeApprovalWaitpoint({
        tokenId: input.tokenId,
        decision,
        decidedBy: input.decidedBy ?? "se@poc-pilot.local",
      });
    } catch {
      // Waitpoint may be unknown to this approval backend (e.g. trigger-created token in local
      // mode); the activity record above is the source of truth for the UI.
    }
  }
}
