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

  const provider = (env.LLM_PROVIDER ?? (env.DEEPSEEK_API_KEY ? "deepseek" : "openai")).toLowerCase();
  const useDeepSeek = provider === "deepseek";
  const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`${useDeepSeek ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"} is required`);
  }

  return {
    deepseek: {
      apiKey,
      baseUrl: useDeepSeek
        ? (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com")
        : (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
      models: {
        pro: useDeepSeek
          ? (env.DEEPSEEK_MODEL ?? env.LLM_MODEL_PRO ?? "deepseek-v4-flash")
          : (env.OPENAI_MODEL ?? env.LLM_MODEL_PRO ?? "gpt-5.5"),
        flash: useDeepSeek
          ? (env.DEEPSEEK_FAST_MODEL ??
            env.DEEPSEEK_MODEL ??
            env.LLM_MODEL_FLASH ??
            "deepseek-v4-flash")
          : (env.OPENAI_FAST_MODEL ?? env.OPENAI_MODEL ?? env.LLM_MODEL_FLASH ?? "gpt-5.5"),
      },
    },
  };
}
