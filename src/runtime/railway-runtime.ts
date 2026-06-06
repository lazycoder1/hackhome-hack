import { join } from "node:path";

export function isRailwayRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_ENVIRONMENT_ID ||
      env.RAILWAY_VOLUME_MOUNT_PATH,
  );
}

export function runtimeStoragePath(input: {
  env?: NodeJS.ProcessEnv;
  filename: string;
  fallbackPath: string;
}): string {
  const env = input.env ?? process.env;
  const mountPath = env.RAILWAY_VOLUME_MOUNT_PATH;
  return mountPath ? join(mountPath, input.filename) : input.fallbackPath;
}
