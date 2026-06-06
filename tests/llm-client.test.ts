import { DeepSeekClient } from "../src/llm/deepseek-client.js";

describe("DeepSeekClient", () => {
  it("sends OpenAI-compatible chat completion requests to DeepSeek", async () => {
    const requests: unknown[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = new DeepSeekClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      fetchImpl,
    });

    const result = await client.completeJson({
      model: "deepseek-v4-flash",
      system: "Return JSON only.",
      user: "Say ok.",
    });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    const request = requests[0] as { url: string; init: RequestInit };
    expect(request.url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      model: "deepseek-v4-flash",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "Say ok." },
      ],
    });
  });

  it("omits temperature for GPT-5.5 models", async () => {
    const requests: unknown[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = new DeepSeekClient({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl,
    });

    await client.completeJson({
      model: "gpt-5.5-high",
      system: "Return JSON only.",
      user: "Say ok.",
      temperature: 0.3,
    });

    const request = requests[0] as { init: RequestInit };
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({
      model: "gpt-5.5-high",
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("temperature");
  });
});
