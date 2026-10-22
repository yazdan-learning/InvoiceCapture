import { AiUnavailableError, isRetryableStatus } from '../errors';
import { CompletionRequest, LlmClient, ModelTier } from './llm';

export type OpenAiCompatibleConfig = {
  /** e.g. https://api.groq.com/openai/v1, https://api.openai.com/v1, http://localhost:11434/v1 (Ollama) */
  baseUrl: string;
  apiKey: string;
  models: Record<ModelTier, string>;
  timeoutMs: number;
  /** Sent as reasoning_effort when set: thinking models (Gemini 3, o-series) are slow and costly at their default. */
  reasoningEffort?: string;
  /** Told the provider's token counts after every successful call (cost tracking). */
  onUsage?: (model: string, inputTokens: number, outputTokens: number) => void;
};

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * Any provider speaking the OpenAI chat-completions API: Groq (default),
 * OpenAI, Mistral, OpenRouter, a local Ollama, or an LLM gateway such as
 * LiteLLM in front of several of them.
 */
export class OpenAiCompatibleLlm implements LlmClient {
  constructor(private readonly config: OpenAiCompatibleConfig) {
    if (!config.apiKey) throw new Error('Missing required env var: LLM_API_KEY');
  }

  async complete({ model, system, prompt, temperature, maxTokens, image }: CompletionRequest): Promise<string> {
    const modelName = this.config.models[model];
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: system },
            // The object form of image_url is what both OpenAI and Mistral accept.
            { role: 'user', content: image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] : prompt }
          ],
          temperature,
          max_completion_tokens: maxTokens,
          ...(this.config.reasoningEffort ? { reasoning_effort: this.config.reasoningEffort } : {})
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      throw new AiUnavailableError(`AI service unreachable: ${(err as Error).message}`);
    }
    const json = (await response.json().catch(() => null)) as ChatCompletion | null;
    if (!response.ok) {
      throw new AiUnavailableError(json?.error?.message ?? `AI service failed (HTTP ${response.status})`, isRetryableStatus(response.status));
    }
    if (json?.usage) this.config.onUsage?.(modelName, json.usage.prompt_tokens ?? 0, json.usage.completion_tokens ?? 0);
    const content = json?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new AiUnavailableError('The AI returned an empty answer', true);
    return content;
  }
}
