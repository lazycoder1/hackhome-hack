import type { WorkflowApi } from "./workflow-api.js";
import { normalizeGmailMcpInboundEmail } from "../tools/gmail-mcp-inbound-normalizer.js";
import type { GmailMcpGateway, GmailMcpMessage } from "../tools/gmail-mcp-email-tool.js";
import type { PocStatusReadApi } from "../status/poc-status-reader.js";
import type { PocLifecycleStatus } from "../contracts.js";

const DEFAULT_GMAIL_INBOX_QUERY = "in:inbox newer_than:7d -in:draft";
const DEFAULT_MAX_THREADS = 10;

export type GmailInboxMonitorInput = {
  query?: string;
  maxThreads?: number;
  pocId?: string;
  processedLabelIds?: string[];
};

export type GmailInboxMonitorResult = {
  searchedThreads: number;
  processedMessages: number;
  skippedMessages: number;
  labeledThreads: number;
};

export type GmailInboxMonitorOptions = {
  gateway: GmailMcpGateway;
  workflow: Pick<WorkflowApi, "processEmailReply">;
  pocStatus?: Pick<PocStatusReadApi, "list" | "detail">;
  ownEmailProvider?: () => string | undefined;
};

export class GmailInboxMonitor {
  private readonly gateway: GmailMcpGateway;
  private readonly workflow: Pick<WorkflowApi, "processEmailReply">;
  private readonly pocStatus?: Pick<PocStatusReadApi, "list" | "detail">;
  private readonly ownEmailProvider?: () => string | undefined;
  private readonly processedMessageIds = new Set<string>();

  constructor(options: GmailInboxMonitorOptions) {
    this.gateway = options.gateway;
    this.workflow = options.workflow;
    this.pocStatus = options.pocStatus;
    this.ownEmailProvider = options.ownEmailProvider;
  }

  async monitor(input: GmailInboxMonitorInput): Promise<GmailInboxMonitorResult> {
    const search = await this.gateway.searchThreads({
      query: input.query ?? DEFAULT_GMAIL_INBOX_QUERY,
      pageSize: input.maxThreads ?? DEFAULT_MAX_THREADS,
    });

    let processedMessages = 0;
    let skippedMessages = 0;
    let labeledThreads = 0;

    for (const searchThread of search.threads) {
      const thread = await this.gateway.getThread({
        threadId: searchThread.id,
        messageFormat: "FULL_CONTENT",
      });
      let processedThreadMessages = 0;
      const threadPocId = input.pocId ?? (await this.resolvePocIdFromConfirmationThread(thread.id));

      for (const message of thread.messages) {
        const messageId = typeof message.id === "string" ? message.id : undefined;
        if (messageId && this.processedMessageIds.has(messageId)) {
          skippedMessages += 1;
          continue;
        }
        const normalized = safeNormalizeMessage({
          pocId: threadPocId,
          threadId: thread.id,
          message,
        });
        if (!normalized) {
          skippedMessages += 1;
          continue;
        }

        if (!(await this.isExpectedCustomerReply(normalized.pocId, normalized.message.from))) {
          skippedMessages += 1;
          continue;
        }

        try {
          await this.workflow.processEmailReply(normalized);
          if (messageId) {
            this.processedMessageIds.add(messageId);
          }
          processedMessages += 1;
          processedThreadMessages += 1;
        } catch {
          skippedMessages += 1;
        }
      }

      if (
        processedThreadMessages > 0 &&
        this.gateway.labelThread &&
        input.processedLabelIds?.length
      ) {
        await this.gateway.labelThread({
          threadId: thread.id,
          labelIds: input.processedLabelIds,
        });
        labeledThreads += 1;
      }
    }

    return {
      searchedThreads: search.threads.length,
      processedMessages,
      skippedMessages,
      labeledThreads,
    };
  }

  private async resolvePocIdFromConfirmationThread(threadId: string): Promise<string | undefined> {
    if (!this.pocStatus) return undefined;
    const { pocs } = await this.pocStatus.list({ limit: 200 });
    return pocs.find((poc) => poc.confirmationThreadId === threadId)?.pocId;
  }

  private async isExpectedCustomerReply(pocId: string | undefined, from: string): Promise<boolean> {
    const ownEmail = this.ownEmailProvider?.();
    if (ownEmail && plainEmail(from).toLowerCase() === ownEmail.toLowerCase()) {
      return false;
    }
    if (!pocId || !this.pocStatus) return true;
    const detail = await this.pocStatus.detail(pocId);
    if (detail?.status && !canProcessReplyForStatus(detail.status)) {
      return false;
    }
    if (detail && !detail.hasActivePlan) {
      return false;
    }
    const contactEmails = detail?.requirements?.customer.contacts
      .map((contact) => contact.email.toLowerCase())
      .filter(Boolean);
    if (!contactEmails?.length) return true;
    return contactEmails.includes(from.toLowerCase());
  }
}

function canProcessReplyForStatus(status: PocLifecycleStatus): boolean {
  return (
    status === "needs_clarification" ||
    status === "confirmation_sent" ||
    status === "setup_running" ||
    status === "handoff_sent" ||
    status === "handoff_sent_with_gaps" ||
    status === "active_poc" ||
    status === "monitoring_at_risk" ||
    status === "monitoring_criteria_met"
  );
}

function plainEmail(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function safeNormalizeMessage(input: {
  pocId?: string;
  threadId: string;
  message: GmailMcpMessage;
}): Parameters<WorkflowApi["processEmailReply"]>[0] | undefined {
  try {
    return normalizeGmailMcpInboundEmail({
      pocId: input.pocId,
      email: {
        ...input.message,
        threadId: input.message.threadId ?? input.message.thread_id ?? input.threadId,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Could not derive pocId from Gmail MCP inbound email")
    ) {
      return undefined;
    }
    throw error;
  }
}
