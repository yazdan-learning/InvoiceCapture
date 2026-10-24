import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFreeMarketCache, FreeMarketCurrencyConverter } from '../src/currency/connectors/free-market';

const config = { baseUrl: 'http://asr.test:5000/', apiKey: 'secret', timeoutMs: 1000 };

// The rows in the ASR documentation (values from 2026-10-24).
const RATES = [
  { rateDate: '2026-10-22T06:30:16.000+00:00', rate: 267565151.83, baseCurrency: 'Gold (XAU)', quoteCurrency: 'IRR' },
  { rateDate: '2026-10-21T17:29:37.000+00:00', rate: 2712000, baseCurrency: 'IRR', quoteCurrency: 'USD' },
  { rateDate: '2026-10-20T10:00:00.000+00:00', rate: 3046000, baseCurrency: 'IRR', quoteCurrency: 'EUR' }
];

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

beforeEach(() => clearFreeMarketCache());

describe('FreeMarketCurrencyConverter', () => {
  it("reads ASR's rates as 1 unit of the quote currency in Rial", async () => {
    const fetchFn = respond({ succeed: true, data: RATES });
    const { rate, asOf } = await new FreeMarketCurrencyConverter(config, fetchFn).getRate('USD', 'IRR', new Date('2026-01-01'));
    expect(rate).toBe(2_712_000);
    expect(asOf).toEqual(new Date('2026-10-21T17:29:37.000Z'));
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://asr.test:5000/api/partner/exchange-rates');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'secret' });
  });

  it('converts the other way and between two foreign currencies through Rial', async () => {
    const converter = new FreeMarketCurrencyConverter(config, respond({ succeed: true, data: RATES }));
    expect((await converter.getRate('IRR', 'USD')).rate).toBeCloseTo(1 / 2_712_000, 15);
    const eurToUsd = await converter.getRate('EUR', 'USD');
    expect(eurToUsd.rate).toBeCloseTo(3_046_000 / 2_712_000, 10);
    expect(eurToUsd.asOf).toEqual(new Date('2026-10-20T10:00:00.000Z'));
  });

  it('asks ASR once for several conversions', async () => {
    const fetchFn = respond({ succeed: true, data: RATES });
    const converter = new FreeMarketCurrencyConverter(config, fetchFn);
    await converter.getRate('USD', 'IRR');
    await converter.getRate('EUR', 'IRR');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('says which currencies ASR has when one is missing', async () => {
    const converter = new FreeMarketCurrencyConverter(config, respond({ succeed: true, data: RATES }));
    await expect(converter.getRate('GBP', 'IRR')).rejects.toThrow('No free-market rate for GBP → IRR (ASR has IRR, USD, EUR)');
  });

  it('fails clearly without configuration, with a wrong key, or when ASR refuses', async () => {
    await expect(new FreeMarketCurrencyConverter({ ...config, apiKey: '' }, respond({})).getRate('USD', 'IRR')).rejects.toThrow('not configured');
    await expect(new FreeMarketCurrencyConverter(config, respond({}, 401)).getRate('USD', 'IRR')).rejects.toThrow('refused the API key');
    await expect(
      new FreeMarketCurrencyConverter(config, respond({ succeed: false, message: 'down' })).getRate('USD', 'IRR')
    ).rejects.toThrow('ASR did not return exchange rates: down');
  });

  it('needs no request for the same currency', async () => {
    const fetchFn = respond({});
    expect((await new FreeMarketCurrencyConverter(config, fetchFn).getRate('IRR', 'IRR')).rate).toBe(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
