import { MatchRequest, MatchSuggestion, MaterialMatcher } from '../ports';

// "Jev, then LLM": Jev is fast, cheap and gives a calibrated confidence, so it
// answers first. When it's unsure (or down), the LLM decides — and explains.
export class CombinedMaterialMatcher implements MaterialMatcher {
  constructor(
    private readonly first: MaterialMatcher,
    private readonly fallback: MaterialMatcher,
    private readonly minConfidence: number
  ) {}

  async match(request: MatchRequest): Promise<MatchSuggestion> {
    let first: MatchSuggestion | null = null;
    let firstError: string | null = null;
    try {
      first = await this.first.match(request);
      if (first.confidence >= this.minConfidence) return first;
    } catch (err) {
      firstError = err instanceof Error ? err.message : 'failed';
    }

    const second = await this.fallback.match(request);
    if (!first) return { ...second, reason: [second.reason, `(${firstError})`].filter(Boolean).join(' ') };
    if (first.seriesId === second.seriesId) {
      return { ...second, confidence: Math.max(first.confidence, second.confidence), matcher: `${first.matcher}+${second.matcher}` };
    }
    const label = first.seriesId ?? 'no category';
    const note = `(${first.matcher} suggested ${label} at ${Math.round(first.confidence * 100)}%)`;
    return { ...second, reason: [second.reason, note].filter(Boolean).join(' ') };
  }
}
