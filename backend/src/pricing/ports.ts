// Raw-material pricing: a material's price follows a price index (how the
// world price of its category moved) and the exchange rate. Two ports, because
// both are known to change: where index values come from (sample data now, the
// BLS Producer Price Index next), and which AI matches a material to an index
// category (an LLM, Jev, or both — Settings → Material matching).

/** One category of the index, e.g. "Metals › Steel mill products › Hot-rolled sheet". */
export type IndexSeries = {
  id: string;
  title: string;
  /** The parent categories, broadest first; empty for a top-level category. */
  path: string[];
};

/** A published monthly value of a series. */
export type IndexValue = {
  /** "YYYY-MM" */
  period: string;
  value: number;
};

export interface PriceIndexSource {
  listSeries(): Promise<IndexSeries[]>;
  /** The latest value published for a month on or before `date`; null when the series has none that early. */
  valueAt(seriesId: string, date: Date): Promise<IndexValue | null>;
}

export type MaterialToMatch = {
  name: string;
  unit: string | null;
};

/** A match a person confirmed earlier: shown to the matcher as an example of how this company names things. */
export type ConfirmedExample = {
  name: string;
  seriesId: string | null;
};

export type MatchRequest = {
  material: MaterialToMatch;
  candidates: IndexSeries[];
  examples: ConfirmedExample[];
};

export type MatchSuggestion = {
  /** One of the candidates' ids, or null: no category fits. */
  seriesId: string | null;
  /** 0–1. */
  confidence: number;
  reason: string | null;
  /** Which model answered: "LLM", "JEV" or "JEV+LLM". */
  matcher: string;
};

export interface MaterialMatcher {
  /** Throws when the model is unreachable or not configured. */
  match(request: MatchRequest): Promise<MatchSuggestion>;
}

/** "Metals › Steel mill products › Hot-rolled sheet" */
export const seriesLabel = (series: IndexSeries) => [...series.path, series.title].join(' › ');
