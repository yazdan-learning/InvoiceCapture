import { Actor } from '../auth/auth.middleware';
import { canManageMaterialPrices } from '../auth/permissions';
import { CurrencyConverter } from '../currency/ports';
import { getCurrencyConverter } from '../currency/registry';
import { MODULE_NAMES } from '../organization/modules';
import { BadRequestError, ForbiddenError, NotFoundError } from '../shared/errors';
import { getMaterialMatcher } from './matchers/registry';
import { IndexSeries, MaterialMatcher, PriceIndexSource, seriesLabel } from './ports';
import { INDEX_CURRENCY, normalizeMaterialName, proposePrice } from './price-calculation';
import { PricingRepository, pricingRepository as prismaPricingRepository, StoredMaterial, SuggestionFields } from './pricing.repository';
import { SAMPLE_MATERIALS, SAMPLE_PRICE_DATE } from './sample-materials';
import { SamplePriceIndexSource } from './adapters/sample-price-index-source';

type Deps = {
  /** Prisma by default; tests pass a fake. */
  repository?: PricingRepository;
  indexSource?: PriceIndexSource;
  /** The organization's matcher and exchange-rate source, by their ids (see the registries). */
  matcherFor?: (id: string) => MaterialMatcher;
  currencyConverterFor?: (id: string) => CurrencyConverter;
  today?: () => Date;
};

export type NewMaterialInput = { name: string; unit?: string | null; price: number; priceDate: Date; currency?: string };
export type MaterialEdit = { name?: string; unit?: string | null; price?: number; priceDate?: Date };

const NO_SUGGESTION: SuggestionFields = { suggestedSeriesId: null, suggestionConfidence: null, suggestionReason: null, suggestedBy: null, matchError: null };

