// EdgeLog's sector -> ETF mapping. Robinhood's fundamentals endpoint classifies
// companies with FactSet's sector/industry taxonomy, not GICS (e.g. NVDA is
// sector="Electronic Technology", industry="Semiconductors" — not GICS
// "Information Technology"). This maps FROM that taxonomy: the closest broad
// SPDR sector ETF per FactSet sector, with narrower industry overrides where
// the sub-industry fit is clearly better than the broad sector ETF would be.
export const PRIMARY_SECTOR_ETF: Record<string, string> = {
  "Electronic Technology": "XLK",
  "Technology Services": "XLK",
  "Health Technology": "XLV",
  "Health Services": "XLV",
  "Energy Minerals": "XLE",
  "Non-Energy Minerals": "XLB",
  "Process Industries": "XLB",
  "Producer Manufacturing": "XLI",
  "Industrial Services": "XLI",
  "Transportation": "XLI",
  "Distribution Services": "XLI",
  "Commercial Services": "XLI",
  "Consumer Durables": "XLY",
  "Consumer Services": "XLY",
  "Retail Trade": "XLY",
  "Consumer Non-Durables": "XLP",
  "Utilities": "XLU",
  "Finance": "XLF",
  "Communications": "XLC",
};

// Checked against the `industry` field (case-insensitive) before falling back
// to the primary sector map.
export const SECTOR_OVERRIDES: { pattern: RegExp; etf: string }[] = [
  { pattern: /semiconductor/i, etf: "SMH" },
  { pattern: /biotechnology/i, etf: "XBI" },
  { pattern: /retail/i, etf: "XRT" },
  { pattern: /homebuild/i, etf: "XHB" },
  { pattern: /regional banks?/i, etf: "KRE" },
  { pattern: /construction/i, etf: "ITB" },
];

export function resolveSectorEtf(sector: string | null | undefined, industry: string | null | undefined): string | null {
  if (industry) {
    const hit = SECTOR_OVERRIDES.find((o) => o.pattern.test(industry));
    if (hit) return hit.etf;
  }
  if (sector && PRIMARY_SECTOR_ETF[sector]) return PRIMARY_SECTOR_ETF[sector];
  return null;
}
