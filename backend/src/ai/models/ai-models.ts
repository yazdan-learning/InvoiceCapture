import { env } from '../../config/env';
import { MistralOcr } from '../gateway/mistral-ocr';
import { PdfChatOcr } from '../gateway/lighton-ocr';
import { OpenAiCompatibleLlm } from '../gateway/openai-compatible';
import type { OcrClient } from '../gateway/ocr';
import { AI_PROVIDERS, AI_USE_CASES, AiProvider, AiUseCase, OPTIONAL_USE_CASES, providersFor, reasoningEffortFor } from './catalog';

/** A use case's choice in Settings → AI models; a use case without one uses the .env setup. */
export type AiChoice = { provider: AiProvider; model: string } | { provider: 'OFF' };
export type AiChoices = Partial<Record<AiUseCase, AiChoice>>;

export type AiModelsStore = {
  load(): Promise<AiChoices>;
  /** Replaces all choices (a use case left out goes back to the .env setup). */
  save(choices: AiChoices): Promise<void>;
};

export type ProviderConfig = Record<AiProvider, { baseUrl: string; apiKey: string }>;

/** A choice the server can't honour (its key was removed from .env) counts as no choice. */
function usable(useCase: AiUseCase, choice: AiChoice | undefined, providers: ProviderConfig): AiChoice | undefined {
  if (!choice) return undefined;
  if (choice.provider === 'OFF') return OPTIONAL_USE_CASES.includes(useCase) ? choice : undefined;
  return providersFor(useCase).includes(choice.provider) && providers[choice.provider].apiKey && choice.model ? choice : undefined;
}

/** The choices that make sense, for saving: unknown use cases, providers without a key, empty models are dropped. */
export function validChoices(input: Record<string, unknown>, providers: ProviderConfig = env.aiProviders): AiChoices {
  const out: AiChoices = {};
  for (const useCase of AI_USE_CASES) {
    const raw = input[useCase] as { provider?: unknown; model?: unknown } | undefined;
    if (!raw || typeof raw.provider !== 'string') continue;
    const choice: AiChoice | null =
      raw.provider === 'OFF'
        ? { provider: 'OFF' }
        : (AI_PROVIDERS as readonly string[]).includes(raw.provider)
          ? { provider: raw.provider as AiProvider, model: String(raw.model ?? '').trim() }
          : null;
    const ok = choice && usable(useCase, choice, providers);
    if (ok) out[useCase] = ok;
  }
  return out;
}

/**
 * The model behind each outside AI use case, for the whole app: the choice made in Settings → AI models, else
 * the .env setup (MISTRAL_*, LLM_*, VISION_*). `version` changes on every save, so whoever built clients
 * from it can build them again; API keys only ever come from .env.
 */
export class AiModels {
  private choices: AiChoices = {};
  version = 0;

  constructor(
    private readonly store: AiModelsStore | null,
    private readonly providers: ProviderConfig = env.aiProviders
  ) {}

  /** Reads the saved choices (at start-up). Without it, everything runs on the .env setup. */
  async load(): Promise<void> {
    if (!this.store) return;
    this.choices = await this.store.load();
    this.version++;
  }

  async save(choices: AiChoices): Promise<void> {
    await this.store?.save(choices);
    this.choices = { ...choices };
    this.version++;
  }

  /** The choice in effect for a use case; undefined = the .env setup. */
  choice(useCase: AiUseCase): AiChoice | undefined {
    return usable(useCase, this.choices[useCase], this.providers);
  }

  saved(): AiChoices {
    return { ...this.choices };
  }

  availableProviders(): AiProvider[] {
    return AI_PROVIDERS.filter((p) => this.providers[p].apiKey);
  }

  ocr(): OcrClient {
    const choice = this.choice('OCR');
    if (choice?.provider === 'SCALEWAY') {
      // LightOnOCR takes ~40 s for a dense page.
      return new PdfChatOcr({ ...this.providers.SCALEWAY, model: choice.model, timeoutMs: Math.max(env.aiTimeoutMs, 180_000) });
    }
    if (choice?.provider === 'MISTRAL') return new MistralOcr({ ...env.ocr, ...this.providers.MISTRAL, model: choice.model, timeoutMs: env.aiTimeoutMs });
    return new MistralOcr({ ...env.ocr, timeoutMs: env.aiTimeoutMs });
  }

  /** The main reading model (structuring, re-reading with the photo, matching raw materials). */
  reading(): OpenAiCompatibleLlm {
    return this.chosen('READING', env.aiTimeoutMs) ?? new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs });
  }

  /** The cheaper model for trusted known forms; null = none (the main model reads them). */
  template(): OpenAiCompatibleLlm | null {
    if (this.choice('TEMPLATE')) return this.chosen('TEMPLATE', env.aiTimeoutMs);
    const model = env.llm.templateModel;
    return model ? new OpenAiCompatibleLlm({ ...env.llm, models: { fast: model, smart: model }, timeoutMs: env.aiTimeoutMs }) : null;
  }

  /** The vision model; null = none configured (callers fall back to the main model). */
  vision(): OpenAiCompatibleLlm | null {
    if (this.choice('VISION')) return this.chosen('VISION', env.vision.timeoutMs);
    return env.vision.apiKey ? new OpenAiCompatibleLlm({ ...env.vision, models: { fast: env.vision.model, smart: env.vision.model } }) : null;
  }

  /** The last look at a reading that still doesn't add up; null = skipped. */
  large(): OpenAiCompatibleLlm | null {
    if (this.choice('LARGE')) return this.chosen('LARGE', env.aiTimeoutMs);
    const model = env.llm.largeModel;
    return model ? new OpenAiCompatibleLlm({ ...env.llm, models: { fast: model, smart: model }, timeoutMs: env.aiTimeoutMs }) : null;
  }

  /** What a use case uses with no choice made, for the settings page ("" = off). */
  serverDefault(useCase: AiUseCase): string {
    switch (useCase) {
      case 'OCR':
        return env.ocr.model;
      case 'READING':
        return env.llm.models.fast;
      case 'TEMPLATE':
        return env.llm.templateModel;
      case 'VISION':
        return env.vision.apiKey ? env.vision.model : '';
      case 'LARGE':
        return env.llm.largeModel;
    }
  }

  /** The chosen model as a client; null when the use case is switched off. Undefined choice → null too (callers check first). */
  private chosen(useCase: AiUseCase, timeoutMs: number): OpenAiCompatibleLlm | null {
    const choice = this.choice(useCase);
    if (!choice || choice.provider === 'OFF') return null;
    const { baseUrl, apiKey } = this.providers[choice.provider];
    return new OpenAiCompatibleLlm({
      baseUrl,
      apiKey,
      models: { fast: choice.model, smart: choice.model },
      timeoutMs,
      reasoningEffort: reasoningEffortFor(choice.provider, choice.model, env.vision.reasoningEffort)
    });
  }
}
