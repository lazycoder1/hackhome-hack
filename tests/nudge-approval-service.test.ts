import type { ActivityEvent, PocRecord } from "../src/contracts.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import { InMemoryApprovalTool, InMemoryEmailTool } from "../src/tools/in-memory-tools.js";
import { NudgeApprovalService } from "../src/workflow/nudge-approval-service.js";

const clock = () => new Date("2026-06-05T12:00:00.000Z");

function record(): PocRecord {
  return {
    pocId: "poc_1",
    status: "monitoring_at_risk",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    sourceText: "x",
  };
}

function gated(tokenId: string): ActivityEvent {
  return {
    id: `g_${tokenId}`,
    pocId: "poc_1",
    ts: "2026-06-05T11:00:00.000Z",
    kind: "action_gated",
    actor: "pov_loop",
    status: "gated",
    cadenceKey: "nudge:inactive",
    summary: "Customer nudge queued for SE approval",
    refs: { approvalTokenId: tokenId },
    payload: {
      subject: "Ready to test your PoC?",
      markdownBody: "Hi Acme, let's run the first test step.",
      recipients: ["buyer@acme.test"],
    },
  };
}

async function makeService() {
  const store = new InMemoryPocStore();
  await store.createPoc(record());
  const email = new InMemoryEmailTool({ clock });
  const approval = new InMemoryApprovalTool({ clock });
  const service = new NudgeApprovalService({
    store,
    email,
    approval,
    clock,
    idGenerator: (() => {
      let n = 0;
      return () => `evt_${n++}`;
    })(),
  });
  return { store, email, service };
}

describe("NudgeApprovalService", () => {
  it("approving a gated nudge sends the email and records email_sent", async () => {
    const { store, email, service } = await makeService();
    await store.saveActivityEvent(gated("tok_1"));

    const result = await service.complete({
      pocId: "poc_1",
      tokenId: "tok_1",
      decision: "approved",
      editedBody: "Edited body before send.",
      decidedBy: "sasha@se.test",
    });

    expect(result.status).toBe("sent");
    expect(email.sentEmails).toHaveLength(1);
    expect(email.sentEmails[0]).toMatchObject({
      to: ["buyer@acme.test"],
      subject: "Ready to test your PoC?",
      markdownBody: "Edited body before send.",
    });

    const events = await store.listActivityEvents("poc_1");
    const sent = events.find((event) => event.kind === "email_sent");
    expect(sent?.refs?.approvalTokenId).toBe("tok_1");
    expect(sent?.refs?.emailId).toBe(email.sentEmails[0].emailId);
  });

  it("is idempotent — a second decision on the same token is a no-op", async () => {
    const { store, email, service } = await makeService();
    await store.saveActivityEvent(gated("tok_1"));

    await service.complete({ pocId: "poc_1", tokenId: "tok_1", decision: "approved" });
    const second = await service.complete({
      pocId: "poc_1",
      tokenId: "tok_1",
      decision: "approved",
    });

    expect(second.status).toBe("already_decided");
    expect(email.sentEmails).toHaveLength(1);
  });

  it("rejecting records a decision and sends nothing", async () => {
    const { store, email, service } = await makeService();
    await store.saveActivityEvent(gated("tok_2"));

    const result = await service.complete({
      pocId: "poc_1",
      tokenId: "tok_2",
      decision: "rejected",
    });

    expect(result.status).toBe("rejected");
    expect(email.sentEmails).toHaveLength(0);
    const events = await store.listActivityEvents("poc_1");
    expect(events.some((event) => event.kind === "nudge_decision")).toBe(true);
  });

  it("returns not_found for an unknown token", async () => {
    const { service } = await makeService();
    const result = await service.complete({
      pocId: "poc_1",
      tokenId: "nope",
      decision: "approved",
    });
    expect(result.status).toBe("not_found");
  });
});
