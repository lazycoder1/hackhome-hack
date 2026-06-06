import type { WorkflowApi } from "./workflow-api.js";
import { normalizeGmailMcpInboundEmail } from "../tools/gmail-mcp-inbound-normalizer.js";
import type { GmailMcpGateway, GmailMcpMessage } from "../tools/gmail-mcp-email-tool.js";
import type { PocStatusReadApi } from "../status/poc-status-reader.js";

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
};

export class GmailInboxMonitor {
  private readonly gateway: GmailMcpGateway;
  private readonly workflow: Pick<WorkflowApi, "processEmailReply">;
  private readonly pocStatus?: Pick<PocStatusReadApi, "list" | "detail">;

  constructor(options: GmailInboxMonitorOptions) {
    this.gateway = options.gateway;
    this.workflow = options.workflow;
    this.pocStatus = options.pocStatus;
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

        await this.workflow.processEmailReply(normalized);
        processedMessages += 1;
        processedThreadMessages += 1;
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
    if (!pocId || !this.pocStatus) return true;
    const detail = await this.pocStatus.detail(pocId);
    const contactEmails = detail?.requirements?.customer.contacts
      .map((contact) => contact.email.toLowerCase())
      .filter(Boolean);
    if (!contactEmails?.length) return true;
    return contactEmails.includes(from.toLowerCase());
  }
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
