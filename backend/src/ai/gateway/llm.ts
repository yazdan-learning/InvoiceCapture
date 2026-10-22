// The AI gateway: the only thing the direct adapters know about language
// models. Flows ask for a model *tier*; which provider and model that means is
// configuration (LLM_* env vars), so switching models or vendors never touches
// the flows.

/** "fast" = cheap and quick (parsing, matching, extraction); "smart" = better reasoning (chat). */
export type ModelTier = 'fast' | 'smart';

export type CompletionRequest = {
  model: ModelTier;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  /** A photo the model looks at with the prompt, as a data: URL (needs a vision-capable model). */
  image?: string;
};

export interface LlmClient {
  /** The model's text answer. Throws AiUnavailableError (retryable for rate limits/hiccups). */
  complete(request: CompletionRequest): Promise<string>;
}
