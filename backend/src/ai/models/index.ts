import { AiModels } from './ai-models';
import { aiModelsRepository } from './ai-models.repository';
import { AI_PROVIDER_NAMES, AI_USE_CASES, OPTIONAL_USE_CASES, SUGGESTED_MODELS, providersFor } from './catalog';

export { AiModels, validChoices } from './ai-models';
export type { AiChoice, AiChoices } from './ai-models';

/** The app's one AiModels (Settings → AI models); server.ts loads the saved choices at start-up. */
export const aiModels = new AiModels(aiModelsRepository);

/** What Settings → AI models shows: the providers with a key, and per use case its choice, .env default and suggestions. */
export function aiModelsView(models: AiModels) {
  const available = models.availableProviders();
  return {
    providers: available.map((id) => ({ id, name: AI_PROVIDER_NAMES[id] })),
    useCases: AI_USE_CASES.map((id) => ({
      id,
      choice: models.choice(id) ?? null,
      serverDefault: models.serverDefault(id),
      canTurnOff: OPTIONAL_USE_CASES.includes(id),
      providers: providersFor(id).filter((p) => available.includes(p)),
      suggestions: Object.fromEntries(providersFor(id).filter((p) => available.includes(p)).map((p) => [p, SUGGESTED_MODELS[id][p] ?? []]))
    }))
  };
}
