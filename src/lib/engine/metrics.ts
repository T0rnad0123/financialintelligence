// Annual and quarterly metric definitions. Every metric declares its formula,
// unit, direction and sector applicability, and is computed from traceable operands.
import type { SectorKey } from "../types";
import {
  absOp,
  add,
  addAvailable,
  amount,
  average,
  constant,
  growthRate,
  isFinancial,
  item,
  mul,
  na,
  ratio,
  sub,
  type FactView,
  type MetricResult,
  type MetricUnit,
  type Operand,
} from "./core";
import { prevFy, prevQuarter, prevYearQuarter } from "./derive";

export type MetricCategory = "growth" | "profitability" | "balance" | "cashflow" | "workingCapital" | "returns" | "quality" | "bank" | "sector";
export type Applies = "all" | "nonFinancial" | "financial" | "bank";

export interface EngineSettings {
  includeLeasesInDebt: boolean;
  includeCurrentInvestmentsInCash: boolean;
  wacc: number | null; // % – user assumption, used for EVA
  sector: SectorKey;
}

export interface MetricDef {
  key: string;
  name: string;
  category: MetricCategory;
  unit: MetricUnit;
  better: "higher" | "lower" | "neutral";
  applies: Applies;
  formula: string;
  description: string;
  compute: (v: FactView, pid: string, s: EngineSettings) => MetricResult;
}

export const STATUTORY_TAX_RATE = 25.168; // % (22% base + 10% surcharge + 4% cess, s.115BAA)

// ---------- operand builders ----------
const I = (v: FactView, pid: string, k: string, label?: string) => item(v, pid, k, label);

export function ebitdaOp(v: FactView, pid: string): Operand {
  const rev = I(v, pid, "revenue");
  const te = I(v, pid, "totalExpenses");
  const fin = I(v, pid, "financeCost");
  const dep = I(v, pid, "depreciation");
  if (rev.value !== null && te.value !== null && fin.value !== null && dep.value !== null) {
    const opex = sub("Operating expenses", sub("Total expenses − finance costs", te, fin), dep);
    const r = sub("EBITDA", rev, opex);
    r.notes = [...r.notes, "EBITDA = revenue from operations − (total expenses − finance costs − D&A); excludes other income and exceptional items."];
    return r;
  }
  const pbe = I(v, pid, "pbtBeforeExceptional");
  const oi = I(v, pid, "otherIncome");
  const r = sub("EBITDA", add("PBT before exceptional + finance costs + D&A", pbe, fin, dep), oi);
  r.notes = [...r.notes, "EBITDA = PBT before exceptional items + finance costs + D&A − other income."];
  return r;
}

export const ebitOp = (v: FactView, pid: string): Operand => {
  const r = sub("EBIT (operating)", ebitdaOp(v, pid), I(v, pid, "depreciation"));
  return r;
};

/** PBIT including other income, before exceptional items (used for coverage and ROCE). */
export function pbitOp(v: FactView, pid: string): Operand {
  const pbe = I(v, pid, "pbtBeforeExceptional");
  const fin = I(v, pid, "financeCost");
  if (pbe.value !== null) return add("PBIT (before exceptional items)", pbe, fin);
  const r = add("PBIT", I(v, pid, "pbt"), fin);
  r.notes = [...r.notes, "Profit before exceptional items unavailable — PBT used (may include exceptional items)."];
  return r;
}

export function cogsOp(v: FactView, pid: string): Operand {
  return add("Cost of goods sold", I(v, pid, "materialsCost"), I(v, pid, "purchasesStockInTrade"), I(v, pid, "changesInInventories"));
}

export function debtOp(v: FactView, pid: string, s: EngineSettings): Operand {
  const d = I(v, pid, "totalDebt", "Total borrowings");
  if (!s.includeLeasesInDebt) return d;
  return add("Borrowings + lease liabilities", d, I(v, pid, "leaseLiabilities"));
}

export function cashLikeOp(v: FactView, pid: string, s: EngineSettings): Operand {
  const base = [I(v, pid, "cash"), I(v, pid, "otherBankBalances")];
  if (s.includeCurrentInvestmentsInCash) base.push(I(v, pid, "currentInvestments"));
  return add(s.includeCurrentInvestmentsInCash ? "Cash, bank balances & current investments" : "Cash & bank balances", ...base);
}

export const netDebtOp = (v: FactView, pid: string, s: EngineSettings) => sub("Net debt", debtOp(v, pid, s), cashLikeOp(v, pid, s));

export function equityOp(v: FactView, pid: string): Operand {
  return I(v, pid, "totalEquity", "Equity attributable to owners");
}

export function capitalEmployedOp(v: FactView, pid: string, s: EngineSettings): Operand {
  return add("Capital employed", equityOp(v, pid), I(v, pid, "nonControllingInterestBs"), debtOp(v, pid, s));
}

export function investedCapitalOp(v: FactView, pid: string, s: EngineSettings): Operand {
  return sub("Invested capital (operating)", capitalEmployedOp(v, pid, s), cashLikeOp(v, pid, s));
}

export function effectiveTaxRate(v: FactView, pid: string): { rate: number; note?: string } {
  const pbt = v.get(pid, "pbt")?.value;
  const tax = v.get(pid, "totalTax")?.value;
  if (pbt != null && tax != null && pbt > 0) {
    const r = (tax / pbt) * 100;
    if (r >= 0 && r <= 50) return { rate: r };
    return { rate: STATUTORY_TAX_RATE, note: `Effective tax rate (${r.toFixed(1)}%) outside 0–50% — statutory ${STATUTORY_TAX_RATE}% used for NOPAT.` };
  }
  return { rate: STATUTORY_TAX_RATE, note: `Effective tax rate not meaningful — statutory ${STATUTORY_TAX_RATE}% (s.115BAA) used for NOPAT.` };
}

export function nopatOp(v: FactView, pid: string): Operand {
  const ebit = ebitOp(v, pid);
  const t = effectiveTaxRate(v, pid);
  const r = mul("NOPAT", ebit, constant(`(1 − tax rate ${t.rate.toFixed(1)}%)`, 1 - t.rate / 100));
  if (t.note) r.notes = [...r.notes, t.note];
  return r;
}

export const operatingWcOp = (v: FactView, pid: string) =>
  sub("Operating working capital", add("Inventories + receivables", I(v, pid, "inventories"), I(v, pid, "tradeReceivables")), I(v, pid, "tradePayables"));

const avgOf = (label: string, f: (pid: string) => Operand, pid: string, prev: string) => average(label, f(pid), f(prev));

