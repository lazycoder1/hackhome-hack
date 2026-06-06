import type { InboundEmailMessage } from "../contracts.js";

export type GmailMcpInboundEmail = {
  pocId?: string;
  email: Record<string, unknown>;
};

export function normalizeGmailMcpInboundEmail(input: GmailMcpInboundEmail): {
  pocId: string;
  message: InboundEmailMessage;
} {
  const email = input.email;
  const to = normalizeRecipients(fieldValue(email, ["to", "toRecipients"]));
  const pocId = input.pocId ?? derivePocId(to);
  if (!pocId) {
    throw new Error("Could not derive pocId from Gmail MCP inbound email");
  }

  const id = stringField(email, ["id", "message_id", "messageId"], crypto.randomUUID());
  const threadId = stringField(email, ["thread_id", "threadId"], id);
  const subject = stringField(email, ["subject"], "");

  return {
    pocId,
    message: {
      id,
      threadId,
      from: firstEmail(stringField(email, ["from", "sender"], "")),
      to,
      subject,
      textBody: stringField(
        email,
        ["body", "text", "textBody", "plaintextBody", "snippet"],
        subject,
      ),
      receivedAt: receivedAt(email),
    },
  };
}

function normalizeRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => firstEmail(String(item))).filter((email) => email.length > 0);
  }
  return String(value ?? "")
    .split(",")
    .map((item) => firstEmail(item))
    .filter((email) => email.length > 0);
}

function firstEmail(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function derivePocId(recipients: string[]): string | undefined {
  for (const recipient of recipients) {
    const localPart = recipient.split("@")[0];
    if (/^poc_[a-zA-Z0-9_-]+$/.test(localPart)) {
      return localPart;
    }
  }
  return undefined;
}

function receivedAt(email: Record<string, unknown>): string {
  const value = stringField(email, ["receivedAt", "received_at", "timestamp", "date"], "");
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

function stringField(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

function fieldValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
