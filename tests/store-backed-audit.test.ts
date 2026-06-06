import type { PocRecord } from "../src/contracts.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import { StoreBackedAuditTool } from "../src/tools/store-backed-audit-tool.js";

const clock = () => new Date("2026-06-05T12:00:00.000Z");

function record(): PocRecord {
  return {
    pocId: "poc_1",
    status: "active_poc",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    sourceText: "x",
  };
}

describe("StoreBackedAuditTool", () => {
  it("persists audit entries as durable activity events with semantic kinds", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record());
    const audit = new StoreBackedAuditTool({ store, clock });

    await audit.writeAuditLog({
      pocId: "poc_1",
      actor: "orchestrator",
      action: "send_confirmation_email",
      outputSummary: "Confirmation email sent to buyer@acme.test",
      status: "succeeded",
    });
    await audit.writeAuditLog({
      pocId: "poc_1",
      actor: "orchestrator",
      action: "process_email_reply",
      status: "succeeded",
    });

    const events = await store.listActivityEvents("poc_1");
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("email_sent");
    expect(kinds).toContain("email_received");
    // inner in-memory log is still exposed for existing callers/tests
    expect(audit.events).toHaveLength(2);
  });

  it("does not duplicate the loop's monitor_tick", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record());
    const audit = new StoreBackedAuditTool({ store, clock });

    await audit.writeAuditLog({
      pocId: "poc_1",
      actor: "poc_monitoring_agent",
      action: "monitor_poc_success",
      status: "succeeded",
    });

    expect(await store.listActivityEvents("poc_1")).toHaveLength(0);
    expect(audit.events).toHaveLength(1);
  });

  it("skips the durable copy when the PoC does not exist yet", async () => {
    const store = new InMemoryPocStore();
    const audit = new StoreBackedAuditTool({ store, clock });
    await expect(
      audit.writeAuditLog({
        pocId: "missing",
        actor: "orchestrator",
        action: "submit_requirements_blob",
        status: "started",
      }),
    ).resolves.toMatchObject({ auditEventId: expect.any(String) });
  });
});
