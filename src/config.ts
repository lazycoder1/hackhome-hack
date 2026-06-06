import { config as loadDotenv } from "dotenv";

export type AppConfig = {
  deepseek: {
    apiKey: string;
    baseUrl: string;
    models: {
      pro: "deepseek-v4-pro";
      flash: "deepseek-v4-flash";
    };
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadDotenv();
  }

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required");
  }

  return {
    deepseek: {
      apiKey,
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      models: {
        pro: "deepseek-v4-pro",
        flash: "deepseek-v4-flash",
      },
    },
  };
}
