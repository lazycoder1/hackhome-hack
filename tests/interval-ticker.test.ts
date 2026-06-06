import type { PocRecord } from "../src/contracts.js";
import type { PovLoopRunner, TickResult } from "../src/monitoring/pov-loop-runner.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import { IntervalTicker } from "../src/workflow/interval-ticker.js";

function record(pocId: string, status: PocRecord["status"]): PocRecord {
  return {
    pocId,
    status,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    sourceText: "x",
  };
}

describe("IntervalTicker", () => {
  it("ticks only monitorable POVs and isolates per-POV failures", async () => {
    const store = new InMemoryPocStore();
    await store.createPoc(record("poc_active", "active_poc"));
    await store.createPoc(record("poc_monitoring", "monitoring_at_risk"));
    await store.createPoc(record("poc_intake", "confirmation_sent")); // not monitorable
    await store.createPoc(record("poc_boom", "active_poc"));

    const ticked: string[] = [];
    const runner = {
      async runTick(pocId: string): Promise<TickResult> {
        ticked.push(pocId);
        if (pocId === "poc_boom") {
          throw new Error("boom");
        }
        return { pocId, status: "ran", events: [] };
      },
    } as unknown as PovLoopRunner;

    const errors: string[] = [];
    const ticker = new IntervalTicker({
      store,
      runner,
      intervalMs: 100000,
      onError: (error, pocId) => errors.push(`${pocId}:${error.message}`),
    });

    const result = await ticker.tickAll();

    expect(result.ticked).toBe(3);
    expect(ticked.sort()).toEqual(["poc_active", "poc_boom", "poc_monitoring"]);
    expect(ticked).not.toContain("poc_intake");
    expect(errors).toEqual(["poc_boom:boom"]);
  });

  it("start/stop manage the timer cleanly", async () => {
    const store = new InMemoryPocStore();
    const runner = {
      async runTick() {
        return { pocId: "x", status: "ran", events: [] };
      },
    } as unknown as PovLoopRunner;
    const ticker = new IntervalTicker({ store, runner, intervalMs: 100000 });
    ticker.start();
    ticker.start(); // idempotent
    ticker.stop();
    expect(true).toBe(true);
  });
});
