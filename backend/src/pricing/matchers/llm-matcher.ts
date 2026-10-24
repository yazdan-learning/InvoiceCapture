import { LlmClient } from '../../ai/gateway/llm';
import { num, parseJsonObject } from '../../ai/replies';
import { MatchRequest, MatchSuggestion, MaterialMatcher, seriesLabel } from '../ports';

const SYSTEM = `You match raw materials from an ERP to categories of the US Producer Price Index (PPI).
Material names are often Persian, in the trade's own words, with specs (thickness, grade, size, brand) that don't change the category.

Rules:
- Pick the most specific category that covers the material. If only a broader one fits, pick that parent category.
- Pick null when no category fits (services, labour, goods with no index).
- Use only an id from the candidate list.
- Answer with JSON only: {"seriesId": string | null, "confidence": number from 0 to 1, "reason": one short English sentence}.`;

/** Any LLM behind the AI gateway (Settings → Material matching → LLM). */
export class LlmMaterialMatcher implements MaterialMatcher {
  constructor(private readonly llm: LlmClient) {}

  async match({ material, candidates, examples }: MatchRequest): Promise<MatchSuggestion> {
    const lines = candidates.map((c) => `${c.id} | ${seriesLabel(c)}`).join('\n');
    const shown = examples.length
      ? `\n\nMatches confirmed earlier by this company:\n${examples.map((e) => `${e.name} → ${e.seriesId ?? 'null'}`).join('\n')}`
      : '';
    const prompt = `Candidates (id | category):\n${lines}${shown}\n\nMaterial: ${material.name}${material.unit ? `\nUnit: ${material.unit}` : ''}`;

    const answer = parseJsonObject(await this.llm.complete({ model: 'fast', system: SYSTEM, prompt, temperature: 0, maxTokens: 300 }));

    // Model output is untrusted: an id that isn't a candidate counts as "no match".
    const seriesId = typeof answer.seriesId === 'string' && candidates.some((c) => c.id === answer.seriesId) ? answer.seriesId : null;
    const confidence = Math.min(1, Math.max(0, num(answer.confidence) ?? 0));
    const reason = typeof answer.reason === 'string' && answer.reason.trim() ? answer.reason.trim() : null;
    return { seriesId, confidence: seriesId || answer.seriesId === null ? confidence : 0, reason, matcher: 'LLM' };
  }
}