export function createPricingService({
  repository = prismaPricingRepository,
  indexSource = new SamplePriceIndexSource(),
  matcherFor = getMaterialMatcher,
  currencyConverterFor = getCurrencyConverter,
  today = () => new Date()
}: Deps = {}) {
  // Switched off in Settings = refused here too, not only hidden in the UI.
  async function requireAccess(organizationId: string, actor: Actor) {
    const settings = await repository.getSettings(organizationId);
    if (!settings.modules.includes('RAW_MATERIAL_PRICING')) {
      throw new ForbiddenError(`${MODULE_NAMES.RAW_MATERIAL_PRICING} is not enabled for your organization`);
    }
    if (!canManageMaterialPrices(actor.role)) throw new ForbiddenError('Only accountants can manage material prices');
    return settings;
  }

  async function findMaterial(organizationId: string, id: string) {
    const material = await repository.findMaterial(organizationId, id);
    if (!material) throw new NotFoundError('Material not found');
    return material;
  }

  async function seriesById() {
    return new Map((await indexSource.listSeries()).map((s) => [s.id, s]));
  }

  /**
   * What to suggest for a name: a person's earlier decision for the same name
   * first (no AI call), otherwise the organization's matcher. A failing AI
   * doesn't block saving the material — the error is shown for review.
   */
  async function suggest(organizationId: string, name: string, unit: string | null, matcherId: string, excludeId?: string): Promise<SuggestionFields> {
    const confirmed = (await repository.listConfirmed(organizationId)).filter((m) => m.id !== excludeId);
    const key = normalizeMaterialName(name);
    const same = confirmed.find((m) => normalizeMaterialName(m.name) === key);
    if (same) {
      return { ...NO_SUGGESTION, suggestedSeriesId: same.seriesId, suggestionConfidence: 1, suggestionReason: `Same as “${same.name}”, confirmed earlier`, suggestedBy: 'CONFIRMED' };
    }
    try {
      const result = await matcherFor(matcherId).match({
        material: { name, unit },
        candidates: await indexSource.listSeries(),
        examples: confirmed.slice(0, 20).map((m) => ({ name: m.name, seriesId: m.seriesId }))
      });
      return { suggestedSeriesId: result.seriesId, suggestionConfidence: result.confidence, suggestionReason: result.reason, suggestedBy: result.matcher, matchError: null };
    } catch (err) {
      return { ...NO_SUGGESTION, matchError: err instanceof Error ? err.message : 'Matching failed' };
    }
  }

  function toClient(material: StoredMaterial, series: Map<string, IndexSeries>) {
    const ref = (id: string | null) => (id && series.has(id) ? { id, label: seriesLabel(series.get(id)!) } : null);
    const pending = material.proposals[0];
    const hasSuggestion = material.suggestedBy !== null;
    return {
      id: material.id,
      name: material.name,
      unit: material.unit,
      currency: material.currency,
      currentPrice: Number(material.currentPrice),
      currentPriceDate: material.currentPriceDate,
      matchStatus: material.matchStatus,
      series: ref(material.seriesId),
      suggestion: hasSuggestion
        ? {
            series: ref(material.suggestedSeriesId),
            confidence: material.suggestionConfidence === null ? null : Number(material.suggestionConfidence),
            reason: material.suggestionReason,
            by: material.suggestedBy
          }
        : null,
      matchError: material.matchError,
      pendingProposal: pending
        ? {
            id: pending.id,
            previousPrice: Number(pending.previousPrice),
            previousDate: pending.previousDate,
            proposedPrice: Number(pending.proposedPrice),
            asOf: pending.asOf,
            change: Number(pending.proposedPrice) / Number(pending.previousPrice) - 1,
            indexFrom: Number(pending.indexFrom),
            indexTo: Number(pending.indexTo),
            indexPeriod: pending.indexPeriod,
            fxFrom: Number(pending.fxFrom),
            fxTo: Number(pending.fxTo)
          }
        : null
    };
  }

  async function respond(material: StoredMaterial) {
    return toClient(material, await seriesById());
  }

  async function createOne(organizationId: string, matcherId: string, defaultCurrency: string, input: NewMaterialInput) {
    const name = input.name.trim();
    if (await repository.findMaterialByName(organizationId, name)) throw new BadRequestError(`“${name}” already exists`);
    const unit = input.unit?.trim() || null;
    return repository.createMaterial({
      organizationId,
      name,
      unit,
      currency: input.currency ?? defaultCurrency,
      currentPrice: input.price,
      currentPriceDate: input.priceDate,
      ...(await suggest(organizationId, name, unit, matcherId))
    });
  }

  return {
    async listSeries(organizationId: string, actor: Actor) {
      await requireAccess(organizationId, actor);
      return (await indexSource.listSeries()).map((s) => ({ id: s.id, label: seriesLabel(s), depth: s.path.length }));
    },

    async listMaterials(organizationId: string, actor: Actor) {
      await requireAccess(organizationId, actor);
      const series = await seriesById();
      return (await repository.listMaterials(organizationId)).map((m) => toClient(m, series));
    },

    async createMaterial(organizationId: string, actor: Actor, input: NewMaterialInput) {
      const settings = await requireAccess(organizationId, actor);
      return respond(await createOne(organizationId, settings.materialMatcher, settings.defaultCurrency, input));
    },

    /** The POC's sample list (prices in Rial); materials that already exist are skipped. */
    async loadSampleMaterials(organizationId: string, actor: Actor) {
      const settings = await requireAccess(organizationId, actor);
      let added = 0;
      for (const sample of SAMPLE_MATERIALS) {
        if (await repository.findMaterialByName(organizationId, sample.name)) continue;
        await createOne(organizationId, settings.materialMatcher, settings.defaultCurrency, {
          name: sample.name,
          unit: sample.unit,
          price: sample.price,
          priceDate: SAMPLE_PRICE_DATE,
          currency: 'IRR'
        });
        added++;
      }
      return { added };
    },

    /**
     * A rename asks the AI again — unless only the spelling changed. The price
     * keeps following the confirmed category until a person accepts a new one.
     * A price typed by hand becomes the new starting point and drops a pending proposal.
     */
    async updateMaterial(organizationId: string, actor: Actor, id: string, edit: MaterialEdit) {
      const settings = await requireAccess(organizationId, actor);
      const material = await findMaterial(organizationId, id);
      const name = edit.name?.trim();
      const unit = edit.unit === undefined ? material.unit : edit.unit?.trim() || null;

      let matchFields = {};
      if (name && name !== material.name) {
        if (await repository.findMaterialByName(organizationId, name)) throw new BadRequestError(`“${name}” already exists`);
        if (normalizeMaterialName(name) !== normalizeMaterialName(material.name) || material.matchStatus === 'NEEDS_REVIEW') {
          const suggestion = await suggest(organizationId, name, unit, settings.materialMatcher, id);
          const unchanged = material.matchStatus === 'CONFIRMED' && !suggestion.matchError && suggestion.suggestedSeriesId === material.seriesId;
          matchFields = unchanged ? NO_SUGGESTION : { ...suggestion, matchStatus: 'NEEDS_REVIEW' as const };
        }
      }

      const priceChanged = edit.price !== undefined || edit.priceDate !== undefined;
      if (priceChanged) await repository.dropPendingProposals(id);
      return respond(
        await repository.updateMaterial(id, {
          ...(name ? { name } : {}),
          unit,
          ...(edit.price !== undefined ? { currentPrice: edit.price } : {}),
          ...(edit.priceDate !== undefined ? { currentPriceDate: edit.priceDate } : {}),
          ...matchFields
        })
      );
    },

    async deleteMaterial(organizationId: string, actor: Actor, id: string) {
      await requireAccess(organizationId, actor);
      await findMaterial(organizationId, id);
      await repository.deleteMaterial(id);
    },

    async rematch(organizationId: string, actor: Actor, id: string) {
      const settings = await requireAccess(organizationId, actor);
      const material = await findMaterial(organizationId, id);
      const suggestion = await suggest(organizationId, material.name, material.unit, settings.materialMatcher, id);
      return respond(await repository.updateMaterial(id, { ...suggestion, matchStatus: 'NEEDS_REVIEW' }));
    },

    /** A person decides: this category (the suggestion or another one), or null = no index fits. */
    async confirmMatch(organizationId: string, actor: Actor, id: string, seriesId: string | null) {
      await requireAccess(organizationId, actor);
      const material = await findMaterial(organizationId, id);
      if (seriesId !== null && !(await seriesById()).has(seriesId)) throw new BadRequestError('Unknown index category');
      if (seriesId !== material.seriesId) await repository.dropPendingProposals(id);
      return respond(
        await repository.updateMaterial(id, { ...NO_SUGGESTION, seriesId, matchStatus: seriesId === null ? 'NO_INDEX' : 'CONFIRMED' })
      );
    },

    /**
     * Today's proposals for every material with a confirmed category, from its
     * last approved price. Run by hand in the POC; a daily job calls the same.
     */
    async runPricing(organizationId: string, actor: Actor) {
      const settings = await requireAccess(organizationId, actor);
      const converter = currencyConverterFor(settings.currencyConverter);
      const asOf = today();
      const rates = new Map<string, Promise<number>>();
      const usdRate = (currency: string, date: Date) => {
        const key = `${currency}:${date.toISOString().slice(0, 10)}`;
        if (!rates.has(key)) rates.set(key, converter.getRate(INDEX_CURRENCY, currency, date).then((r) => r.rate));
        return rates.get(key)!;
      };

      const result = { proposed: 0, unchanged: 0, failed: [] as { name: string; error: string }[] };
      for (const material of await repository.listMaterials(organizationId)) {
        if (!material.seriesId) continue;
        try {
          const [indexFrom, indexTo] = await Promise.all([
            indexSource.valueAt(material.seriesId, material.currentPriceDate),
            indexSource.valueAt(material.seriesId, asOf)
          ]);
          if (!indexFrom || !indexTo) throw new Error('No index value for the price date');
          const [fxFrom, fxTo] = await Promise.all([usdRate(material.currency, material.currentPriceDate), usdRate(material.currency, asOf)]);
          const previousPrice = Number(material.currentPrice);
          const { proposedPrice, worthProposing } = proposePrice({ previousPrice, indexFrom: indexFrom.value, indexTo: indexTo.value, fxFrom, fxTo });
          if (!worthProposing) {
            await repository.dropPendingProposals(material.id);
            result.unchanged++;
            continue;
          }
          await repository.replacePendingProposal(material.id, {
            seriesId: material.seriesId,
            previousPrice,
            previousDate: material.currentPriceDate,
            proposedPrice,
            asOf,
            indexFrom: indexFrom.value,
            indexTo: indexTo.value,
            indexPeriod: indexTo.period,
            fxFrom,
            fxTo
          });
          result.proposed++;
        } catch (err) {
          // Never drop the old price: the material keeps its price and says why.
          result.failed.push({ name: material.name, error: err instanceof Error ? err.message : 'Pricing failed' });
        }
      }
      return result;
    },

    async approveProposal(organizationId: string, actor: Actor, id: string) {
      await requireAccess(organizationId, actor);
      const proposal = await repository.findProposal(organizationId, id);
      if (!proposal) throw new NotFoundError('Price proposal not found');
      if (proposal.status !== 'PENDING') throw new BadRequestError('This price proposal was already decided');
      await repository.approveProposal(proposal, actor.userId);
      return respond(await findMaterial(organizationId, proposal.materialId));
    },

    async rejectProposal(organizationId: string, actor: Actor, id: string) {
      await requireAccess(organizationId, actor);
      const proposal = await repository.findProposal(organizationId, id);
      if (!proposal) throw new NotFoundError('Price proposal not found');
      if (proposal.status !== 'PENDING') throw new BadRequestError('This price proposal was already decided');
      await repository.rejectProposal(id, actor.userId);
      return respond(await findMaterial(organizationId, proposal.materialId));
    }
  };
}

export type PricingService = ReturnType<typeof createPricingService>;
