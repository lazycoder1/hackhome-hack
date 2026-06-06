import {
  EncryptedFileSecretsTool,
  type EncryptedFileSecretsToolOptions,
} from "./encrypted-file-secrets-tool.js";
import { InMemorySecretsTool } from "./in-memory-tools.js";
import type { SecretsTool } from "./types.js";

export type SecretsMode = "memory" | "encrypted_file";

export type CreateSecretsToolOptions = {
  mode?: SecretsMode;
  encryptedFile?: EncryptedFileSecretsToolOptions;
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
};

export function createSecretsTool(options: CreateSecretsToolOptions = {}): SecretsTool {
  const env = options.env ?? process.env;
  const mode = options.mode ?? parseSecretsMode(env.SECRETS_MODE);
  const shouldUseEncryptedFile =
    mode === "encrypted_file" || (!mode && Boolean(env.SECRET_ENCRYPTION_KEY));

  if (shouldUseEncryptedFile) {
    return new EncryptedFileSecretsTool({
      ...options.encryptedFile,
      path: options.encryptedFile?.path ?? env.SECRETS_STORE_PATH,
      encryptionKey: options.encryptedFile?.encryptionKey ?? env.SECRET_ENCRYPTION_KEY,
      baseSecretUrl: options.encryptedFile?.baseSecretUrl ?? env.SECRETS_BASE_URL,
      clock: options.clock ?? options.encryptedFile?.clock,
    });
  }

  return new InMemorySecretsTool({
    clock: options.clock,
    baseSecretUrl: env.SECRETS_BASE_URL,
  });
}

export function parseSecretsMode(value: string | undefined): SecretsMode | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "memory" || value === "encrypted_file") {
    return value;
  }
  throw new Error(`Invalid SECRETS_MODE: ${value}`);
}
