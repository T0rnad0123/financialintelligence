// Sector-aware analysis profiles. Bands are heuristic reference ranges used only
// to translate metrics into 0–100 sub-scores; they are disclosed in the UI and
// are NOT industry averages computed from peer data.
import type { ScoreWeights, SectorKey } from "../types";

export interface Band {
  /** value at which the sub-score is 0 */
  worst: number;
  /** value at which the sub-score is 100 */
  best: number;
}

export interface SectorProfile {
  key: SectorKey;
  label: string;
  financial: boolean;
  description: string;
  weights: ScoreWeights;
  bands: {
    ebitdaMargin: Band;
    patMargin: Band;
    roe: Band;
    roce: Band;
    netDebtToEbitda: Band;
    debtToEquity: Band;
    interestCoverage: Band;
    receivableDays: Band;
    ccc: Band;
  };
  /** Sector-specific items to show on the sector page (line item keys or metric keys). */
  focusItems: { key: string; label: string; kind: "item" | "metric"; note?: string }[];
  valuationNotes: string[];
  dcfSuitable: boolean;
  evMultiplesSuitable: boolean;
}

const W = (o: Partial<ScoreWeights> = {}): ScoreWeights => ({
  profitability: 15,
  growth: 12,
  cashFlow: 15,
  balanceSheet: 15,
  capitalEfficiency: 15,
  workingCapital: 8,
  earningsQuality: 10,
  resilience: 10,
  ...o,
});

const STD_BANDS = {
  ebitdaMargin: { worst: 0, best: 25 },
  patMargin: { worst: 0, best: 15 },
  roe: { worst: 0, best: 22 },
  roce: { worst: 0, best: 25 },
  netDebtToEbitda: { worst: 5, best: 0 },
  debtToEquity: { worst: 2.5, best: 0 },
  interestCoverage: { worst: 1, best: 8 },
  receivableDays: { worst: 150, best: 20 },
  ccc: { worst: 180, best: 0 },
};

const common = (o: Partial<SectorProfile> & Pick<SectorProfile, "key" | "label">): SectorProfile => ({
  financial: false,
  description: "",
  weights: W(),
  bands: STD_BANDS,
  focusItems: [],
  valuationNotes: [],
  dcfSuitable: true,
  evMultiplesSuitable: true,
  ...o,
});

