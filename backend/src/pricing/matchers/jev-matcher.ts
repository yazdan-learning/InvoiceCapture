import { AiUnavailableError, isRetryableStatus } from '../../ai/errors';
import { MatchRequest, MatchSuggestion, MaterialMatcher, seriesLabel } from '../ports';

export type JevConfig = {
  /** The app URL from TypeSafe's app page. */
  baseUrl: string;
  apiKey: string;
  /** "jev/<model>", e.g. jev/jev-latest */
  model: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
};

/** The "no category fits" option. Index ids never collide with it. */
const NONE = 'NONE';

/** A choice question allows at most this many options. */
export const JEV_MAX_OPTIONS = 255;

type ChoiceAnswer = { type?: string; choice?: string; probabilities?: Record<string, number>; confidence?: number };
type SystemOneResponse = { answers?: Record<string, ChoiceAnswer>; error?: { message?: string } | string };

// TypeSafe AI's Jev: a decision model that answers typed questions with
// calibrated probabilities instead of writing text. One "choice" question:
// which candidate category is this material? Built from the API shape third
// parties document (POST {app}/v1/systemone with state + questions) — check it
// against TypeSafe's own reference once there is a key.
export class JevMaterialMatcher implements MaterialMatcher {
  constructor(private readonly config: JevConfig) {}

  async match({ material, candidates, examples }: MatchRequest): Promise<MatchSuggestion> {
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new AiUnavailableError('Jev is not configured (JEV_BASE_URL, JEV_API_KEY)');
    }
    if (candidates.length + 1 > JEV_MAX_OPTIONS) {
      throw new AiUnavailableError(`Jev takes at most ${JEV_MAX_OPTIONS - 1} candidate categories per question`);
    }

    const criteria: Record<string, string> = { [NONE]: 'No category fits: services, labour, or goods without an index' };
    for (const c of candidates) criteria[c.id] = seriesLabel(c);

    let response: Response;
    try {
      response = await (this.config.fetchFn ?? fetch)(`${this.config.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          state: {
            material: { name: material.name, unit: material.unit },
            confirmedMatchesOfThisCompany: examples
          },
          questions: {
            category: {
              type: 'choice',
              instructions:
                'Which US Producer Price Index category does this raw material belong to? The name is often Persian, with specs (thickness, grade, brand) that do not change the category. Prefer the most specific category; choose a broader one when only that fits.',
              criteria
            }
          }
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      throw new AiUnavailableError(`Jev unreachable: ${(err as Error).message}`);
    }

    const json = (await response.json().catch(() => null)) as SystemOneResponse | null;
    if (!response.ok) {
      const message = typeof json?.error === 'string' ? json.error : json?.error?.message;
      throw new AiUnavailableError(message ?? `Jev failed (HTTP ${response.status})`, isRetryableStatus(response.status));
    }

    const answer = json?.answers?.category;
    if (!answer?.choice || !(answer.choice in criteria)) throw new AiUnavailableError('Jev returned no choice', true);

    const seriesId = answer.choice === NONE ? null : answer.choice;
    const confidence = typeof answer.confidence === 'number' ? answer.confidence : (answer.probabilities?.[answer.choice] ?? 0);
    return { seriesId, confidence: Math.min(1, Math.max(0, confidence)), reason: runnerUp(answer, criteria), matcher: 'JEV' };
  }
}

/** Jev gives no explanation; the second-best option is the useful hint for the reviewer. */
function runnerUp(answer: ChoiceAnswer, criteria: Record<string, string>): string | null {
  const [, second] = Object.entries(answer.probabilities ?? {}).sort(([, a], [, b]) => b - a);
  if (!second || !(second[0] in criteria)) return null;
  return `Next best: ${criteria[second[0]]} (${Math.round(second[1] * 100)}%)`;
}
