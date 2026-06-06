export type JsonCompletionInput = {
  model: string;
  system: string;
  user: string;
  temperature?: number;
};

export type LlmJsonClient = {
  completeJson(input: JsonCompletionInput): Promise<unknown>;
};
