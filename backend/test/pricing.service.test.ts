import { describe, expect, it, vi } from 'vitest';
import { createPricingService } from '../src/pricing/pricing.service';
import { PricingRepository, StoredMaterial } from '../src/pricing/pricing.repository';
import { normalizeMaterialName, proposePrice } from '../src/pricing/price-calculation';
import { MaterialMatcher, PriceIndexSource } from '../src/pricing/ports';
import { SamplePriceIndexSource } from '../src/pricing/adapters/sample-price-index-source';
import { ForbiddenError } from '../src/shared/errors';

const accountant = { userId: 'u1', organizationId: 'org', role: 'ACCOUNTANT' as const };

function material(overrides: Partial<StoredMaterial> = {}): StoredMaterial {
  return {
    id: 'm1',
    organizationId: 'org',
    name: 'ورق گالوانیزه',
    unit: 'کیلوگرم',
    currency: 'IRR',
    currentPrice: 1000 as never,
    currentPriceDate: new Date('2026-03-21'),
    matchStatus: 'CONFIRMED',
    seriesId: 'STEEL_GALV_SHEET',
    suggestedSeriesId: null,
    suggestionConfidence: null,
    suggestionReason: null,
    suggestedBy: null,
    matchError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    proposals: [],
    ...overrides
  };
}

const index: PriceIndexSource = {
  listSeries: async () => [
    { id: 'STEEL_MILL', title: 'Steel mill products', path: ['Metals'] },
    { id: 'STEEL_GALV_SHEET', title: 'Galvanized sheet', path: ['Metals', 'Steel mill products'] }
  ],
  // 200 in March, 220 by September.
  valueAt: async (_id, date) => (date < new Date('2026-09-01') ? { period: '2026-03', value: 200 } : { period: '2026-09', value: 220 })
};

function setup({ modules = ['RAW_MATERIAL_PRICING'], stored = [material()], suggestion = { seriesId: 'STEEL_MILL', confidence: 0.6, reason: 'Steel', matcher: 'LLM' } } = {}) {
  const matcher = { match: vi.fn(async () => suggestion) } satisfies MaterialMatcher;
  // USD → IRR: 1,000,000 in March, 1,100,000 today.
  const converter = { getRate: vi.fn(async (_f: string, _t: string, date?: Date) => ({ rate: date! < new Date('2026-09-01') ? 1_000_000 : 1_100_000, asOf: date! })) };
  const repository = {
    getSettings: vi.fn(async () => ({ modules, defaultCurrency: 'IRR', currencyConverter: 'FRANKFURTER', materialMatcher: 'LLM' })),
    listMaterials: vi.fn(async () => stored),
    findMaterial: vi.fn(async (_org: string, id: string) => stored.find((m) => m.id === id) ?? null),
    findMaterialByName: vi.fn(async () => null),
    listConfirmed: vi.fn(async () => stored.filter((m) => m.matchStatus === 'CONFIRMED').map(({ id, name, seriesId }) => ({ id, name, seriesId }))),
    createMaterial: vi.fn(async (data: object) => material({ id: 'new', ...data, matchStatus: 'NEEDS_REVIEW', seriesId: null })),
    updateMaterial: vi.fn(async (id: string, data: object) => ({ ...stored.find((m) => m.id === id)!, ...data })),
    deleteMaterial: vi.fn(),
    findProposal: vi.fn(),
    dropPendingProposals: vi.fn(),
    replacePendingProposal: vi.fn(),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn()
  };
  const service = createPricingService({
    repository: repository as unknown as PricingRepository,
    indexSource: index,
    matcherFor: () => matcher,
    currencyConverterFor: () => converter,
    today: () => new Date('2026-10-24')
  });
  return { service, repository, matcher, converter };
}

describe('price calculation', () => {
  it('follows both the index and the dollar', () => {
    expect(proposePrice({ previousPrice: 1000, indexFrom: 200, indexTo: 220, fxFrom: 100, fxTo: 110 })).toEqual({
      proposedPrice: 1210,
      change: expect.closeTo(0.21, 10),
      worthProposing: true
    });
  });

  it('ignores moves under the threshold', () => {
    expect(proposePrice({ previousPrice: 1000, indexFrom: 200, indexTo: 202, fxFrom: 100, fxTo: 101 }).worthProposing).toBe(false);
  });

  it('treats spelling variants as the same name', () => {
    expect(normalizeMaterialName('ورق گالوانيزه ۰.۵')).toBe(normalizeMaterialName('ورق‌گالوانیزه 05'));
  });
});

