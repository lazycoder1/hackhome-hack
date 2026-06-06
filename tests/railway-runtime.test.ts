import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRailwayRuntime, runtimeStoragePath } from "../src/runtime/railway-runtime.js";
import { createPocStore } from "../src/state/create-poc-store.js";
import type { PocRecord } from "../src/contracts.js";

describe("Railway runtime helpers", () => {
  it("detects Railway runtime variables", () => {
    expect(isRailwayRuntime({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isRailwayRuntime({ RAILWAY_SERVICE_ID: "svc_123" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("resolves runtime storage paths to the Railway volume when attached", () => {
    expect(
      runtimeStoragePath({
        env: { RAILWAY_VOLUME_MOUNT_PATH: "/data" } as NodeJS.ProcessEnv,
        filename: "pocs.sqlite",
        fallbackPath: ".data/pocs.sqlite",
      }),
    ).toBe("/data/pocs.sqlite");

    expect(
      runtimeStoragePath({
        env: {} as NodeJS.ProcessEnv,
        filename: "pocs.sqlite",
        fallbackPath: ".data/pocs.sqlite",
      }),
    ).toBe(".data/pocs.sqlite");
  });

  it("uses the Railway volume as the default SQLite PoC store path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "railway-poc-store-"));

    try {
      const store = createPocStore({
        env: {
          POC_STORE_MODE: "sqlite",
          RAILWAY_VOLUME_MOUNT_PATH: dir,
        } as NodeJS.ProcessEnv,
      });

      await store.createPoc(record());

      expect(existsSync(join(dir, "pocs.sqlite"))).toBe(true);
      (store as { close?: () => void }).close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function record(): PocRecord {
  return {
    pocId: "poc_railway",
    status: "intake_received",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    sourceText: "Railway SQLite compatibility test.",
  };
}
