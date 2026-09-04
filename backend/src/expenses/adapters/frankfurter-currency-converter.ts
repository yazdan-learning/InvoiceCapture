import { CurrencyConverter, ExchangeRate } from '../ports';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Free, no API key — a wrapper around the European Central Bank's daily
// reference rates. Unlike the Google Directions adapter, there's no
// "unconfigured" state to fall back from: this always works out of the box.
export class FrankfurterCurrencyConverter implements CurrencyConverter {
  async getRate(from: string, to: string, date?: Date): Promise<ExchangeRate> {
    // ECB doesn't publish on weekends/holidays — Frankfurter falls back to
    // the nearest prior business day automatically and reports which date it
    // actually used in the response, so we don't have to work that out ourselves.
    const path = date ? toDateOnly(date) : 'latest';
    const url = new URL(`https://api.frankfurter.app/${path}`);
    url.searchParams.set('amount', '1');
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Currency conversion request failed (${response.status})`);
    }

    const json = (await response.json()) as { date: string; rates: Record<string, number> };
    const rate = json.rates[to];
    if (rate == null) {
      throw new Error(`No exchange rate available for ${from} → ${to}`);
    }

    return { rate, asOf: new Date(json.date) };
  }
}
