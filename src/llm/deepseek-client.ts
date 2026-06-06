import type { JsonCompletionInput, LlmJsonClient } from "./types.js";

type DeepSeekClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type DeepSeekResponse = {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
};

function supportsTemperature(model: string): boolean {
  return !model.startsWith("gpt-5.5");
}

export class DeepSeekClient implements LlmJsonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.deepseek.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  }

  async completeJson(input: JsonCompletionInput): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          ...(supportsTemperature(input.model) ? { temperature: input.temperature ?? 0 } : {}),
          ...(input.model.startsWith("gpt-5.5") ? { reasoning_effort: "high" } : {}),
          response_format: { type: "json_object" },
        }),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError" || (error as Error).name === "AbortError") {
        throw new Error(`LLM request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${text}`);
    }

    const body = (await response.json()) as DeepSeekResponse;
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response did not include message content");
    }

    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`LLM response was not valid JSON: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
