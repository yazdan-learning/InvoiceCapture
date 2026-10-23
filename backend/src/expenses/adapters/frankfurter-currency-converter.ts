import { CurrencyConverter, ExchangeRate } from '../ports';

const API = 'https://api.frankfurter.dev/v2/rates';

/** Every rate is fetched against this base and crossed, so both directions keep full precision. */
const BASE = 'EUR';

type RateRow = { date: string; base: string; quote: string; rate: number };

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Free, no API key. v2 of the API: besides the European Central Bank's daily
// reference rates it has currencies the ECB doesn't publish, IRR among them.
// Unlike the Google Directions adapter, there's no "unconfigured" state to
// fall back from: this always works out of the box.
export class FrankfurterCurrencyConverter implements CurrencyConverter {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async getRate(from: string, to: string, date?: Date): Promise<ExchangeRate> {
    if (from === to) return { rate: 1, asOf: date ?? new Date() };

    // Asking for IRR → EUR directly comes back rounded to 0.000001 (about half
    // the real rate); EUR → IRR and EUR → USD don't lose digits, so the rate is
    // their ratio. Without a date the latest rates are used; on weekends and
    // holidays the API falls back to the last day it has and reports that date.
    const url = new URL(API);
    url.searchParams.set('base', BASE);
    url.searchParams.set('quotes', [from, to].filter((c) => c !== BASE).join(','));
    if (date) url.searchParams.set('date', toDateOnly(date));

    const response = await this.fetchFn(url.toString());
    if (!response.ok) {
      throw new Error(`Currency conversion request failed (${response.status})`);
    }

    const rows = (await response.json()) as RateRow[];
    const perBase = (code: string) => (code === BASE ? 1 : rows.find((row) => row.quote === code)?.rate);
    const fromRate = perBase(from);
    const toRate = perBase(to);
    if (!fromRate || !toRate || !rows.length) {
      throw new Error(`No exchange rate available for ${from} → ${to}`);
    }

    return { rate: toRate / fromRate, asOf: new Date(rows[0].date) };
  }
}