export const SECTOR_PROFILES: Record<SectorKey, SectorProfile> = {
  general: common({ key: "general", label: "General / Diversified", description: "Default non-financial profile." }),
  manufacturing: common({
    key: "manufacturing",
    label: "Manufacturing & Industrials",
    description: "Capital intensive; asset turnover, working capital and ROCE matter most.",
    weights: W({ capitalEfficiency: 18, workingCapital: 12, growth: 10 }),
    focusItems: [
      { key: "fixedAssetTurnover", label: "Fixed-asset turnover", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "capexToRevenue", label: "Capex / revenue", kind: "metric" },
      { key: "orderBook", label: "Order book", kind: "item" },
      { key: "roce", label: "ROCE", kind: "metric" },
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
    ],
  }),
  metals: common({
    key: "metals",
    label: "Metals & Mining",
    description: "Highly cyclical; judge leverage through the cycle and avoid extrapolating peak margins.",
    weights: W({ balanceSheet: 18, resilience: 14, growth: 8 }),
    bands: { ...STD_BANDS, netDebtToEbitda: { worst: 4, best: 0 } },
    focusItems: [
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
      { key: "netDebtToEbitda", label: "Net debt / EBITDA", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "capexToDepreciation", label: "Capex / depreciation", kind: "metric" },
      { key: "powerFuelPct", label: "Power & fuel / revenue", kind: "metric" },
    ],
    valuationNotes: ["Cyclical earnings: prefer EV/EBITDA on mid-cycle (normalised) EBITDA and DCF with mean-reverting margins."],
  }),
  fmcg: common({
    key: "fmcg",
    label: "FMCG / Consumer",
    description: "Brand-led; gross margin stability, cash conversion and low working capital are key.",
    weights: W({ profitability: 18, cashFlow: 18, balanceSheet: 10 }),
    bands: { ...STD_BANDS, ebitdaMargin: { worst: 5, best: 25 }, roe: { worst: 5, best: 35 }, roce: { worst: 5, best: 45 } },
    focusItems: [
      { key: "grossMargin", label: "Gross margin", kind: "metric" },
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "ccc", label: "Cash conversion cycle", kind: "metric" },
      { key: "ocfToPat", label: "OCF / PAT", kind: "metric" },
    ],
  }),
  it: common({
    key: "it",
    label: "IT Services",
    description: "People-intensive; employee cost ratio, receivables and cash conversion dominate.",
    weights: W({ profitability: 18, cashFlow: 18, workingCapital: 12, balanceSheet: 8 }),
    bands: { ...STD_BANDS, roe: { worst: 5, best: 30 }, roce: { worst: 5, best: 40 }, receivableDays: { worst: 120, best: 50 } },
    focusItems: [
      { key: "employeeCostPct", label: "Employee cost / revenue", kind: "metric" },
      { key: "ebitMargin", label: "EBIT margin", kind: "metric" },
      { key: "receivableDays", label: "Receivable days", kind: "metric" },
      { key: "ocfToPat", label: "OCF / PAT", kind: "metric" },
      { key: "revenuePerEmployee", label: "Revenue per employee", kind: "metric", note: "Needs employee count (enter in Data Review)." },
    ],
  }),
  bank: common({
    key: "bank",
    label: "Banks",
    financial: true,
    description: "Balance sheet is the business: asset quality, capital adequacy, funding and NIM replace EBITDA/FCF analysis.",
    weights: W({ profitability: 20, growth: 10, cashFlow: 0, balanceSheet: 25, capitalEfficiency: 20, workingCapital: 0, earningsQuality: 15, resilience: 10 }),
    focusItems: [
      { key: "nii", label: "Net interest income", kind: "metric" },
      { key: "niiToAssets", label: "NII / average assets", kind: "metric", note: "Proxy for NIM; true NIM needs interest-earning assets." },
      { key: "nimReported", label: "NIM (reported)", kind: "item" },
      { key: "grossNpaPct", label: "Gross NPA %", kind: "item" },
      { key: "netNpaPct", label: "Net NPA %", kind: "item" },
      { key: "pcr", label: "Provision coverage ratio", kind: "metric" },
      { key: "car", label: "Capital adequacy ratio", kind: "item" },
      { key: "creditDeposit", label: "Credit–deposit ratio", kind: "metric" },
      { key: "casaPct", label: "CASA ratio", kind: "item" },
      { key: "costToIncome", label: "Cost-to-income", kind: "metric" },
      { key: "creditCost", label: "Credit cost", kind: "metric" },
      { key: "roa", label: "ROA", kind: "metric" },
      { key: "roe", label: "ROE", kind: "metric" },
    ],
    valuationNotes: [
      "FCFF DCF and EV multiples are not meaningful for banks: debt is raw material, not financing.",
      "Use P/B with ROE, residual income and (where payouts are stable) dividend discount models.",
    ],
    dcfSuitable: false,
    evMultiplesSuitable: false,
  }),
  nbfc: common({
    key: "nbfc",
    label: "NBFCs",
    financial: true,
    description: "Lending business: AUM growth, spreads, asset quality, credit cost, capital and ALM matter.",
    weights: W({ profitability: 20, growth: 12, cashFlow: 0, balanceSheet: 25, capitalEfficiency: 18, workingCapital: 0, earningsQuality: 15, resilience: 10 }),
    focusItems: [
      { key: "aum", label: "AUM", kind: "item" },
      { key: "nii", label: "Net interest income", kind: "metric" },
      { key: "nimReported", label: "NIM (reported)", kind: "item" },
      { key: "grossNpaPct", label: "Gross stage-3 / NPA %", kind: "item" },
      { key: "netNpaPct", label: "Net stage-3 / NPA %", kind: "item" },
      { key: "car", label: "CRAR", kind: "item" },
      { key: "creditCost", label: "Credit cost", kind: "metric" },
      { key: "roa", label: "ROA", kind: "metric" },
      { key: "debtToEquity", label: "Borrowings / equity", kind: "metric" },
    ],
    valuationNotes: ["As with banks, prefer P/B–ROE, residual income and DDM over FCFF DCF."],
    dcfSuitable: false,
    evMultiplesSuitable: false,
  }),
  insurance: common({
    key: "insurance",
    label: "Insurance",
    financial: true,
    description: "Underwriting and investment businesses: premium growth, claims/combined ratio, solvency, embedded value.",
    weights: W({ profitability: 20, growth: 15, cashFlow: 0, balanceSheet: 20, capitalEfficiency: 15, workingCapital: 0, earningsQuality: 15, resilience: 15 }),
    focusItems: [
      { key: "grossPremium", label: "Gross written premium", kind: "item" },
      { key: "netPremium", label: "Net premium earned", kind: "item" },
      { key: "claimsRatio", label: "Claims ratio", kind: "item" },
      { key: "combinedRatio", label: "Combined ratio", kind: "item" },
      { key: "solvencyRatio", label: "Solvency ratio", kind: "item" },
      { key: "roe", label: "ROE", kind: "metric" },
    ],
    valuationNotes: ["Life insurers are usually valued on embedded value (P/EV); general insurers on P/B and P/E. FCFF DCF is unsuitable."],
    dcfSuitable: false,
    evMultiplesSuitable: false,
  }),
  power: common({
    key: "power",
    label: "Power & Utilities",
    description: "Regulated returns; receivable days (discom dues), regulatory assets, leverage and coverage are central.",
    weights: W({ balanceSheet: 18, resilience: 14, workingCapital: 12, growth: 8 }),
    bands: { ...STD_BANDS, netDebtToEbitda: { worst: 7, best: 2 }, debtToEquity: { worst: 3, best: 0.5 }, receivableDays: { worst: 200, best: 45 }, roe: { worst: 0, best: 16 }, roce: { worst: 0, best: 14 } },
    focusItems: [
      { key: "plf", label: "Plant load factor", kind: "item" },
      { key: "receivableDays", label: "Receivable days", kind: "metric" },
      { key: "regulatoryAssets", label: "Regulatory deferral balances", kind: "item" },
      { key: "interestCoverage", label: "Interest coverage", kind: "metric" },
      { key: "netDebtToEbitda", label: "Net debt / EBITDA", kind: "metric" },
      { key: "capexToRevenue", label: "Capex / revenue", kind: "metric" },
    ],
  }),
  energy: common({
    key: "energy",
    label: "Oil, Gas & Energy",
    description: "Commodity-linked; inventory gains/losses, capex cycles and leverage drive results.",
    weights: W({ balanceSheet: 18, resilience: 12 }),
    focusItems: [
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "capexToDepreciation", label: "Capex / depreciation", kind: "metric" },
      { key: "netDebtToEbitda", label: "Net debt / EBITDA", kind: "metric" },
    ],
  }),
  infrastructure: common({
    key: "infrastructure",
    label: "Infrastructure & EPC",
    description: "Order book, execution, contract assets/retentions and working capital determine cash generation.",
    weights: W({ workingCapital: 15, cashFlow: 18, profitability: 12 }),
    bands: { ...STD_BANDS, receivableDays: { worst: 200, best: 60 }, ebitdaMargin: { worst: 3, best: 18 } },
    focusItems: [
      { key: "orderBook", label: "Order book", kind: "item" },
      { key: "orderBookToRevenue", label: "Order book / revenue", kind: "metric" },
      { key: "contractAssets", label: "Contract assets", kind: "item" },
      { key: "receivableDays", label: "Receivable days", kind: "metric" },
      { key: "ocfToEbitda", label: "OCF / EBITDA", kind: "metric" },
      { key: "netDebt", label: "Net debt", kind: "metric" },
    ],
  }),
  pharma: common({
    key: "pharma",
    label: "Pharmaceuticals",
    description: "R&D intensity, product/geography concentration, regulatory (USFDA) observations and margins.",
    weights: W({ profitability: 18, earningsQuality: 12 }),
    bands: { ...STD_BANDS, ebitdaMargin: { worst: 5, best: 30 } },
    focusItems: [
      { key: "rndPct", label: "R&D / revenue", kind: "metric", note: "Needs R&D expense (often in notes)." },
      { key: "grossMargin", label: "Gross margin", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "receivableDays", label: "Receivable days", kind: "metric" },
      { key: "roce", label: "ROCE", kind: "metric" },
    ],
  }),
  auto: common({
    key: "auto",
    label: "Automobiles & Components",
    description: "Cyclical demand, operating leverage, commodity costs and capex cycles.",
    weights: W({ capitalEfficiency: 18, growth: 12 }),
    focusItems: [
      { key: "grossMargin", label: "Gross margin", kind: "metric" },
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
      { key: "inventoryDays", label: "Inventory days", kind: "metric" },
      { key: "payableDays", label: "Payable days", kind: "metric" },
      { key: "capexToRevenue", label: "Capex / revenue", kind: "metric" },
    ],
  }),
  telecom: common({
    key: "telecom",
    label: "Telecommunications",
    description: "Very capital intensive with spectrum liabilities and leases; EBITDA after leases and leverage matter.",
    weights: W({ balanceSheet: 18, capitalEfficiency: 15, resilience: 14 }),
    bands: { ...STD_BANDS, ebitdaMargin: { worst: 10, best: 50 }, netDebtToEbitda: { worst: 6, best: 1 } },
    focusItems: [
      { key: "ebitdaMargin", label: "EBITDA margin", kind: "metric" },
      { key: "capexToRevenue", label: "Capex / revenue", kind: "metric" },
      { key: "netDebtToEbitda", label: "Net debt / EBITDA", kind: "metric" },
      { key: "leaseLiabilities", label: "Lease liabilities", kind: "item" },
    ],
    valuationNotes: ["Include lease liabilities and deferred spectrum payments as debt-like claims in EV where material."],
  }),
};

export const SECTOR_OPTIONS = Object.values(SECTOR_PROFILES).map((p) => ({ value: p.key, label: p.label }));

/** Linear mapping of a value onto 0..100 given a band. */
export function bandScore(value: number | null, band: Band): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const { worst, best } = band;
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(100, t * 100));
}
