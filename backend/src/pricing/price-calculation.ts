// The index is a US price level in dollars, so a material's price in the
// organization's currency moves with both: how its category's index moved, and
// how the dollar moved against that currency, since the last approved price.
//
//   newPrice = previousPrice × (indexNow / indexThen) × (usdRateNow / usdRateThen)

/** Smaller moves than this don't produce a proposal: nobody wants to approve every 0.4 %. */
export const PRICE_CHANGE_THRESHOLD = 0.03;

/** The index's currency: every PPI series is in US dollars. */
export const INDEX_CURRENCY = 'USD';

export type PriceInputs = {
  previousPrice: number;
  indexFrom: number;
  indexTo: number;
  fxFrom: number;
  fxTo: number;
};

export function proposePrice({ previousPrice, indexFrom, indexTo, fxFrom, fxTo }: PriceInputs) {
  const factor = (indexTo / indexFrom) * (fxTo / fxFrom);
  const proposedPrice = Math.round(previousPrice * factor * 100) / 100;
  return { proposedPrice, change: factor - 1, worthProposing: Math.abs(factor - 1) >= PRICE_CHANGE_THRESHOLD };
}

/**
 * The same material written slightly differently: Arabic vs Persian letters
 * and digits, zero-width joiners, spacing and punctuation don't make a new name.
 */
export function normalizeMaterialName(name: string): string {
  return name
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍\s\-_.,/()]+/g, '')
    .toLowerCase();
}
