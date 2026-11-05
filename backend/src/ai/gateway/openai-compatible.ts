// Any provider speaking the OpenAI chat-completions API (Mistral, OpenAI, Groq,
// OpenRouter, Ollama, LiteLLM). Shared with Nestmate: see @yazdan-learning/ai.
import { OpenAiCompatibleConfig as SharedConfig, OpenAiCompatibleLlm as SharedLlm } from '@yazdan-learning/ai';
import { ModelTier } from './llm';

export type OpenAiCompatibleConfig = SharedConfig<ModelTier>;
export class OpenAiCompatibleLlm extends SharedLlm<ModelTier> {}
