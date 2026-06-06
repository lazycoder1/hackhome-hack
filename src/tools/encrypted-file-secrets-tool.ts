import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { SecretsTool } from "./types.js";

type EncryptedSecretRecord = {
  secretRef: string;
  pocId: string;
  name: string;
  ciphertext: string;
  iv: string;
  tag: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
  tags?: string[];
};

type OneTimeLinkRecord = {
  token: string;
  secretRef: string;
  recipientEmail: string;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
};

type EncryptedSecretsData = {
  secrets: Record<string, EncryptedSecretRecord>;
  oneTimeLinks: Record<string, OneTimeLinkRecord>;
};

export type EncryptedFileSecretsToolOptions = {
  path?: string;
  encryptionKey?: string;
  baseSecretUrl?: string;
  clock?: () => Date;
};

export class EncryptedFileSecretsTool implements SecretsTool {
  private readonly path: string;
  private readonly key: Buffer;
  private readonly baseSecretUrl: string;
  private readonly clock: () => Date;

  constructor(options: EncryptedFileSecretsToolOptions = {}) {
    const encryptionKey = options.encryptionKey ?? process.env.SECRET_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("SECRET_ENCRYPTION_KEY is required for encrypted file secrets");
    }

    this.path = options.path ?? process.env.SECRETS_STORE_PATH ?? ".data/secrets.json";
    this.key = normalizeEncryptionKey(encryptionKey);
    this.baseSecretUrl =
      options.baseSecretUrl ?? process.env.SECRETS_BASE_URL ?? "http://localhost:3000/secrets";
    this.clock = options.clock ?? (() => new Date());
    this.ensureFile();
  }

  async createSecret(input: {
    pocId: string;
    name: string;
    value: string;
    ttl?: string;
    tags?: string[];
  }): Promise<{ secretRef: string; expiresAt?: string }> {
    const data = this.read();
    const secretRef = `secret_${randomUUID()}`;
    const encrypted = encrypt(input.value, this.key);
    const expiresAt = input.ttl ? addDuration(this.clock(), input.ttl).toISOString() : undefined;

    data.secrets[secretRef] = {
      secretRef,
      pocId: input.pocId,
      name: input.name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      expiresAt,
      createdAt: this.clock().toISOString(),
      tags: input.tags,
    };
    this.write(data);

    return { secretRef, expiresAt };
  }

  async createOneTimeSecretLink(input: {
    secretRef: string;
    recipientEmail: string;
    expiresIn: string;
  }): Promise<{ url: string; expiresAt: string }> {
    const data = this.read();
    const secret = data.secrets[input.secretRef];
    if (!secret) {
      throw new Error(`Unknown secret ref: ${input.secretRef}`);
    }
    if (secret.revokedAt) {
      throw new Error(`Secret ref has been revoked: ${input.secretRef}`);
    }

    const token = tokenId();
    const expiresAt = addDuration(this.clock(), input.expiresIn).toISOString();
    data.oneTimeLinks[token] = {
      token,
      secretRef: input.secretRef,
      recipientEmail: input.recipientEmail,
      expiresAt,
      createdAt: this.clock().toISOString(),
    };
    this.write(data);

    return {
      url: `${this.baseSecretUrl.replace(/\/$/, "")}/${token}`,
      expiresAt,
    };
  }

  async consumeOneTimeSecretLink(input: { token: string }): Promise<
    | {
        status: "consumed";
        name: string;
        value: string;
        expiresAt?: string;
      }
    | {
        status: "not_found" | "expired" | "used" | "revoked";
      }
  > {
    const data = this.read();
    const link = data.oneTimeLinks[input.token];
    if (!link) {
      return { status: "not_found" };
    }
    if (link.usedAt) {
      return { status: "used" };
    }
    if (Date.parse(link.expiresAt) < this.clock().getTime()) {
      return { status: "expired" };
    }

    const secret = data.secrets[link.secretRef];
    if (!secret) {
      return { status: "not_found" };
    }
    if (secret.revokedAt) {
      return { status: "revoked" };
    }
    if (secret.expiresAt && Date.parse(secret.expiresAt) < this.clock().getTime()) {
      return { status: "expired" };
    }

    link.usedAt = this.clock().toISOString();
    this.write(data);

    return {
      status: "consumed",
      name: secret.name,
      value: decrypt(secret, this.key),
      expiresAt: secret.expiresAt ?? link.expiresAt,
    };
  }

  async rotateOrRevokeSecret(input: {
    secretRef: string;
    action: "rotate" | "revoke";
    reason: string;
  }): Promise<{ success: boolean; newSecretRef?: string }> {
    const data = this.read();
    const secret = data.secrets[input.secretRef];
    if (!secret) {
      return { success: false };
    }

    if (input.action === "revoke") {
      secret.revokedAt = this.clock().toISOString();
      this.write(data);
      return { success: true };
    }

    const value = decrypt(secret, this.key);
    const newSecretRef = `secret_${randomUUID()}`;
    const encrypted = encrypt(value, this.key);
    data.secrets[newSecretRef] = {
      ...secret,
      secretRef: newSecretRef,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      createdAt: this.clock().toISOString(),
    };
    secret.revokedAt = this.clock().toISOString();
    this.write(data);

    return { success: true, newSecretRef };
  }

  private ensureFile(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path)) {
      this.write({
        secrets: {},
        oneTimeLinks: {},
      });
    }
  }

  private read(): EncryptedSecretsData {
    return JSON.parse(readFileSync(this.path, "utf8")) as EncryptedSecretsData;
  }

  private write(data: EncryptedSecretsData): void {
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }
}

function encrypt(value: string, key: Buffer): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(
  record: Pick<EncryptedSecretRecord, "ciphertext" | "iv" | "tag">,
  key: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeEncryptionKey(value: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to passphrase hashing.
  }

  return createHash("sha256").update(value).digest();
}

function tokenId(): string {
  return randomBytes(32).toString("base64url");
}

function addDuration(date: Date, duration: string): Date {
  const match = /^(\d+)([dhm])$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported duration: ${duration}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds =
    unit === "d"
      ? amount * 24 * 60 * 60 * 1000
      : unit === "h"
        ? amount * 60 * 60 * 1000
        : amount * 60 * 1000;

  return new Date(date.getTime() + milliseconds);
}
