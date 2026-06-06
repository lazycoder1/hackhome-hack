import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads OpenAI defaults from environment values", () => {
    const config = loadConfig({
      LLM_PROVIDER: "openai",
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

  it("requires a DeepSeek key when DeepSeek is selected", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "deepseek" })).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("loads DeepSeek v4 flash when DeepSeek is selected", () => {
    const config = loadConfig({
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    });

    expect(config.deepseek.apiKey).toBe("test-key");
    expect(config.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseek.models.pro).toBe("deepseek-v4-flash");
    expect(config.deepseek.models.flash).toBe("deepseek-v4-flash");
  });

  it("prefers DeepSeek when a DeepSeek key is present and no provider is set", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "openai-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    });

    expect(config.deepseek.apiKey).toBe("deepseek-key");
    expect(config.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseek.models.pro).toBe("deepseek-v4-flash");
    expect(config.deepseek.models.flash).toBe("deepseek-v4-flash");
  });

  it("uses explicit DeepSeek model overrides", () => {
    const config = loadConfig({
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
      DEEPSEEK_FAST_MODEL: "deepseek-v4-flash",
    });

    expect(config.deepseek.models.pro).toBe("deepseek-v4-pro");
    expect(config.deepseek.models.flash).toBe("deepseek-v4-flash");
  });
});
