import { env } from '../../config/env';
import { OpenAiCompatibleLlm } from '../../ai/gateway/openai-compatible';
import { MaterialMatcher } from '../ports';
import { LlmMaterialMatcher } from './llm-matcher';
import { JevMaterialMatcher } from './jev-matcher';
import { CombinedMaterialMatcher } from './combined-matcher';

// Which AI matches raw materials to index categories, per organization
// (Organization.materialMatcher). Switching is a setting, not a code change:
// if one handles Persian names poorly, pick another.
export const MATERIAL_MATCHER_IDS = ['LLM', 'JEV', 'COMBINED'] as const;
export type MaterialMatcherId = (typeof MATERIAL_MATCHER_IDS)[number];

export const MATERIAL_MATCHER_NAMES: Record<MaterialMatcherId, string> = {
  LLM: 'LLM',
  JEV: 'Jev (TypeSafe AI)',
  COMBINED: 'Jev, then LLM when unsure'
};

// Built per call: a missing key then fails the match (with a message the
// reviewer sees), not the boot or the settings page.
const llm = () => new LlmMaterialMatcher(new OpenAiCompatibleLlm({ ...env.llm, timeoutMs: env.aiTimeoutMs }));
const jev = () => new JevMaterialMatcher(env.matching.jev);

const MATCHERS: Record<MaterialMatcherId, () => MaterialMatcher> = {
  LLM: llm,
  JEV: jev,
  COMBINED: () => new CombinedMaterialMatcher(jev(), llm(), env.matching.combinedMinConfidence)
};

export function getMaterialMatcher(id: string): MaterialMatcher {
  const create = MATERIAL_MATCHER_IDS.includes(id as MaterialMatcherId) ? MATCHERS[id as MaterialMatcherId] : null;
  if (!create) throw new Error(`Unknown material matcher "${id}"`);
  return create();
}
