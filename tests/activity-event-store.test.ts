import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActivityEvent, PocRecord } from "../src/contracts.js";
import type { PocStore } from "../src/state/types.js";
import { InMemoryPocStore } from "../src/state/in-memory-poc-store.js";
import { FilePocStore } from "../src/state/file-poc-store.js";
import { SqlitePocStore } from "../src/state/sqlite-poc-store.js";

function record(): PocRecord {
  return {
    pocId: "poc_act",
    status: "active_poc",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    sourceText: "x",
  };
}

function event(id: string, ts: string): ActivityEvent {
  return {
    id,
    pocId: "poc_act",
    ts,
    kind: "monitor_tick",
    actor: "pov_loop",
    status: "succeeded",
    summary: `event ${id}`,
  };
}

const stores: { name: string; make: () => PocStore }[] = [
  { name: "in-memory", make: () => new InMemoryPocStore() },
  {
    name: "file",
    make: () => new FilePocStore(join(mkdtempSync(join(tmpdir(), "poc-act-")), "store.json")),
  },
  { name: "sqlite", make: () => new SqlitePocStore(":memory:") },
];

for (const { name, make } of stores) {
  describe(`activity events — ${name} store`, () => {
    it("round-trips events newest-first and honors limit", async () => {
      const store = make();
      await store.createPoc(record());

      await store.saveActivityEvent(event("e1", "2026-06-05T10:00:00.000Z"));
      await store.saveActivityEvent(event("e3", "2026-06-05T12:00:00.000Z"));
      await store.saveActivityEvent(event("e2", "2026-06-05T11:00:00.000Z"));

      const all = await store.listActivityEvents("poc_act");
      expect(all.map((event) => event.id)).toEqual(["e3", "e2", "e1"]);

      const limited = await store.listActivityEvents("poc_act", { limit: 2 });
      expect(limited.map((event) => event.id)).toEqual(["e3", "e2"]);
    });

    it("replaces an event with the same id and isolates by poc", async () => {
      const store = make();
      await store.createPoc(record());
      await store.saveActivityEvent(event("e1", "2026-06-05T10:00:00.000Z"));
      await store.saveActivityEvent({
        ...event("e1", "2026-06-05T10:00:00.000Z"),
        summary: "updated",
      });

      const events = await store.listActivityEvents("poc_act");
      expect(events).toHaveLength(1);
      expect(events[0].summary).toBe("updated");
      expect(await store.listActivityEvents("missing")).toEqual([]);
    });
  });
}
