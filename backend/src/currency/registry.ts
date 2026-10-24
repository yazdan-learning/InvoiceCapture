import { CurrencyConverter } from './ports';
import { FrankfurterCurrencyConverter } from './connectors/frankfurter';
import { FreeMarketCurrencyConverter } from './connectors/free-market';
import { env } from '../config/env';

// The one place that knows which exchange-rate sources exist. Adding one = an
// adapter in ./connectors plus one entry here; the settings page lists them.
export const CURRENCY_CONVERTER_IDS = ['FRANKFURTER', 'FREE_MARKET'] as const;
export type CurrencyConverterId = (typeof CURRENCY_CONVERTER_IDS)[number];

export const CURRENCY_CONVERTER_NAMES: Record<CurrencyConverterId, string> = {
  FRANKFURTER: 'Frankfurter (ECB reference rates)',
  FREE_MARKET: 'Free market (ASR)'
};

const CONVERTERS: Record<CurrencyConverterId, () => CurrencyConverter> = {
  FRANKFURTER: () => new FrankfurterCurrencyConverter(),
  FREE_MARKET: () => new FreeMarketCurrencyConverter(env.accounting.asr)
};

export function getCurrencyConverter(id: string): CurrencyConverter {
  const create = CONVERTERS[id as CurrencyConverterId];
  if (!create) throw new Error(`Unknown currency converter "${id}"`);
  return create();
}