// ---------- definition helper ----------
type DefInput = Omit<MetricDef, "compute"> & { compute: (v: FactView, pid: string, s: EngineSettings, d: MetricDef) => MetricResult };
const def = (d: DefInput): MetricDef => {
  const full = d as MetricDef;
  const inner = d.compute;
  full.compute = (v, pid, s) => {
    if (d.applies === "nonFinancial" && isFinancial(s.sector)) return na(d.key, d.name, pid, d.unit, d.formula, "Not applicable to financial institutions (banks/NBFCs/insurers).");
    if ((d.applies === "financial" || d.applies === "bank") && !isFinancial(s.sector)) return na(d.key, d.name, pid, d.unit, d.formula, "Applies to financial institutions only.");
    return inner(v, pid, s, full);
  };
  return full;
};

const R = (d: MetricDef, pid: string, extra: { scale?: number; requirePositiveDenominator?: boolean; requirePositiveNumerator?: boolean; notMeaningfulReason?: string } = {}) => ({
  key: d.key,
  name: d.name,
  unit: d.unit,
  formula: d.formula,
  periodId: pid,
  ...extra,
});

function growthMetric(key: string, name: string, op: (v: FactView, pid: string) => Operand, applies: Applies = "all", prevOf: (pid: string) => string = prevFy, desc = "Year-over-year"): MetricDef {
  return def({
    key,
    name,
    category: "growth",
    unit: "pct",
    better: "higher",
    applies,
    formula: `(${name.replace(/ growth.*/i, "")} this period ÷ comparable prior period − 1) × 100`,
    description: `${desc} growth.`,
    compute: (v, pid, _s, d) => {
      const cur = op(v, pid);
      const prev = op(v, prevOf(pid));
      const g = growthRate(cur.value, prev.value);
      return {
        key: d.key,
        name: d.name,
        periodId: pid,
        unit: "pct",
        formula: d.formula,
        numerator: { label: `${cur.label} (${pid})`, value: cur.value },
        denominator: { label: `${prev.label} (${prevOf(pid)})`, value: prev.value },
        inputs: [...cur.parts, ...prev.parts],
        value: g.value,
        status: g.value === null ? (cur.value === null || prev.value === null ? "insufficient-data" : "not-meaningful") : "ok",
        reason: g.reason,
        confidence: g.value === null ? "low" : cur.parts.concat(prev.parts).some((p) => p.status === "derived") ? "medium" : "high",
        notes: [...new Set([...cur.notes, ...prev.notes])],
      };
    },
  });
}

