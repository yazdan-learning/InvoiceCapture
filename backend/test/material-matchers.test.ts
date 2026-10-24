import { describe, expect, it, vi } from 'vitest';
import { LlmMaterialMatcher } from '../src/pricing/matchers/llm-matcher';
import { JevMaterialMatcher } from '../src/pricing/matchers/jev-matcher';
import { CombinedMaterialMatcher } from '../src/pricing/matchers/combined-matcher';
import { MatchRequest, MaterialMatcher, MatchSuggestion } from '../src/pricing/ports';
import { FakeLlm } from './fakes';

const request: MatchRequest = {
  material: { name: 'ورق گالوانیزه ۰.۵ میل', unit: 'کیلوگرم' },
  candidates: [
    { id: 'STEEL_MILL', title: 'Steel mill products', path: ['Metals'] },
    { id: 'STEEL_GALV_SHEET', title: 'Hot-dipped galvanized steel sheet', path: ['Metals', 'Steel mill products'] }
  ],
  examples: [{ name: 'میلگرد A3', seriesId: 'STEEL_MILL' }]
};

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const jevConfig = { baseUrl: 'https://app.typesafe.test/', apiKey: 'key', model: 'jev/jev-latest', timeoutMs: 1000 };

describe('LlmMaterialMatcher', () => {
  it('sends the candidates and confirmed examples, and returns the chosen id', async () => {
    const llm = new FakeLlm({ seriesId: 'STEEL_GALV_SHEET', confidence: 0.9, reason: 'Galvanized steel sheet' });
    const result = await new LlmMaterialMatcher(llm).match(request);
    expect(result).toEqual({ seriesId: 'STEEL_GALV_SHEET', confidence: 0.9, reason: 'Galvanized steel sheet', matcher: 'LLM' });
    expect(llm.requests[0].prompt).toContain('STEEL_GALV_SHEET | Metals › Steel mill products › Hot-dipped galvanized steel sheet');
    expect(llm.requests[0].prompt).toContain('میلگرد A3 → STEEL_MILL');
  });

  it('treats an id outside the candidates as no match', async () => {
    const result = await new LlmMaterialMatcher(new FakeLlm({ seriesId: 'MADE_UP', confidence: 0.95 })).match(request);
    expect(result).toMatchObject({ seriesId: null, confidence: 0 });
  });

  it('keeps an explicit "no category fits" with its confidence', async () => {
    const result = await new LlmMaterialMatcher(new FakeLlm({ seriesId: null, confidence: 0.8, reason: 'A service' })).match(request);
    expect(result).toMatchObject({ seriesId: null, confidence: 0.8 });
  });
});

describe('JevMaterialMatcher', () => {
  it('asks one choice question with every candidate plus "none"', async () => {
    const fetchFn = respond({
      answers: {
        category: { type: 'choice', choice: 'STEEL_GALV_SHEET', probabilities: { STEEL_GALV_SHEET: 0.86, STEEL_MILL: 0.12, NONE: 0.02 }, confidence: 0.81 }
      }
    });
    const result = await new JevMaterialMatcher({ ...jevConfig, fetchFn }).match(request);

    expect(result).toEqual({
      seriesId: 'STEEL_GALV_SHEET',
      confidence: 0.81,
      reason: 'Next best: Metals › Steel mill products (12%)',
      matcher: 'JEV'
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.typesafe.test/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('jev/jev-latest');
    expect(body.state.material.name).toBe('ورق گالوانیزه ۰.۵ میل');
    expect(body.questions.category.type).toBe('choice');
    expect(Object.keys(body.questions.category.criteria)).toEqual(['NONE', 'STEEL_MILL', 'STEEL_GALV_SHEET']);
  });

  it('maps "none" to no category', async () => {
    const fetchFn = respond({ answers: { category: { type: 'choice', choice: 'NONE', confidence: 0.7 } } });
    expect(await new JevMaterialMatcher({ ...jevConfig, fetchFn }).match(request)).toMatchObject({ seriesId: null, confidence: 0.7 });
  });

  it('fails clearly without a key, and on an HTTP error', async () => {
    await expect(new JevMaterialMatcher({ ...jevConfig, apiKey: '' }).match(request)).rejects.toThrow('Jev is not configured');
    const fetchFn = respond({ error: { message: 'max_tokens_exceeded' } }, 400);
    await expect(new JevMaterialMatcher({ ...jevConfig, fetchFn }).match(request)).rejects.toThrow('max_tokens_exceeded');
  });
});

describe('CombinedMaterialMatcher', () => {
  const fixed = (answer: Partial<MatchSuggestion> | Error): MaterialMatcher & { match: ReturnType<typeof vi.fn> } => ({
    match: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return { seriesId: 'STEEL_MILL', confidence: 0.5, reason: null, matcher: 'X', ...answer };
    })
  });

  it("keeps Jev's answer when it is confident, without asking the LLM", async () => {
    const jev = fixed({ seriesId: 'STEEL_GALV_SHEET', confidence: 0.9, matcher: 'JEV' });
    const llm = fixed({ matcher: 'LLM' });
    expect(await new CombinedMaterialMatcher(jev, llm, 0.7).match(request)).toMatchObject({ seriesId: 'STEEL_GALV_SHEET', matcher: 'JEV' });
    expect(llm.match).not.toHaveBeenCalled();
  });

  it('asks the LLM when Jev is unsure, and notes a disagreement', async () => {
    const jev = fixed({ seriesId: 'STEEL_MILL', confidence: 0.4, matcher: 'JEV' });
    const llm = fixed({ seriesId: 'STEEL_GALV_SHEET', confidence: 0.85, reason: 'Galvanized', matcher: 'LLM' });
    const result = await new CombinedMaterialMatcher(jev, llm, 0.7).match(request);
    expect(result).toMatchObject({ seriesId: 'STEEL_GALV_SHEET', matcher: 'LLM', reason: 'Galvanized (JEV suggested STEEL_MILL at 40%)' });
  });

  it('marks agreement of both models', async () => {
    const jev = fixed({ seriesId: 'STEEL_MILL', confidence: 0.6, matcher: 'JEV' });
    const llm = fixed({ seriesId: 'STEEL_MILL', confidence: 0.8, matcher: 'LLM' });
    expect(await new CombinedMaterialMatcher(jev, llm, 0.7).match(request)).toMatchObject({ confidence: 0.8, matcher: 'JEV+LLM' });
  });

  it('falls back to the LLM when Jev fails', async () => {
    const llm = fixed({ seriesId: 'STEEL_MILL', confidence: 0.8, reason: 'Steel', matcher: 'LLM' });
    const result = await new CombinedMaterialMatcher(fixed(new Error('Jev is not configured')), llm, 0.7).match(request);
    expect(result).toMatchObject({ matcher: 'LLM', reason: 'Steel (Jev is not configured)' });
  });
});