describe('pricing service', () => {
  it('refuses when the module is off', async () => {
    const { service } = setup({ modules: ['EXPENSES'] });
    await expect(service.listMaterials('org', accountant)).rejects.toThrow(ForbiddenError);
  });

  it('refuses employees', async () => {
    const { service } = setup();
    await expect(service.listMaterials('org', { ...accountant, role: 'EMPLOYEE' })).rejects.toThrow('Only accountants');
  });

  it('asks the matcher for a new material, with confirmed ones as examples', async () => {
    const { service, matcher, repository } = setup();
    await service.createMaterial('org', accountant, { name: 'میلگرد A3', price: 500, priceDate: new Date('2026-10-01') });
    expect(matcher.match).toHaveBeenCalledWith(
      expect.objectContaining({ material: { name: 'میلگرد A3', unit: null }, examples: [{ name: 'ورق گالوانیزه', seriesId: 'STEEL_GALV_SHEET' }] })
    );
    expect(repository.createMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'IRR', suggestedSeriesId: 'STEEL_MILL', suggestionConfidence: 0.6, suggestedBy: 'LLM' })
    );
  });

  it('reuses a confirmed match for the same name without asking the AI', async () => {
    const { service, matcher, repository } = setup();
    await service.createMaterial('org', accountant, { name: 'ورق  گالوانيزه', price: 500, priceDate: new Date('2026-10-01') });
    expect(matcher.match).not.toHaveBeenCalled();
    expect(repository.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ suggestedSeriesId: 'STEEL_GALV_SHEET', suggestedBy: 'CONFIRMED' }));
  });

  it('saves the material with the error when matching fails', async () => {
    const { service, matcher, repository } = setup();
    matcher.match.mockRejectedValueOnce(new Error('AI service unreachable'));
    await service.createMaterial('org', accountant, { name: 'سیمان', price: 500, priceDate: new Date('2026-10-01') });
    expect(repository.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ suggestedSeriesId: null, matchError: 'AI service unreachable' }));
  });

  it('on a real rename, asks again but keeps pricing on the confirmed category', async () => {
    const { service, repository } = setup();
    const result = await service.updateMaterial('org', accountant, 'm1', { name: 'میلگرد A3' });
    expect(repository.updateMaterial).toHaveBeenCalledWith('m1', expect.objectContaining({ matchStatus: 'NEEDS_REVIEW', suggestedSeriesId: 'STEEL_MILL' }));
    expect(result.series?.id).toBe('STEEL_GALV_SHEET');
  });

  it('on a spelling-only rename, keeps the confirmed match without asking', async () => {
    const { service, matcher } = setup();
    await service.updateMaterial('org', accountant, 'm1', { name: 'ورق گالوانيزه' });
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it('proposes index × dollar from the last approved price', async () => {
    const { service, repository, converter } = setup();
    expect(await service.runPricing('org', accountant)).toEqual({ proposed: 1, unchanged: 0, failed: [] });
    expect(converter.getRate).toHaveBeenCalledWith('USD', 'IRR', new Date('2026-03-21'));
    expect(repository.replacePendingProposal).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ previousPrice: 1000, proposedPrice: 1210, indexFrom: 200, indexTo: 220, indexPeriod: '2026-09', fxFrom: 1_000_000, fxTo: 1_100_000 })
    );
  });

  it('skips materials without a confirmed category and reports failures per material', async () => {
    const { service, converter } = setup({ stored: [material(), material({ id: 'm2', name: 'حمل', seriesId: null, matchStatus: 'NO_INDEX' })] });
    converter.getRate.mockRejectedValue(new Error('The free-market rate API is not connected yet.'));
    expect(await service.runPricing('org', accountant)).toEqual({
      proposed: 0,
      unchanged: 0,
      failed: [{ name: 'ورق گالوانیزه', error: 'The free-market rate API is not connected yet.' }]
    });
  });

  it('refuses deciding a proposal twice', async () => {
    const { service, repository } = setup();
    repository.findProposal.mockResolvedValue({ id: 'p1', status: 'APPROVED', materialId: 'm1' });
    await expect(service.approveProposal('org', accountant, 'p1')).rejects.toThrow('already decided');
  });
});

describe('sample index', () => {
  it('has a category tree and returns the latest month on or before a date', async () => {
    const source = new SamplePriceIndexSource();
    const series = await source.listSeries();
    expect(series.find((s) => s.id === 'STEEL_REBAR')?.path).toEqual(['Metals and metal products', 'Iron and steel', 'Steel mill products']);
    expect((await source.valueAt('STEEL_REBAR', new Date('2026-10-24')))?.period).toBe('2026-09');
    expect((await source.valueAt('STEEL_REBAR', new Date('2026-03-21')))?.period).toBe('2026-03');
    expect(await source.valueAt('STEEL_REBAR', new Date('2020-01-01'))).toBeNull();
  });
});
