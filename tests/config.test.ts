import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads OpenAI defaults from environment values", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "test-key",
    });

    expect(config.deepseek.apiKey).toBe("test-key");
    expect(config.deepseek.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.deepseek.models.pro).toBe("gpt-5.5");
    expect(config.deepseek.models.flash).toBe("gpt-5.5");
  });

  it("requires an OpenAI API key", () => {
    expect(() => loadConfig({})).toThrow(/OPENAI_API_KEY/);
  });

  it("keeps DeepSeek env values as a backwards-compatible fallback", () => {
    const config = loadConfig({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      LLM_MODEL_PRO: "deepseek-v4-pro",
      LLM_MODEL_FLASH: "deepseek-v4-flash",
    });

    expect(config.deepseek.apiKey).toBe("test-key");
    expect(config.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseek.models.pro).toBe("deepseek-v4-pro");
    expect(config.deepseek.models.flash).toBe("deepseek-v4-flash");
  });
});
