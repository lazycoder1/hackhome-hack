import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads DeepSeek V4 defaults from environment values", () => {
    const config = loadConfig({
      DEEPSEEK_API_KEY: "test-key",
    });

    expect(config.deepseek.apiKey).toBe("test-key");
    expect(config.deepseek.baseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseek.models.pro).toBe("deepseek-v4-pro");
    expect(config.deepseek.models.flash).toBe("deepseek-v4-flash");
  });

  it("requires a DeepSeek API key", () => {
    expect(() => loadConfig({})).toThrow(/DEEPSEEK_API_KEY/);
  });
});