// ---------- annual metrics ----------
export const ANNUAL_METRICS: MetricDef[] = [
  // Growth
  growthMetric("revenueGrowth", "Revenue growth", (v, p) => I(v, p, "revenue")),
  growthMetric("ebitdaGrowth", "EBITDA growth", ebitdaOp, "nonFinancial"),
  growthMetric("patGrowth", "PAT growth", (v, p) => I(v, p, "patOwners", "PAT (owners)")),
  growthMetric("epsGrowth", "EPS growth", (v, p) => I(v, p, "epsDiluted", "Diluted EPS")),
  growthMetric("totalIncomeGrowth", "Total income growth", (v, p) => I(v, p, "totalIncome"), "financial"),

  // Profitability
  def({ key: "revenue", name: "Revenue from operations", category: "profitability", unit: "cr", better: "higher", applies: "all", formula: "Reported revenue from operations", description: "Top line.", compute: (v, p, _s, d) => amount(I(v, p, "revenue"), R(d, p)) }),
  def({
    key: "grossProfit", name: "Gross profit", category: "profitability", unit: "cr", better: "higher", applies: "nonFinancial",
    formula: "Revenue − (materials consumed + purchases of stock-in-trade + change in inventories)", description: "Revenue less direct material costs.",
    compute: (v, p, _s, d) => {
      const cogs = cogsOp(v, p);
      if (cogs.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No material/purchase costs reported (service business) — gross profit not applicable.");
      return amount(sub("Gross profit", I(v, p, "revenue"), cogs), R(d, p));
    },
  }),
  def({
    key: "grossMargin", name: "Gross margin", category: "profitability", unit: "pct", better: "higher", applies: "nonFinancial",
    formula: "Gross profit ÷ revenue × 100", description: "Share of revenue left after direct material costs.",
    compute: (v, p, _s, d) => {
      const cogs = cogsOp(v, p);
      if (cogs.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No material/purchase costs reported — gross margin not applicable.");
      return ratio(sub("Gross profit", I(v, p, "revenue"), cogs), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true }));
    },
  }),
  def({ key: "ebitda", name: "EBITDA", category: "profitability", unit: "cr", better: "higher", applies: "nonFinancial", formula: "Revenue − operating expenses (excl. finance costs, D&A); excludes other income & exceptional items", description: "Calculated, not reported — Ind AS statements do not present EBITDA.", compute: (v, p, _s, d) => amount(ebitdaOp(v, p), R(d, p)) }),
  def({ key: "ebitdaMargin", name: "EBITDA margin", category: "profitability", unit: "pct", better: "higher", applies: "nonFinancial", formula: "EBITDA ÷ revenue × 100", description: "Operating profitability before D&A.", compute: (v, p, _s, d) => ratio(ebitdaOp(v, p), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "ebit", name: "EBIT (operating)", category: "profitability", unit: "cr", better: "higher", applies: "nonFinancial", formula: "EBITDA − depreciation & amortisation", description: "Operating profit excluding other income.", compute: (v, p, _s, d) => amount(ebitOp(v, p), R(d, p)) }),
  def({ key: "ebitMargin", name: "EBIT margin", category: "profitability", unit: "pct", better: "higher", applies: "nonFinancial", formula: "EBIT ÷ revenue × 100", description: "Operating margin after D&A.", compute: (v, p, _s, d) => ratio(ebitOp(v, p), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "pbtMargin", name: "PBT margin", category: "profitability", unit: "pct", better: "higher", applies: "all", formula: "Profit before tax ÷ revenue × 100", description: "Pre-tax margin (includes other income & exceptional items).", compute: (v, p, _s, d) => ratio(I(v, p, "pbt"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "pat", name: "Profit after tax", category: "profitability", unit: "cr", better: "higher", applies: "all", formula: "Reported profit for the period", description: "Bottom line (total, incl. minority share).", compute: (v, p, _s, d) => amount(I(v, p, "pat"), R(d, p)) }),
  def({ key: "patMargin", name: "PAT margin", category: "profitability", unit: "pct", better: "higher", applies: "all", formula: "PAT ÷ revenue × 100", description: "Net profit margin.", compute: (v, p, _s, d) => ratio(I(v, p, "pat"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "effectiveTaxRate", name: "Effective tax rate", category: "profitability", unit: "pct", better: "neutral", applies: "all", formula: "Total tax expense ÷ PBT × 100", description: "Unusually low/high or volatile rates deserve scrutiny.", compute: (v, p, _s, d) => ratio(I(v, p, "totalTax"), I(v, p, "pbt"), R(d, p, { scale: 100, requirePositiveDenominator: true, notMeaningfulReason: "PBT is negative — effective tax rate not meaningful." })) }),
  def({ key: "otherIncomeToPbt", name: "Other income / PBT", category: "quality", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Other income ÷ PBT × 100", description: "High values mean profits depend on non-operating income.", compute: (v, p, _s, d) => ratio(I(v, p, "otherIncome"), I(v, p, "pbt"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "exceptionalToPbt", name: "Exceptional items / PBT", category: "quality", unit: "pct", better: "neutral", applies: "all", formula: "Exceptional impact on PBT ÷ PBT × 100", description: "Share of PBT from one-off gains (positive) or losses (negative).", compute: (v, p, _s, d) => ratio(I(v, p, "exceptionalEffect", "Exceptional impact"), I(v, p, "pbt"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({
    key: "adjustedPat", name: "PAT excl. exceptional items", category: "profitability", unit: "cr", better: "higher", applies: "all",
    formula: "PAT − exceptional impact × (1 − effective tax rate)", description: "Normalised earnings: removes disclosed exceptional items at the effective tax rate. Adjustment shown in inputs.",
    compute: (v, p, _s, d) => {
      const t = effectiveTaxRate(v, p);
      const exc = I(v, p, "exceptionalEffect", "Exceptional impact");
      const adj = mul("Exceptional impact after tax", exc, constant(`(1 − ${t.rate.toFixed(1)}%)`, 1 - t.rate / 100));
      const r = amount(sub("PAT excl. exceptional", I(v, p, "pat"), adj), R(d, p));
      if (t.note) r.notes.push(t.note);
      return r;
    },
  }),
  def({ key: "employeeCostPct", name: "Employee cost / revenue", category: "profitability", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Employee benefits expense ÷ revenue × 100", description: "Labour intensity.", compute: (v, p, _s, d) => ratio(I(v, p, "employeeCost"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "materialCostPct", name: "Material cost / revenue", category: "profitability", unit: "pct", better: "lower", applies: "nonFinancial", formula: "COGS ÷ revenue × 100", description: "Raw material intensity.", compute: (v, p, _s, d) => { const c = cogsOp(v, p); if (c.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No material costs reported."); return ratio(c, I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })); } }),
  def({ key: "powerFuelPct", name: "Power & fuel / revenue", category: "profitability", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Power and fuel ÷ revenue × 100", description: "Energy intensity (only if presented separately).", compute: (v, p, _s, d) => ratio(I(v, p, "powerFuel"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "financeCostPct", name: "Finance cost / revenue", category: "profitability", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Finance costs ÷ revenue × 100", description: "Interest burden relative to sales.", compute: (v, p, _s, d) => ratio(I(v, p, "financeCost"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({
    key: "incrementalEbitdaMargin", name: "Incremental EBITDA margin", category: "profitability", unit: "pct", better: "higher", applies: "nonFinancial",
    formula: "ΔEBITDA ÷ Δrevenue × 100 (vs prior year)", description: "Operating leverage: how much of each extra rupee of revenue became EBITDA.",
    compute: (v, p, _s, d) => {
      const r = ratio(sub("ΔEBITDA", ebitdaOp(v, p), ebitdaOp(v, prevFy(p))), sub("ΔRevenue", I(v, p, "revenue"), I(v, prevFy(p), "revenue")), R(d, p, { scale: 100, requirePositiveDenominator: true, notMeaningfulReason: "Revenue declined — incremental margin not meaningful." }));
      return r;
    },
  }),
  def({ key: "interestCoverage", name: "Interest coverage", category: "balance", unit: "x", better: "higher", applies: "nonFinancial", formula: "PBIT (before exceptional items) ÷ finance costs", description: "Times operating + other income covers interest.", compute: (v, p, _s, d) => { const f = I(v, p, "financeCost"); if (f.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No finance costs — coverage not applicable (effectively unlimited)."); return ratio(pbitOp(v, p), f, R(d, p)); } }),
  def({ key: "ebitdaInterestCover", name: "EBITDA / interest", category: "balance", unit: "x", better: "higher", applies: "nonFinancial", formula: "EBITDA ÷ finance costs", description: "Cash-based coverage proxy.", compute: (v, p, _s, d) => { const f = I(v, p, "financeCost"); if (f.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No finance costs."); return ratio(ebitdaOp(v, p), f, R(d, p)); } }),

  // Balance sheet
  def({ key: "totalDebt", name: "Total debt", category: "balance", unit: "cr", better: "lower", applies: "all", formula: "Non-current + current borrowings (+ lease liabilities if enabled)", description: "Gross financial debt.", compute: (v, p, s, d) => amount(debtOp(v, p, s), R(d, p)) }),
  def({ key: "cashLike", name: "Cash & equivalents (for net debt)", category: "balance", unit: "cr", better: "higher", applies: "all", formula: "Cash & cash equivalents + other bank balances (+ current investments if enabled)", description: "Liquid resources netted against debt.", compute: (v, p, s, d) => amount(cashLikeOp(v, p, s), R(d, p)) }),
  def({ key: "netDebt", name: "Net debt", category: "balance", unit: "cr", better: "lower", applies: "nonFinancial", formula: "Total debt − cash-like balances", description: "Negative = net cash.", compute: (v, p, s, d) => amount(netDebtOp(v, p, s), R(d, p)) }),
  def({ key: "debtToEquity", name: "Debt / equity", category: "balance", unit: "x", better: "lower", applies: "all", formula: "Total debt ÷ equity attributable to owners", description: "Financial leverage.", compute: (v, p, s, d) => ratio(debtOp(v, p, s), equityOp(v, p), R(d, p, { requirePositiveDenominator: true, notMeaningfulReason: "Equity is negative — leverage ratio not meaningful (balance-sheet stress)." })) }),
  def({ key: "netDebtToEquity", name: "Net debt / equity", category: "balance", unit: "x", better: "lower", applies: "nonFinancial", formula: "Net debt ÷ equity", description: "Leverage net of cash.", compute: (v, p, s, d) => ratio(netDebtOp(v, p, s), equityOp(v, p), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "debtToAssets", name: "Debt / total assets", category: "balance", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Total debt ÷ total assets × 100", description: "Share of assets financed by debt.", compute: (v, p, s, d) => ratio(debtOp(v, p, s), I(v, p, "totalAssets"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "equityRatio", name: "Equity ratio", category: "balance", unit: "pct", better: "higher", applies: "all", formula: "Equity ÷ total assets × 100", description: "Share of assets financed by owners.", compute: (v, p, _s, d) => ratio(equityOp(v, p), I(v, p, "totalAssets"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "currentRatio", name: "Current ratio", category: "balance", unit: "x", better: "higher", applies: "nonFinancial", formula: "Current assets ÷ current liabilities", description: "Short-term liquidity.", compute: (v, p, _s, d) => ratio(I(v, p, "totalCurrentAssets"), I(v, p, "totalCurrentLiabilities"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "quickRatio", name: "Quick ratio", category: "balance", unit: "x", better: "higher", applies: "nonFinancial", formula: "(Current assets − inventories) ÷ current liabilities", description: "Liquidity excluding inventory.", compute: (v, p, _s, d) => ratio(sub("Current assets − inventories", I(v, p, "totalCurrentAssets"), I(v, p, "inventories")), I(v, p, "totalCurrentLiabilities"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "cashRatio", name: "Cash ratio", category: "balance", unit: "x", better: "higher", applies: "nonFinancial", formula: "Cash-like balances ÷ current liabilities", description: "Most conservative liquidity measure.", compute: (v, p, s, d) => ratio(cashLikeOp(v, p, s), I(v, p, "totalCurrentLiabilities"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "netWorkingCapital", name: "Net working capital", category: "balance", unit: "cr", better: "neutral", applies: "nonFinancial", formula: "Current assets − current liabilities", description: "Balance-sheet working capital.", compute: (v, p, _s, d) => amount(sub("Net working capital", I(v, p, "totalCurrentAssets"), I(v, p, "totalCurrentLiabilities")), R(d, p)) }),
  def({ key: "netDebtToEbitda", name: "Net debt / EBITDA", category: "balance", unit: "x", better: "lower", applies: "nonFinancial", formula: "Net debt ÷ EBITDA", description: "Years of EBITDA needed to repay net debt.", compute: (v, p, s, d) => ratio(netDebtOp(v, p, s), ebitdaOp(v, p), R(d, p, { requirePositiveDenominator: true, notMeaningfulReason: "EBITDA is negative — ratio not meaningful." })) }),
  def({ key: "tangibleNetWorth", name: "Tangible net worth", category: "balance", unit: "cr", better: "higher", applies: "all", formula: "Equity − goodwill − other intangible assets", description: "Equity excluding intangibles.", compute: (v, p, _s, d) => amount(sub("Tangible net worth", equityOp(v, p), add("Goodwill + intangibles", I(v, p, "goodwill"), I(v, p, "intangibles"))), R(d, p)) }),
  def({ key: "goodwillToAssets", name: "Goodwill / total assets", category: "balance", unit: "pct", better: "lower", applies: "all", formula: "Goodwill ÷ total assets × 100", description: "Acquisition-related asset exposure.", compute: (v, p, _s, d) => ratio(I(v, p, "goodwill"), I(v, p, "totalAssets"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "intangiblesToAssets", name: "Intangibles / total assets", category: "balance", unit: "pct", better: "lower", applies: "all", formula: "(Goodwill + other intangibles) ÷ total assets × 100", description: "Share of assets without physical substance.", compute: (v, p, _s, d) => ratio(add("Goodwill + intangibles", I(v, p, "goodwill"), I(v, p, "intangibles")), I(v, p, "totalAssets"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "capitalEmployed", name: "Capital employed", category: "balance", unit: "cr", better: "neutral", applies: "nonFinancial", formula: "Equity + non-controlling interest + total debt", description: "Financing-side capital employed.", compute: (v, p, s, d) => amount(capitalEmployedOp(v, p, s), R(d, p)) }),
  def({ key: "shortTermDebtShare", name: "Short-term share of debt", category: "balance", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Current borrowings ÷ total borrowings × 100", description: "Refinancing exposure.", compute: (v, p, _s, d) => ratio(I(v, p, "shortTermBorrowings"), I(v, p, "totalDebt", "Total borrowings"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "assetTurnover", name: "Asset turnover", category: "returns", unit: "x", better: "higher", applies: "all", formula: "Revenue ÷ average total assets", description: "Revenue generated per rupee of assets.", compute: (v, p, _s, d) => ratio(I(v, p, "revenue"), avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "fixedAssetTurnover", name: "Fixed-asset turnover", category: "returns", unit: "x", better: "higher", applies: "nonFinancial", formula: "Revenue ÷ average net PPE", description: "Productivity of plant and equipment.", compute: (v, p, _s, d) => ratio(I(v, p, "revenue"), avgOf("net PPE", (q) => I(v, q, "ppe"), p, prevFy(p)), R(d, p, { requirePositiveDenominator: true })) }),

  // Cash flow
  def({ key: "cfo", name: "Operating cash flow", category: "cashflow", unit: "cr", better: "higher", applies: "all", formula: "Net cash from operating activities (reported)", description: "Cash generated by operations after tax and working capital.", compute: (v, p, _s, d) => amount(I(v, p, "cfo"), R(d, p)) }),
  def({ key: "cfi", name: "Investing cash flow", category: "cashflow", unit: "cr", better: "neutral", applies: "all", formula: "Net cash from investing activities (reported)", description: "Negative = net investment.", compute: (v, p, _s, d) => amount(I(v, p, "cfi"), R(d, p)) }),
  def({ key: "cff", name: "Financing cash flow", category: "cashflow", unit: "cr", better: "neutral", applies: "all", formula: "Net cash from financing activities (reported)", description: "Negative = net repayment / distributions.", compute: (v, p, _s, d) => amount(I(v, p, "cff"), R(d, p)) }),
  def({ key: "capex", name: "Capital expenditure", category: "cashflow", unit: "cr", better: "neutral", applies: "nonFinancial", formula: "Purchase of PPE & intangibles (gross cash outflow, shown positive)", description: "Gross capex; disposal proceeds shown separately.", compute: (v, p, _s, d) => amount(I(v, p, "capexTotal", "Capex"), R(d, p)) }),
  def({ key: "fcf", name: "Free cash flow", category: "cashflow", unit: "cr", better: "higher", applies: "nonFinancial", formula: "Operating cash flow − capital expenditure", description: "Cash left after reinvestment in fixed assets (before acquisitions, dividends and debt service other than interest already in CFO/CFF).", compute: (v, p, _s, d) => amount(sub("Free cash flow", I(v, p, "cfo"), I(v, p, "capexTotal", "Capex")), R(d, p)) }),
  def({ key: "ocfToPat", name: "OCF / PAT", category: "cashflow", unit: "x", better: "higher", applies: "nonFinancial", formula: "Operating cash flow ÷ PAT", description: "Cash conversion of reported profit (>1 is healthy for most industrials).", compute: (v, p, _s, d) => ratio(I(v, p, "cfo"), I(v, p, "pat"), R(d, p, { requirePositiveDenominator: true, notMeaningfulReason: "PAT is negative — conversion ratio not meaningful." })) }),
  def({ key: "fcfToPat", name: "FCF / PAT", category: "cashflow", unit: "x", better: "higher", applies: "nonFinancial", formula: "Free cash flow ÷ PAT", description: "Share of profit available after capex.", compute: (v, p, _s, d) => ratio(sub("FCF", I(v, p, "cfo"), I(v, p, "capexTotal", "Capex")), I(v, p, "pat"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "ocfToEbitda", name: "OCF / EBITDA", category: "cashflow", unit: "pct", better: "higher", applies: "nonFinancial", formula: "Operating cash flow ÷ EBITDA × 100", description: "How much EBITDA turned into post-tax operating cash.", compute: (v, p, _s, d) => ratio(I(v, p, "cfo"), ebitdaOp(v, p), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "ocfToRevenue", name: "OCF / revenue", category: "cashflow", unit: "pct", better: "higher", applies: "all", formula: "Operating cash flow ÷ revenue × 100", description: "Cash margin.", compute: (v, p, _s, d) => ratio(I(v, p, "cfo"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "capexToRevenue", name: "Capex / revenue", category: "cashflow", unit: "pct", better: "neutral", applies: "nonFinancial", formula: "Capex ÷ revenue × 100", description: "Capital intensity.", compute: (v, p, _s, d) => ratio(I(v, p, "capexTotal", "Capex"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "capexToDepreciation", name: "Capex / depreciation", category: "cashflow", unit: "x", better: "neutral", applies: "nonFinancial", formula: "Capex ÷ depreciation & amortisation", description: ">1 suggests growth investment; <1 for long may indicate under-investment.", compute: (v, p, _s, d) => ratio(I(v, p, "capexTotal", "Capex"), I(v, p, "depreciation"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "dividendsToFcf", name: "Dividends / FCF", category: "cashflow", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Dividends paid ÷ free cash flow × 100", description: ">100% means dividends exceeded free cash flow.", compute: (v, p, _s, d) => ratio(I(v, p, "dividendsPaid"), sub("FCF", I(v, p, "cfo"), I(v, p, "capexTotal", "Capex")), R(d, p, { scale: 100, requirePositiveDenominator: true, notMeaningfulReason: "Free cash flow is negative — dividends were not funded by FCF." })) }),
  def({ key: "fcfAfterDividends", name: "FCF after dividends", category: "cashflow", unit: "cr", better: "higher", applies: "nonFinancial", formula: "FCF − dividends paid", description: "Cash available for debt reduction / shareholders after dividends.", compute: (v, p, _s, d) => amount(sub("FCF after dividends", sub("FCF", I(v, p, "cfo"), I(v, p, "capexTotal", "Capex")), I(v, p, "dividendsPaid")), R(d, p)) }),
  def({ key: "netBorrowing", name: "Net borrowing (cash flow)", category: "cashflow", unit: "cr", better: "neutral", applies: "all", formula: "Proceeds from borrowings − repayments", description: "Positive = net new debt raised.", compute: (v, p, _s, d) => amount(sub("Net borrowing", I(v, p, "borrowingsProceeds"), I(v, p, "borrowingsRepayment")), R(d, p)) }),
  def({ key: "payoutRatio", name: "Dividend payout (cash)", category: "cashflow", unit: "pct", better: "neutral", applies: "all", formula: "Dividends paid ÷ PAT (owners) × 100", description: "Cash dividends paid in the year relative to profit (timing: usually prior-year final dividend).", compute: (v, p, _s, d) => ratio(I(v, p, "dividendsPaid"), I(v, p, "patOwners", "PAT (owners)"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),

  // Working capital
  def({ key: "receivableDays", name: "Receivable days", category: "workingCapital", unit: "days", better: "lower", applies: "nonFinancial", formula: "Average trade receivables ÷ revenue × 365", description: "Days of sales outstanding.", compute: (v, p, _s, d) => ratio(avgOf("trade receivables", (q) => I(v, q, "tradeReceivables"), p, prevFy(p)), I(v, p, "revenue"), R(d, p, { scale: 365, requirePositiveDenominator: true })) }),
  def({ key: "inventoryDays", name: "Inventory days", category: "workingCapital", unit: "days", better: "lower", applies: "nonFinancial", formula: "Average inventories ÷ COGS × 365", description: "Days of inventory on hand (COGS basis).", compute: (v, p, _s, d) => { const c = cogsOp(v, p); if (c.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No COGS reported — inventory days on COGS basis not applicable."); return ratio(avgOf("inventories", (q) => I(v, q, "inventories"), p, prevFy(p)), c, R(d, p, { scale: 365, requirePositiveDenominator: true })); } }),
  def({ key: "payableDays", name: "Payable days", category: "workingCapital", unit: "days", better: "neutral", applies: "nonFinancial", formula: "Average trade payables ÷ COGS × 365", description: "Supplier credit period (COGS basis; payables also include services, so this overstates true days).", compute: (v, p, _s, d) => { const c = cogsOp(v, p); if (c.value === 0) return na(d.key, d.name, p, d.unit, d.formula, "No COGS reported."); return ratio(avgOf("trade payables", (q) => I(v, q, "tradePayables"), p, prevFy(p)), c, R(d, p, { scale: 365, requirePositiveDenominator: true })); } }),
  def({
    key: "ccc", name: "Cash conversion cycle", category: "workingCapital", unit: "days", better: "lower", applies: "nonFinancial", formula: "Receivable days + inventory days − payable days", description: "Days cash is tied up in operations.",
    compute: (v, p, s, d) => {
      const parts = ["receivableDays", "inventoryDays", "payableDays"].map((k) => ANNUAL_METRICS_BY_KEY[k].compute(v, p, s));
      const [dso, dio, dpo] = parts;
      if (dio.status === "not-applicable" && dso.value !== null) {
        return { ...dso, key: d.key, name: d.name, formula: d.formula, notes: [...dso.notes, "No inventory/COGS — CCC equals receivable days."] };
      }
      if (parts.some((x) => x.value === null)) return { key: d.key, name: d.name, periodId: p, unit: "days", formula: d.formula, value: null, status: "insufficient-data", reason: parts.filter((x) => x.value === null).map((x) => `${x.name}: ${x.reason}`).join(" | "), inputs: [], confidence: "low", notes: [] };
      return { key: d.key, name: d.name, periodId: p, unit: "days", formula: d.formula, value: dso.value! + dio.value! - dpo.value!, status: "ok", inputs: parts.flatMap((x) => x.inputs), confidence: parts.some((x) => x.confidence !== "high") ? "medium" : "high", notes: [...new Set(parts.flatMap((x) => x.notes))], numerator: { label: "DSO + DIO", value: dso.value! + dio.value! }, denominator: { label: "DPO", value: dpo.value } };
    },
  }),
  def({ key: "wcTurnover", name: "Working-capital turnover", category: "workingCapital", unit: "x", better: "higher", applies: "nonFinancial", formula: "Revenue ÷ average operating working capital", description: "Revenue per rupee of trade working capital.", compute: (v, p, _s, d) => ratio(I(v, p, "revenue"), avgOf("operating working capital", (q) => operatingWcOp(v, q), p, prevFy(p)), R(d, p, { requirePositiveDenominator: true, notMeaningfulReason: "Operating working capital is negative (supplier-funded) — turnover not meaningful." })) }),
  def({ key: "receivablesToRevenue", name: "Receivables / revenue", category: "workingCapital", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Closing trade receivables ÷ revenue × 100", description: "Closing-balance view of collection.", compute: (v, p, _s, d) => ratio(I(v, p, "tradeReceivables"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "inventoryToRevenue", name: "Inventory / revenue", category: "workingCapital", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Closing inventories ÷ revenue × 100", description: "Closing inventory intensity.", compute: (v, p, _s, d) => ratio(I(v, p, "inventories"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "nwcToRevenue", name: "Operating WC / revenue", category: "workingCapital", unit: "pct", better: "lower", applies: "nonFinancial", formula: "(Inventories + receivables − payables) ÷ revenue × 100", description: "Working capital required per rupee of sales.", compute: (v, p, _s, d) => ratio(operatingWcOp(v, p), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "changeInOperatingWc", name: "Change in operating WC", category: "workingCapital", unit: "cr", better: "lower", applies: "nonFinancial", formula: "Operating WC (this year) − operating WC (prior year)", description: "Positive = cash absorbed by working capital.", compute: (v, p, _s, d) => amount(sub("Δ operating WC", operatingWcOp(v, p), operatingWcOp(v, prevFy(p))), R(d, p)) }),

  // Returns
  def({ key: "roe", name: "Return on equity", category: "returns", unit: "pct", better: "higher", applies: "all", formula: "PAT attributable to owners ÷ average owners' equity × 100", description: "Return to shareholders on book equity.", compute: (v, p, _s, d) => ratio(I(v, p, "patOwners", "PAT (owners)"), avgOf("equity", (q) => equityOp(v, q), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true, notMeaningfulReason: "Average equity is negative — ROE not meaningful." })) }),
  def({ key: "roce", name: "Return on capital employed", category: "returns", unit: "pct", better: "higher", applies: "nonFinancial", formula: "PBIT (before exceptional) ÷ average (equity + NCI + debt) × 100", description: "Pre-tax return on all long-term capital.", compute: (v, p, s, d) => ratio(pbitOp(v, p), avgOf("capital employed", (q) => capitalEmployedOp(v, q, s), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "roa", name: "Return on assets", category: "returns", unit: "pct", better: "higher", applies: "all", formula: "PAT ÷ average total assets × 100", description: "Profit per rupee of assets.", compute: (v, p, _s, d) => ratio(I(v, p, "pat"), avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "roic", name: "Return on invested capital", category: "returns", unit: "pct", better: "higher", applies: "nonFinancial", formula: "NOPAT ÷ average invested capital × 100; NOPAT = operating EBIT × (1 − tax rate); IC = equity + NCI + debt − cash-like balances", description: "After-tax operating return on capital tied up in operations (financing approach).", compute: (v, p, s, d) => ratio(nopatOp(v, p), avgOf("invested capital", (q) => investedCapitalOp(v, q, s), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "dupontNpm", name: "DuPont: net margin", category: "returns", unit: "pct", better: "higher", applies: "all", formula: "PAT (owners) ÷ revenue × 100", description: "ROE component 1.", compute: (v, p, _s, d) => ratio(I(v, p, "patOwners", "PAT (owners)"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "dupontAt", name: "DuPont: asset turnover", category: "returns", unit: "x", better: "higher", applies: "all", formula: "Revenue ÷ average total assets", description: "ROE component 2.", compute: (v, p, _s, d) => ratio(I(v, p, "revenue"), avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "dupontEm", name: "DuPont: equity multiplier", category: "returns", unit: "x", better: "neutral", applies: "all", formula: "Average total assets ÷ average equity", description: "ROE component 3 (financial leverage).", compute: (v, p, _s, d) => ratio(avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), avgOf("equity", (q) => equityOp(v, q), p, prevFy(p)), R(d, p, { requirePositiveDenominator: true })) }),
  def({
    key: "eva", name: "Economic value added", category: "returns", unit: "cr", better: "higher", applies: "nonFinancial", formula: "NOPAT − WACC × average invested capital (WACC = your valuation assumption)", description: "Value created above the cost of capital — depends entirely on the WACC assumption.",
    compute: (v, p, s, d) => {
      if (s.wacc === null) return na(d.key, d.name, p, d.unit, d.formula, "Set a WACC assumption on the Valuation page to compute EVA.");
      const ic = avgOf("invested capital", (q) => investedCapitalOp(v, q, s), p, prevFy(p));
      const r = amount(sub("EVA", nopatOp(v, p), mul("Capital charge", ic, constant(`WACC ${s.wacc}% (assumption)`, s.wacc / 100))), R(d, p));
      r.notes.push(`Uses user-entered WACC of ${s.wacc}% — an assumption, not market data.`);
      return r;
    },
  }),
  def({ key: "accrualsRatio", name: "Accruals ratio", category: "quality", unit: "pct", better: "lower", applies: "nonFinancial", formula: "(PAT − operating cash flow) ÷ average total assets × 100", description: "High positive accruals mean profits are running ahead of cash (Sloan-style earnings quality signal).", compute: (v, p, _s, d) => ratio(sub("PAT − OCF", I(v, p, "pat"), I(v, p, "cfo")), avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "depreciationRate", name: "Depreciation / opening gross block proxy", category: "quality", unit: "pct", better: "neutral", applies: "nonFinancial", formula: "D&A ÷ average net PPE × 100", description: "Sudden drops can indicate useful-life changes that flatter profit.", compute: (v, p, _s, d) => ratio(I(v, p, "depreciation"), avgOf("net PPE", (q) => I(v, q, "ppe"), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),

  // Banks / NBFCs
  def({ key: "nii", name: "Net interest income", category: "bank", unit: "cr", better: "higher", applies: "financial", formula: "Interest earned − interest expended", description: "Core lending spread income.", compute: (v, p, _s, d) => amount(sub("NII", I(v, p, "interestEarned"), I(v, p, "interestExpended")), R(d, p)) }),
  def({ key: "niiToAssets", name: "NII / average assets", category: "bank", unit: "pct", better: "higher", applies: "financial", formula: "NII ÷ average total assets × 100", description: "Proxy for NIM (true NIM uses interest-earning assets, rarely disclosed in statements).", compute: (v, p, _s, d) => ratio(sub("NII", I(v, p, "interestEarned"), I(v, p, "interestExpended")), avgOf("total assets", (q) => I(v, q, "totalAssets"), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "costToIncome", name: "Cost-to-income", category: "bank", unit: "pct", better: "lower", applies: "financial", formula: "Operating expenses ÷ (NII + other income) × 100", description: "Operating efficiency.", compute: (v, p, _s, d) => ratio(I(v, p, "operatingExpensesBank"), add("Net total income", sub("NII", I(v, p, "interestEarned"), I(v, p, "interestExpended")), I(v, p, "otherIncome")), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "creditDeposit", name: "Credit–deposit ratio", category: "bank", unit: "pct", better: "neutral", applies: "financial", formula: "Advances ÷ deposits × 100", description: "Funding utilisation.", compute: (v, p, _s, d) => ratio(I(v, p, "advances"), I(v, p, "deposits"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "pcr", name: "Provision coverage ratio", category: "bank", unit: "pct", better: "higher", applies: "financial", formula: "(Gross NPA − net NPA) ÷ gross NPA × 100 (reported value preferred)", description: "Share of bad loans already provided for.", compute: (v, p, _s, d) => { const rep = I(v, p, "pcrReported"); if (rep.value !== null) return amount(rep, R(d, p)); return ratio(sub("Provisions held", I(v, p, "grossNpa"), I(v, p, "netNpa")), I(v, p, "grossNpa"), R(d, p, { scale: 100, requirePositiveDenominator: true })); } }),
  def({ key: "creditCost", name: "Credit cost", category: "bank", unit: "pct", better: "lower", applies: "financial", formula: "Provisions & contingencies ÷ average advances × 100", description: "Annual cost of credit losses.", compute: (v, p, _s, d) => ratio(I(v, p, "provisions"), avgOf("advances", (q) => I(v, q, "advances"), p, prevFy(p)), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),

  // Sector extras
  def({ key: "orderBookToRevenue", name: "Order book / revenue", category: "sector", unit: "x", better: "higher", applies: "nonFinancial", formula: "Order book ÷ revenue", description: "Years of revenue visibility.", compute: (v, p, _s, d) => ratio(I(v, p, "orderBook"), I(v, p, "revenue"), R(d, p, { requirePositiveDenominator: true })) }),
  def({ key: "rndPct", name: "R&D / revenue", category: "sector", unit: "pct", better: "neutral", applies: "nonFinancial", formula: "R&D expense ÷ revenue × 100", description: "Innovation intensity.", compute: (v, p, _s, d) => ratio(I(v, p, "rndExpense"), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "revenuePerEmployee", name: "Revenue per employee", category: "sector", unit: "cr", better: "higher", applies: "nonFinancial", formula: "Revenue ÷ number of employees", description: "Productivity (needs employee count).", compute: (v, p, _s, d) => ratio(I(v, p, "revenue"), I(v, p, "employees"), R(d, p, { requirePositiveDenominator: true })) }),
];

export const ANNUAL_METRICS_BY_KEY: Record<string, MetricDef> = Object.fromEntries(ANNUAL_METRICS.map((m) => [m.key, m]));

// ---------- quarterly metrics ----------
const qMargin = (key: string, name: string, num: (v: FactView, p: string) => Operand, applies: Applies = "nonFinancial"): MetricDef =>
  def({ key, name, category: "profitability", unit: "pct", better: "higher", applies, formula: `${name.replace(" margin", "")} ÷ revenue × 100`, description: "Quarterly margin.", compute: (v, p, _s, d) => ratio(num(v, p), I(v, p, "revenue"), R(d, p, { scale: 100, requirePositiveDenominator: true })) });

export const QUARTERLY_METRICS: MetricDef[] = [
  def({ key: "revenue", name: "Revenue", category: "profitability", unit: "cr", better: "higher", applies: "all", formula: "Reported revenue from operations", description: "", compute: (v, p, _s, d) => amount(I(v, p, "revenue"), R(d, p)) }),
  def({ key: "ebitda", name: "EBITDA", category: "profitability", unit: "cr", better: "higher", applies: "nonFinancial", formula: "Revenue − operating expenses (excl. finance costs, D&A, other income)", description: "Calculated.", compute: (v, p, _s, d) => amount(ebitdaOp(v, p), R(d, p)) }),
  qMargin("ebitdaMargin", "EBITDA margin", ebitdaOp),
  def({ key: "ebit", name: "EBIT", category: "profitability", unit: "cr", better: "higher", applies: "nonFinancial", formula: "EBITDA − D&A", description: "", compute: (v, p, _s, d) => amount(ebitOp(v, p), R(d, p)) }),
  qMargin("ebitMargin", "EBIT margin", ebitOp),
  def({ key: "pbt", name: "PBT", category: "profitability", unit: "cr", better: "higher", applies: "all", formula: "Reported profit before tax", description: "", compute: (v, p, _s, d) => amount(I(v, p, "pbt"), R(d, p)) }),
  def({ key: "pat", name: "PAT", category: "profitability", unit: "cr", better: "higher", applies: "all", formula: "Reported net profit for the period", description: "", compute: (v, p, _s, d) => amount(I(v, p, "pat"), R(d, p)) }),
  qMargin("patMargin", "PAT margin", (v, p) => I(v, p, "pat"), "all"),
  def({ key: "eps", name: "Diluted EPS", category: "profitability", unit: "rs", better: "higher", applies: "all", formula: "Reported diluted EPS (not annualised)", description: "", compute: (v, p, _s, d) => amount(I(v, p, "epsDiluted"), R(d, p)) }),
  def({ key: "financeCost", name: "Finance costs", category: "profitability", unit: "cr", better: "lower", applies: "all", formula: "Reported finance costs", description: "", compute: (v, p, _s, d) => amount(I(v, p, "financeCost"), R(d, p)) }),
  def({ key: "exceptional", name: "Exceptional impact", category: "quality", unit: "cr", better: "neutral", applies: "all", formula: "PBT − profit before exceptional items", description: "", compute: (v, p, _s, d) => amount(I(v, p, "exceptionalEffect", "Exceptional impact"), R(d, p)) }),
  def({ key: "effectiveTaxRate", name: "Effective tax rate", category: "profitability", unit: "pct", better: "neutral", applies: "all", formula: "Tax ÷ PBT × 100", description: "", compute: (v, p, _s, d) => ratio(I(v, p, "totalTax"), I(v, p, "pbt"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  def({ key: "otherIncomeToPbt", name: "Other income / PBT", category: "quality", unit: "pct", better: "lower", applies: "nonFinancial", formula: "Other income ÷ PBT × 100", description: "", compute: (v, p, _s, d) => ratio(I(v, p, "otherIncome"), I(v, p, "pbt"), R(d, p, { scale: 100, requirePositiveDenominator: true })) }),
  growthMetric("revenueYoY", "Revenue growth YoY", (v, p) => I(v, p, "revenue"), "all", prevYearQuarter, "Same quarter of previous year"),
  growthMetric("revenueQoQ", "Revenue growth QoQ", (v, p) => I(v, p, "revenue"), "all", prevQuarter, "Sequential (seasonality applies)"),
  growthMetric("ebitdaYoY", "EBITDA growth YoY", ebitdaOp, "nonFinancial", prevYearQuarter, "Same quarter of previous year"),
  growthMetric("patYoY", "PAT growth YoY", (v, p) => I(v, p, "pat"), "all", prevYearQuarter, "Same quarter of previous year"),
  growthMetric("patQoQ", "PAT growth QoQ", (v, p) => I(v, p, "pat"), "all", prevQuarter, "Sequential"),
];

export interface MetricSeries {
  def: MetricDef;
  byPeriod: Record<string, MetricResult>;
}

export function computeSeries(defs: MetricDef[], view: FactView, periodIds: string[], s: EngineSettings, prevOf: (pid: string) => string): Record<string, MetricSeries> {
  const out: Record<string, MetricSeries> = {};
  for (const d of defs) {
    const byPeriod: Record<string, MetricResult> = {};
    for (const p of periodIds) {
      let r: MetricResult;
      try {
        r = d.compute(view, p, s);
      } catch (e) {
        r = { key: d.key, name: d.name, periodId: p, unit: d.unit, formula: d.formula, value: null, status: "insufficient-data", reason: `Calculation error: ${e instanceof Error ? e.message : String(e)}`, inputs: [], confidence: "low", notes: [] };
      }
      byPeriod[p] = r;
    }
    for (const p of periodIds) {
      const prevR = byPeriod[prevOf(p)];
      const r = byPeriod[p];
      r.prev = prevR?.value ?? null;
      r.change = r.value !== null && prevR?.value != null ? r.value - prevR.value : null;
      r.interpretation = interpret(d, r);
    }
    out[d.key] = { def: d, byPeriod };
  }
  return out;
}

export function interpret(d: MetricDef, r: MetricResult): string {
  if (r.status === "not-applicable") return r.reason ?? "Not applicable.";
  if (r.status !== "ok" || r.value === null) return r.reason ?? "Insufficient data.";
  if (r.prev === null || r.prev === undefined || r.change === null || r.change === undefined) return "No comparable prior period available.";
  const eps = d.unit === "cr" ? Math.max(0.5, Math.abs(r.prev) * 0.01) : d.unit === "days" ? 1 : 0.1;
  if (Math.abs(r.change) < eps) return "Broadly unchanged from the prior period.";
  const up = r.change > 0;
  const dir = up ? "increased" : "decreased";
  const tone = d.better === "neutral" ? "" : (up && d.better === "higher") || (!up && d.better === "lower") ? " (favourable)" : " (unfavourable)";
  return `${d.name} ${dir} vs prior period${tone}.`;
}

/** Point-in-time summary growth measures (CAGR, volatility, acceleration). */
export function growthSummary(view: FactView, fys: string[], key: string, op?: (v: FactView, p: string) => Operand) {
  const get = (p: string) => (op ? op(view, p).value : view.get(p, key)?.value ?? null);
  const series = fys.map((p) => ({ p, v: get(p) }));
  const valid = series.filter((x) => x.v !== null) as { p: string; v: number }[];
  const last = valid[valid.length - 1];
  const yrs = (a: string, b: string) => Number(b.slice(2)) - Number(a.slice(2));
  const cagrN = (n: number) => {
    if (!last) return { value: null as number | null, reason: "No data", from: null as string | null };
    const start = valid.find((x) => yrs(x.p, last.p) === n);
    if (!start) return { value: null, reason: `Needs values ${n} years apart (have ${valid.map((x) => x.p).join(", ") || "none"}).`, from: null };
    const c = cagrCalc(last.v, start.v, n);
    return { ...c, from: start.p };
  };
  const yoy: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    if (yrs(valid[i - 1].p, valid[i].p) === 1) {
      const g = growthRate(valid[i].v, valid[i - 1].v);
      if (g.value !== null) yoy.push(g.value);
    }
  }
  const vol = yoy.length >= 3 ? stdevLocal(yoy) : null;
  const accel = yoy.length >= 2 ? yoy[yoy.length - 1] - yoy[yoy.length - 2] : null;
  return { cagr3: cagrN(3), cagr4: cagrN(4), cagr2: cagrN(2), yoy, volatility: vol, acceleration: accel, latest: last ?? null };
}

function cagrCalc(end: number, start: number, n: number) {
  if (start <= 0 || end <= 0) return { value: null as number | null, reason: "CAGR requires positive start and end values." };
  return { value: (Math.pow(end / start, 1 / n) - 1) * 100, reason: undefined as string | undefined };
}
function stdevLocal(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export { addAvailable, absOp };
