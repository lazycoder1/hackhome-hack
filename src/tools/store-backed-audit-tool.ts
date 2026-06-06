import type { ActivityEvent } from "../contracts.js";
import type { PocStore } from "../state/types.js";
import { InMemoryAuditTool } from "./in-memory-tools.js";
import type { AuditTool } from "./types.js";

type WriteAuditInput = Parameters<AuditTool["writeAuditLog"]>[0];

/**
 * AuditTool that ALSO persists every audit entry to the PocStore as an ActivityEvent, so the
 * agent's whole footprint (emails sent, replies received, setup steps, monitoring) is durable
 * and renders in the Agent Activity feed. Wraps an InMemoryAuditTool so existing call sites and
 * tests that read `.events` keep working unchanged.
 *
 * The store write is best-effort: if the PoC row doesn't exist yet (e.g. very first intake event
 * before createPoc), we skip the durable copy rather than throw.
 */
export class StoreBackedAuditTool implements AuditTool {
  readonly inner: InMemoryAuditTool;
  private readonly store: PocStore;
  private readonly clock: () => Date;
  private counter = 0;

  constructor(options: { store: PocStore; clock?: () => Date }) {
    this.store = options.store;
    this.clock = options.clock ?? (() => new Date());
    this.inner = new InMemoryAuditTool({ clock: this.clock });
  }

  get events() {
    return this.inner.events;
  }

  async writeAuditLog(input: WriteAuditInput): Promise<{ auditEventId: string }> {
    const result = await this.inner.writeAuditLog(input);

    // The loop already records a clean monitor_tick; don't double up.
    if (input.action !== "monitor_poc_success") {
      const event: ActivityEvent = {
        id: result.auditEventId,
        pocId: input.pocId,
        ts: input.createdAt ?? this.clock().toISOString(),
        kind: kindForAction(input.action),
        actor: actorFor(input.actor),
        status: statusFor(input.status),
        summary: input.outputSummary ?? humanizeAction(input.action),
        payload: prunePayload({
          action: input.action,
          target: input.target,
          error: input.error,
        }),
      };
      try {
        await this.store.saveActivityEvent(event);
      } catch {
        // PoC not created yet (first intake event) — skip the durable copy.
      }
    }

    return result;
  }
}

function kindForAction(action: string): ActivityEvent["kind"] {
  if (/confirmation|handoff|reminder|email.*sent|send.*email/.test(action)) {
    return "email_sent";
  }
  if (/reply|inbound|received/.test(action)) {
    return "email_received";
  }
  return "audit";
}

function actorFor(actor: WriteAuditInput["actor"]): ActivityEvent["actor"] {
  switch (actor) {
    case "posthog_setup_agent":
      return "setup_agent";
    case "validation_runner":
      return "validation_runner";
    case "poc_monitoring_agent":
      return "monitoring_agent";
    case "orchestrator":
      return "orchestrator";
    case "human":
      return "human";
    default:
      return "system";
  }
}

function statusFor(status: WriteAuditInput["status"]): ActivityEvent["status"] {
  return status === "started"
    ? "proposed"
    : status === "succeeded"
      ? "succeeded"
      : status === "skipped"
        ? "skipped"
        : "failed";
}

function humanizeAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function prunePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}
