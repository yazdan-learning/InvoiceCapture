import { CurrencyConverter, ExchangeRate } from '../ports';
import { AsrConfig } from '../../accounting/connectors/asr';

type AsrRate = { rateDate: string; rate: number; baseCurrency: string; quoteCurrency: string };
type AsrRatesResponse = { succeed?: boolean; message?: string; data?: AsrRate[] };

/** Rates change a few times a day; one request serves every conversion for this long. */
const CACHE_MS = 5 * 60_000;
let cache: { at: number; rates: AsrRate[] } | null = null;

/** For tests. */
export function clearFreeMarketCache() {
  cache = null;
}

// The open-market rate (Iran: the free-market dollar, far from the official
// one), from ASR's partner API (GET /api/partner/exchange-rates, same key as
// the ASR accounting connector). Rows with baseCurrency IRR read
// "1 quoteCurrency = rate IRR"; any other pair is crossed through Rial.
// ASR only has the latest rates, so `date` is ignored and asOf is the day the
// rate was registered.
export class FreeMarketCurrencyConverter implements CurrencyConverter {
  constructor(
    private readonly config: AsrConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async getRate(from: string, to: string, _date?: Date): Promise<ExchangeRate> {
    if (from === to) return { rate: 1, asOf: new Date() };

    const rates = await this.latestRates();
    const inRial = (code: string): Pick<AsrRate, 'rate'> & { rateDate?: string } | undefined =>
      code === 'IRR' ? { rate: 1 } : rates.find((row) => row.baseCurrency === 'IRR' && row.quoteCurrency === code);
    const fromRate = inRial(from);
    const toRate = inRial(to);
    if (!fromRate?.rate || !toRate?.rate) {
      const known = rates.filter((row) => row.baseCurrency === 'IRR').map((row) => row.quoteCurrency);
      throw new Error(`No free-market rate for ${from} → ${to} (ASR has ${['IRR', ...known].join(', ')})`);
    }

    // The older of the two registration dates: the rate is as old as its oldest part.
    const dates = [fromRate.rateDate, toRate.rateDate].filter((d): d is string => !!d).map((d) => new Date(d).getTime());
    return { rate: fromRate.rate / toRate.rate, asOf: new Date(dates.length ? Math.min(...dates) : Date.now()) };
  }

  private async latestRates(): Promise<AsrRate[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.rates;
    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new Error('The free-market rate comes from ASR, which is not configured on the server (ASR_BASE_URL / ASR_API_KEY)');
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl.replace(/\/$/, '')}/api/partner/exchange-rates`, {
        headers: { 'X-API-Key': this.config.apiKey },
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch {
      throw new Error('Could not reach ASR for the free-market rate');
    }
    if (response.status === 401) throw new Error('ASR refused the API key');
    const result = (await response.json().catch(() => null)) as AsrRatesResponse | null;
    if (!response.ok || !result?.succeed || !Array.isArray(result.data)) {
      throw new Error(`ASR did not return exchange rates${result?.message ? `: ${result.message}` : ` (HTTP ${response.status})`}`);
    }
    cache = { at: Date.now(), rates: result.data };
    return result.data;
  }
}
