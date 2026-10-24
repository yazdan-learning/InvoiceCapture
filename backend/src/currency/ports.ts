// Where exchange rates come from, chosen per organization (Settings → Currency
// converter) — see ./registry.ts. Used to convert receipts into the
// organization's currency and to price raw materials.

export type ExchangeRate = {
  rate: number;
  asOf: Date;
};

// Returns just the rate, not a converted amount — a receipt needs
// subtotal/tax/total all converted at the same rate, so the caller fetches the
// rate once and does the multiplication itself rather than making three round
// trips for one invoice. `date`, when given, asks for the rate as of that day
// (e.g. the invoice's own date) rather than today's — someone uploading a
// receipt a few days late shouldn't get today's rate applied to a purchase
// made earlier.
export interface CurrencyConverter {
  getRate(from: string, to: string, date?: Date): Promise<ExchangeRate>;
}
