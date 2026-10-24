import { CurrencyConverter, ExchangeRate } from '../ports';

// The open-market rate (Iran: the free-market dollar, far from the official
// one). Selectable in Settings already; the API behind it isn't chosen yet, so
// every call fails with a clear message — a receipt then keeps its original
// currency, and material pricing says why it couldn't compute.
// TODO: call the free-market rate API here once it is chosen (its URL and key
// go into env.ts and .env.example, like the ASR connector's).
export class FreeMarketCurrencyConverter implements CurrencyConverter {
  async getRate(from: string, to: string): Promise<ExchangeRate> {
    if (from === to) return { rate: 1, asOf: new Date() };
    throw new Error('The free-market rate API is not connected yet. Choose another currency converter in Settings.');
  }
}
