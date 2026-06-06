import { FilePocStore } from "./file-poc-store.js";
import { SqlitePocStore } from "./sqlite-poc-store.js";
import type { PocStore } from "./types.js";

export type PocStoreMode = "file" | "sqlite";

export type CreatePocStoreOptions = {
  storeMode?: PocStoreMode;
  storePath?: string;
  env?: NodeJS.ProcessEnv;
};

export function createPocStore(options: CreatePocStoreOptions = {}): PocStore {
  const env = options.env ?? process.env;
  const storeMode = options.storeMode ?? parseStoreMode(env.POC_STORE_MODE);

  if (storeMode === "sqlite" || (!storeMode && Boolean(env.SQLITE_DB_PATH))) {
    return new SqlitePocStore(options.storePath ?? env.SQLITE_DB_PATH ?? ".data/pocs.sqlite");
  }

  return new FilePocStore(options.storePath ?? env.POC_STORE_PATH ?? ".data/pocs.json");
}

export function parseStoreMode(value: string | undefined): PocStoreMode | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "file" || value === "sqlite") {
    return value;
  }
  throw new Error(`Invalid POC_STORE_MODE: ${value}`);
}
