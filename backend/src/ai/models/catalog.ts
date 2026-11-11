// Settings → AI models: every place the app calls an outside AI service, and the providers each can be
// switched to. Tesseract (our own OCR service, TESSERACT_URL) isn't here: it's free and stays as it is.

/**
 * OCR: page → text. READING: the main model (structuring the OCR text, re-reading with the photo, matching
 * raw materials). TEMPLATE: the cheaper model for trusted known forms. VISION: handwriting, reading from the
 * image, placing review boxes, "Read with AI". LARGE: an optional last look at a reading that doesn't add up.
 */
export const AI_USE_CASES = ['OCR', 'READING', 'TEMPLATE', 'VISION', 'LARGE'] as const;
export type AiUseCase = (typeof AI_USE_CASES)[number];

export const AI_PROVIDERS = ['MISTRAL', 'GOOGLE', 'SCALEWAY'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  MISTRAL: 'Mistral',
  GOOGLE: 'Google Gemini',
  SCALEWAY: 'Scaleway'
};

/** A use case that can also be switched off (the app then does without it, as with an empty .env value). */
export const OPTIONAL_USE_CASES: readonly AiUseCase[] = ['TEMPLATE', 'LARGE'];

/**
 * Models offered per use case and provider (the first is the suggestion); any other model name of the
 * provider can be typed in. Prices (per million tokens, in / out, November 2026) in the comments.
 * OCR has its own kind of model: Mistral OCR, or LightOnOCR on Scaleway.
 */
export const SUGGESTED_MODELS: Record<AiUseCase, Partial<Record<AiProvider, string[]>>> = {
  OCR: {
    MISTRAL: ['mistral-ocr-latest'], // ~$0.004 per page
    SCALEWAY: ['lightonocr-3-0.8b'] // ~€0.002 per page; slower (~40 s a page), a few digit slips on Persian
  },
  READING: {
    MISTRAL: ['mistral-medium-latest', 'mistral-large-latest'], // medium $0.40 / $2.00
    SCALEWAY: ['qwen3.6-35b-a3b', 'gpt-oss-120b', 'mistral-medium-3.5-128b', 'deepseek-v4.1-flash-1017'], // €0.25 / 1.50, 0.15 / 0.60, 1.50 / 7.50, 0.60 / 1.80
    GOOGLE: ['gemini-3.5-flash']
  },
  TEMPLATE: {
    MISTRAL: ['mistral-small-latest'], // $0.10 / $0.30
    SCALEWAY: ['mistral-small-3.2-24b-instruct-2506', 'gpt-oss-120b', 'qwen3.6-35b-a3b'], // €0.15 / 0.35
    GOOGLE: ['gemini-3.5-flash']
  },
  VISION: {
    GOOGLE: ['gemini-3.5-flash'], // $1.50 / $9.00
    SCALEWAY: ['qwen3.6-35b-a3b', 'qwen3.8-27b', 'qwen3.5-397b-a17b'], // €0.25 / 1.50, 0.60 / 3.30, 0.60 / 3.60
    MISTRAL: ['mistral-medium-latest']
  },
  LARGE: {
    MISTRAL: ['mistral-large-latest'],
    SCALEWAY: ['qwen3.5-397b-a17b', 'mistral-medium-3.5-128b'],
    GOOGLE: ['gemini-3.5-flash']
  }
};

/** The providers a use case can use: OCR needs a provider with an OCR model. */
export function providersFor(useCase: AiUseCase): AiProvider[] {
  return AI_PROVIDERS.filter((p) => SUGGESTED_MODELS[useCase][p]);
}

/**
 * reasoning_effort for a model. Thinking models are slow and costly at their default and can spend the whole
 * answer budget thinking (Scaleway's Qwen returned empty answers): Qwen takes "none", gpt-oss only goes down
 * to "low", Gemini follows VISION_REASONING_EFFORT; Mistral is sent none.
 */
export function reasoningEffortFor(provider: AiProvider, model: string, geminiEffort: string): string | undefined {
  if (provider === 'GOOGLE') return geminiEffort || undefined;
  if (/^qwen/i.test(model)) return 'none';
  if (/^gpt-oss/i.test(model)) return 'low';
  return undefined;
}
