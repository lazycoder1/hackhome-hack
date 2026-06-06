import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileSecretsTool } from "../src/tools/encrypted-file-secrets-tool.js";

describe("EncryptedFileSecretsTool", () => {
  it("persists encrypted secrets and consumes one-time links once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "encrypted-secrets-"));
    const path = join(dir, "secrets.json");

    try {
      const first = new EncryptedFileSecretsTool({
        path,
        encryptionKey: "test-passphrase",
        baseSecretUrl: "https://app.example.test/secrets",
        clock: () => new Date("2026-06-04T00:00:00.000Z"),
      });
      const secret = await first.createSecret({
        pocId: "poc_123",
        name: "posthog_project_access",
        value: "raw-secret-value",
        ttl: "7d",
      });
      const link = await first.createOneTimeSecretLink({
        secretRef: secret.secretRef,
        recipientEmail: "buyer@acme.test",
        expiresIn: "7d",
      });

      expect(readFileSync(path, "utf8")).not.toContain("raw-secret-value");

      const second = new EncryptedFileSecretsTool({
        path,
        encryptionKey: "test-passphrase",
        baseSecretUrl: "https://app.example.test/secrets",
        clock: () => new Date("2026-06-04T00:01:00.000Z"),
      });
      const token = link.url.split("/").pop() ?? "";

      expect(await second.consumeOneTimeSecretLink({ token })).toMatchObject({
        status: "consumed",
        name: "posthog_project_access",
        value: "raw-secret-value",
      });
      expect(await second.consumeOneTimeSecretLink({ token })).toEqual({ status: "used" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects expired and revoked secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "encrypted-secrets-"));
    const path = join(dir, "secrets.json");

    try {
      const tool = new EncryptedFileSecretsTool({
        path,
        encryptionKey: "test-passphrase",
        baseSecretUrl: "https://app.example.test/secrets",
        clock: () => new Date("2026-06-04T00:00:00.000Z"),
      });
      const secret = await tool.createSecret({
        pocId: "poc_123",
        name: "posthog_project_access",
        value: "raw-secret-value",
        ttl: "7d",
      });
      const link = await tool.createOneTimeSecretLink({
        secretRef: secret.secretRef,
        recipientEmail: "buyer@acme.test",
        expiresIn: "7d",
      });
      await tool.rotateOrRevokeSecret({
        secretRef: secret.secretRef,
        action: "revoke",
        reason: "test",
      });

      expect(
        await tool.consumeOneTimeSecretLink({ token: link.url.split("/").pop() ?? "" }),
      ).toEqual({
        status: "revoked",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
