import { prisma } from '../../config/prisma';
import { AI_USE_CASES, AiProvider, AiUseCase } from './catalog';
import type { AiChoices, AiModelsStore } from './ai-models';

/** AiModelSetting rows: one per use case with a choice. */
export const aiModelsRepository: AiModelsStore = {
  async load() {
    const rows = await prisma.aiModelSetting.findMany();
    const choices: AiChoices = {};
    for (const row of rows) {
      if (!(AI_USE_CASES as readonly string[]).includes(row.useCase)) continue;
      choices[row.useCase as AiUseCase] = row.provider === 'OFF' ? { provider: 'OFF' } : { provider: row.provider as AiProvider, model: row.model };
    }
    return choices;
  },

  async save(choices) {
    const entries = Object.entries(choices) as [AiUseCase, NonNullable<AiChoices[AiUseCase]>][];
    await prisma.$transaction([
      prisma.aiModelSetting.deleteMany({ where: { useCase: { notIn: entries.map(([useCase]) => useCase) } } }),
      ...entries.map(([useCase, choice]) => {
        const data = { provider: choice.provider, model: 'model' in choice ? choice.model : '' };
        return prisma.aiModelSetting.upsert({ where: { useCase }, create: { useCase, ...data }, update: data });
      })
    ]);
  }
};
