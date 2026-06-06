import { config as loadDotenv } from "dotenv";

export type AppConfig = {
  deepseek: {
    apiKey: string;
    baseUrl: string;
    models: {
      pro: string;
      flash: string;
    };
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadDotenv();
  }

  const apiKey = env.OPENAI_API_KEY ?? env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return {
    deepseek: {
      apiKey,
      baseUrl: env.OPENAI_BASE_URL ?? env.DEEPSEEK_BASE_URL ?? "https://api.openai.com/v1",
      models: {
        pro: env.OPENAI_MODEL ?? env.LLM_MODEL_PRO ?? "gpt-5.5",
        flash: env.OPENAI_FAST_MODEL ?? env.OPENAI_MODEL ?? env.LLM_MODEL_FLASH ?? "gpt-5.5",
      },
    },
  };
}
