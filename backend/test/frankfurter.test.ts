import { describe, expect, it, vi } from 'vitest';
import { FrankfurterCurrencyConverter } from '../src/currency/connectors/frankfurter';
import { FreeMarketCurrencyConverter } from '../src/currency/connectors/free-market';
import { getCurrencyConverter } from '../src/currency/registry';

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('FrankfurterCurrencyConverter', () => {
  it('crosses two rates against EUR so IRR keeps its precision', async () => {
    const fetchFn = respond([
      { date: '2026-10-16', base: 'EUR', quote: 'IRR', rate: 2_000_000 },
      { date: '2026-10-16', base: 'EUR', quote: 'USD', rate: 1.25 }
    ]);
    const { rate, asOf } = await new FrankfurterCurrencyConverter(fetchFn).getRate('IRR', 'USD', new Date('2026-10-18'));
    expect(rate).toBeCloseTo(6.25e-7, 12);
    expect(asOf).toEqual(new Date('2026-10-16'));
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/v2/rates');
    expect(Object.fromEntries(url.searchParams)).toEqual({ base: 'EUR', quotes: 'IRR,USD', date: '2026-10-18' });
  });

  it('asks for one quote when EUR is one side', async () => {
    const fetchFn = respond([{ date: '2026-10-16', base: 'EUR', quote: 'IRR', rate: 2_000_000 }]);
    expect((await new FrankfurterCurrencyConverter(fetchFn).getRate('EUR', 'IRR')).rate).toBe(2_000_000);
    expect(new URL(fetchFn.mock.calls[0][0] as string).searchParams.get('quotes')).toBe('IRR');
  });

  it('needs no request for the same currency', async () => {
    const fetchFn = respond([]);
    expect((await new FrankfurterCurrencyConverter(fetchFn).getRate('IRR', 'IRR')).rate).toBe(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails on an unknown currency', async () => {
    await expect(new FrankfurterCurrencyConverter(respond({ message: 'invalid currency: IRT' }, 422)).getRate('IRT', 'EUR')).rejects.toThrow('(422)');
  });
});

describe('currency converter registry', () => {
  it('has both sources and refuses an unknown one', () => {
    expect(getCurrencyConverter('FRANKFURTER')).toBeInstanceOf(FrankfurterCurrencyConverter);
    expect(getCurrencyConverter('FREE_MARKET')).toBeInstanceOf(FreeMarketCurrencyConverter);
    expect(() => getCurrencyConverter('NOPE')).toThrow('Unknown currency converter');
  });
});
