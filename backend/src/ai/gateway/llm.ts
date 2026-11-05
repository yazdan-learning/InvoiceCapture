// The AI gateway (shared with Nestmate: @yazdan-learning/ai): the only thing
// the direct adapters know about language models. Flows ask for a model
// *tier*; which provider and model that means is configuration (LLM_* env
// vars), so switching models or vendors never touches the flows.
import type { CompletionRequest as SharedCompletionRequest, LlmClient as SharedLlmClient } from '@yazdan-learning/ai';

/** "fast" = cheap and quick (parsing, matching, extraction); "smart" = better reasoning (chat). */
export type ModelTier = 'fast' | 'smart';

export type CompletionRequest = SharedCompletionRequest<ModelTier>;
export type LlmClient = SharedLlmClient<ModelTier>;
