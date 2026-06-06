import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretsTool } from "../src/tools/create-secrets-tool.js";
import { EncryptedFileSecretsTool } from "../src/tools/encrypted-file-secrets-tool.js";
import { InMemorySecretsTool } from "../src/tools/in-memory-tools.js";

describe("createSecretsTool", () => {
  it("uses in-memory secrets by default", () => {
    expect(createSecretsTool({ env: {} as NodeJS.ProcessEnv })).toBeInstanceOf(InMemorySecretsTool);
  });

  it("uses encrypted file secrets when an encryption key is configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-factory-"));

    try {
      const tool = createSecretsTool({
        env: {
          SECRET_ENCRYPTION_KEY: "test-passphrase",
          SECRETS_STORE_PATH: join(dir, "secrets.json"),
        } as NodeJS.ProcessEnv,
      });

      expect(tool).toBeInstanceOf(EncryptedFileSecretsTool);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
