// Valuation engine. The ONLY market input is the user-entered current share
// price. No historical prices are fetched or used anywhere.
import type { DcfScenario, SectorKey, ValuationSettings } from "../types";
import { isFinancial, mean, type FactView } from "./core";
import { ebitdaOp, ebitOp, effectiveTaxRate, operatingWcOp, STATUTORY_TAX_RATE } from "./metrics";
import { growthSummary } from "./metrics";

export const CRORE = 1e7;

export interface Check {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function marketCapCrore(price: number | null, shares: number | null): { value: number | null; reason?: string } {
  if (price === null || !Number.isFinite(price)) return { value: null, reason: "Current share price is missing." };
  if (price <= 0) return { value: null, reason: "Share price must be greater than zero." };
  if (shares === null || !Number.isFinite(shares)) return { value: null, reason: "Share count is missing." };
  if (shares <= 0) return { value: null, reason: "Share count must be greater than zero." };
  return { value: (price * shares) / CRORE };
}

export interface EvBridge {
  equityValue: number;
  debt: number;
  leases: number;
  minorityInterest: number;
  otherDebtLike: number;
  cash: number;
  nonOperatingAssets: number;
}

/** EV = equity value + debt + leases + minority interest + other debt-like claims − cash − non-operating assets. */
export function enterpriseValue(b: EvBridge): number {
  return b.equityValue + b.debt + b.leases + b.minorityInterest + b.otherDebtLike - b.cash - b.nonOperatingAssets;
}

/** Inverse bridge: equity value from enterprise value. */
export function equityFromEv(ev: number, b: Omit<EvBridge, "equityValue">): number {
  return ev - b.debt - b.leases - b.minorityInterest - b.otherDebtLike + b.cash + b.nonOperatingAssets;
}

export interface DcfParams extends DcfScenario {
  baseRevenue: number;
  years: number;
  wacc: number; // %
  terminalGrowth: number; // %
  midYear: boolean;
}

export interface DcfRow {
  year: number;
  revenue: number;
  growth: number;
  ebitMargin: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  deltaNwc: number;
  fcff: number;
  discountFactor: number;
  pv: number;
}

export interface DcfResult {
  check: Check;
  rows: DcfRow[];
  sumPv: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  terminalShare: number;
}

export function validateDcf(p: DcfParams): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(p.baseRevenue > 0)) errors.push("Base-year revenue must be positive.");
  if (!Number.isFinite(p.wacc) || p.wacc <= 0) errors.push("WACC must be a positive number.");
  if (p.terminalGrowth >= p.wacc) errors.push(`Terminal growth (${p.terminalGrowth}%) must be below WACC (${p.wacc}%) in a perpetual-growth model.`);
  if (p.years < 3 || p.years > 15) errors.push("Forecast period must be between 3 and 15 years.");
  if (p.taxRate < 0 || p.taxRate > 60) errors.push("Tax rate must be between 0% and 60%.");
  if (p.wacc < 8) warnings.push(`WACC of ${p.wacc}% is low for an Indian equity (rupee risk-free rates have typically been 6–8%).`);
  if (p.wacc > 20) warnings.push(`WACC of ${p.wacc}% is very high — check inputs.`);
  if (p.terminalGrowth > 7) warnings.push(`Terminal growth of ${p.terminalGrowth}% assumed forever is aggressive; it should not exceed long-run nominal economic growth.`);
  if (p.terminalGrowth < 0) warnings.push("Negative terminal growth implies a shrinking business in perpetuity.");
  if (p.revenueGrowthStart > 30 || p.revenueGrowthEnd > 25) warnings.push("Very high revenue growth assumptions — ensure they are supported by capacity/order-book evidence.");
  if (p.ebitMarginEnd > 40) warnings.push("Terminal EBIT margin above 40% is rare outside asset-light monopolies.");
  if (p.capexPctRevenue < p.daPctRevenue * 0.8 && p.revenueGrowthEnd > 3) warnings.push("Capex below depreciation while revenue keeps growing is internally inconsistent over the long run.");
  return { ok: errors.length === 0, errors, warnings };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function runDcf(p: DcfParams): DcfResult {
  const check = validateDcf(p);
  if (!check.ok) return { check, rows: [], sumPv: NaN, terminalValue: NaN, pvTerminal: NaN, enterpriseValue: NaN, terminalShare: NaN };
  const rows: DcfRow[] = [];
  let rev = p.baseRevenue;
  const w = p.wacc / 100;
  for (let y = 1; y <= p.years; y++) {
    const t = p.years === 1 ? 1 : (y - 1) / (p.years - 1);
    const g = lerp(p.revenueGrowthStart, p.revenueGrowthEnd, t);
    const m = lerp(p.ebitMarginStart, p.ebitMarginEnd, t);
    const prevRev = rev;
    rev = prevRev * (1 + g / 100);
    const ebit = (rev * m) / 100;
    const nopat = ebit * (1 - p.taxRate / 100);
    const da = (rev * p.daPctRevenue) / 100;
    const capex = (rev * p.capexPctRevenue) / 100;
    const dNwc = ((rev - prevRev) * p.nwcPctIncrementalRevenue) / 100;
    const fcff = nopat + da - capex - dNwc;
    const df = 1 / Math.pow(1 + w, p.midYear ? y - 0.5 : y);
    rows.push({ year: y, revenue: rev, growth: g, ebitMargin: m, ebit, nopat, da, capex, deltaNwc: dNwc, fcff, discountFactor: df, pv: fcff * df });
  }
  const last = rows[rows.length - 1];
  const g = p.terminalGrowth / 100;
  const terminalValue = (last.fcff * (1 + g)) / (w - g);
  const pvTerminal = terminalValue / Math.pow(1 + w, p.years);
  const sumPv = rows.reduce((s, r) => s + r.pv, 0);
  const ev = sumPv + pvTerminal;
  const terminalShare = ev !== 0 ? pvTerminal / ev : NaN;
  if (terminalShare > 0.75) check.warnings.push(`Terminal value is ${(terminalShare * 100).toFixed(0)}% of enterprise value — the result is dominated by perpetuity assumptions.`);
  if (last.fcff < 0) check.warnings.push("Final-year free cash flow is negative, so the terminal value is negative. Revisit margin/capex assumptions.");
  return { check, rows, sumPv, terminalValue, pvTerminal, enterpriseValue: ev, terminalShare };
}

export interface PerShare {
  ev: number;
  equity: number;
  perShare: number;
  upside: number | null; // % vs price
}

export function perShareFromEv(ev: number, bridge: Omit<EvBridge, "equityValue">, shares: number, price: number | null): PerShare {
  const equity = equityFromEv(ev, bridge);
  const perShare = (equity * CRORE) / shares;
  return { ev, equity, perShare, upside: price && price > 0 ? (perShare / price - 1) * 100 : null };
}

export function sensitivityGrid(base: DcfParams, bridge: Omit<EvBridge, "equityValue">, shares: number, price: number | null, waccs: number[], gs: number[]) {
  return waccs.map((wacc) =>
    gs.map((g) => {
      const r = runDcf({ ...base, wacc, terminalGrowth: g });
      if (!r.check.ok) return { wacc, g, value: null as number | null, upside: null as number | null, error: r.check.errors[0] };
      const ps = perShareFromEv(r.enterpriseValue, bridge, shares, price);
      return { wacc, g, value: ps.perShare, upside: ps.upside, error: undefined as string | undefined };
    }),
  );
}

/** Bisection solver for a monotonic function f(x) = target on [lo, hi]. */
export function solve(f: (x: number) => number, target: number, lo: number, hi: number, tol = 1e-6, maxIter = 200): number | null {
  let flo = f(lo) - target;
  const fhi = f(hi) - target;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  let a = lo;
  let b = hi;
  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid) - target;
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      a = mid;
      flo = fm;
    } else b = mid;
  }
  return (a + b) / 2;
}

export interface ReverseDcfResult {
  impliedGrowth: number | null; // constant revenue growth over the forecast period
  impliedMargin: number | null; // constant EBIT margin
  impliedFcffYear1Multiple: number | null;
  notes: string[];
}

/** What assumptions does the user-entered price imply? */
export function reverseDcf(base: DcfParams, bridge: Omit<EvBridge, "equityValue">, shares: number, price: number): ReverseDcfResult {
  const notes: string[] = [];
  const targetEv = (price * shares) / CRORE + bridge.debt + bridge.leases + bridge.minorityInterest + bridge.otherDebtLike - bridge.cash - bridge.nonOperatingAssets;
  const evAt = (p: DcfParams) => {
    const r = runDcf(p);
    return r.check.ok ? r.enterpriseValue : NaN;
  };
  const impliedGrowth = solve((g) => evAt({ ...base, revenueGrowthStart: g, revenueGrowthEnd: g }), targetEv, -30, 60, 1e-4);
  if (impliedGrowth === null) notes.push("No constant revenue growth between −30% and 60% p.a. reproduces the entered price with the other assumptions held fixed.");
  const impliedMargin = solve((m) => evAt({ ...base, ebitMarginStart: m, ebitMarginEnd: m }), targetEv, -20, 80, 1e-4);
  if (impliedMargin === null) notes.push("No constant EBIT margin between −20% and 80% reproduces the entered price with the other assumptions held fixed.");
  const r1 = runDcf(base);
  const impliedFcffYear1Multiple = r1.check.ok && r1.rows[0]?.fcff > 0 ? targetEv / r1.rows[0].fcff : null;
  notes.push("Implied values hold every other assumption (WACC, terminal growth, tax, D&A, capex and working capital) at the base-case inputs; they are model outputs, not observable market facts.");
  return { impliedGrowth, impliedMargin, impliedFcffYear1Multiple, notes };
}

export interface DdmResult {
  check: Check;
  value: number | null;
  rows: { year: number; dps: number; pv: number }[];
  terminalValue: number | null;
  pvTerminal: number | null;
  suitability: string;
}

export function dividendDiscount(d0: number | null, g1: number, years: number, gT: number, ke: number, payout: number | null): DdmResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (d0 === null || d0 <= 0) errors.push("No dividend per share available (or zero) — DDM cannot be applied.");
  if (gT >= ke) errors.push(`Terminal dividend growth (${gT}%) must be below the cost of equity (${ke}%).`);
  if (ke <= 0) errors.push("Cost of equity must be positive.");
  let suitability = "Suitable when dividends are a stable, meaningful share of earnings.";
  if (payout !== null && payout < 20) {
    warnings.push(`Payout ratio is about ${payout.toFixed(0)}% — dividends understate value for companies that reinvest most earnings; DDM is likely to undervalue.`);
    suitability = "Low payout: DDM is of limited relevance.";
  }
  if (errors.length) return { check: { ok: false, errors, warnings }, value: null, rows: [], terminalValue: null, pvTerminal: null, suitability };
  const rows: DdmResult["rows"] = [];
  let dps = d0 as number;
  for (let y = 1; y <= years; y++) {
    dps *= 1 + g1 / 100;
    rows.push({ year: y, dps, pv: dps / Math.pow(1 + ke / 100, y) });
  }
  const tv = (dps * (1 + gT / 100)) / (ke / 100 - gT / 100);
  const pvT = tv / Math.pow(1 + ke / 100, years);
  return { check: { ok: true, errors, warnings }, value: rows.reduce((s, r) => s + r.pv, 0) + pvT, rows, terminalValue: tv, pvTerminal: pvT, suitability };
}

export interface RiResult {
  check: Check;
  value: number | null;
  rows: { year: number; bookStart: number; eps: number; ri: number; pv: number }[];
  pvTerminal: number | null;
}

/** Residual income per share: V = B0 + Σ (ROE − ke)·B(t−1) / (1+ke)^t + terminal. */
export function residualIncome(b0: number | null, roe: number | null, payout: number | null, ke: number, years: number, gT: number): RiResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (b0 === null || b0 <= 0) errors.push("Book value per share must be positive.");
  if (roe === null) errors.push("ROE assumption is missing.");
  if (payout === null || payout < 0 || payout > 100) errors.push("Payout ratio assumption must be between 0% and 100%.");
  if (gT >= ke) errors.push(`Terminal growth (${gT}%) must be below the cost of equity (${ke}%).`);
  if (roe !== null && roe > 40) warnings.push("ROE above 40% sustained for many years is exceptional.");
  if (errors.length) return { check: { ok: false, errors, warnings }, value: null, rows: [], pvTerminal: null };
  let B = b0 as number;
  const rows: RiResult["rows"] = [];
  for (let y = 1; y <= years; y++) {
    const eps = (B * (roe as number)) / 100;
    const ri = eps - (B * ke) / 100;
    const pv = ri / Math.pow(1 + ke / 100, y);
    rows.push({ year: y, bookStart: B, eps, ri, pv });
    B = B + eps * (1 - (payout as number) / 100);
  }
  const lastRi = rows[rows.length - 1].ri;
  const tv = (lastRi * (1 + gT / 100)) / (ke / 100 - gT / 100);
  const pvT = tv / Math.pow(1 + ke / 100, years);
  return { check: { ok: true, errors, warnings }, value: (b0 as number) + rows.reduce((s, r) => s + r.pv, 0) + pvT, rows, pvTerminal: pvT };
}

export function capmCostOfEquity(rf: number, beta: number, erp: number) {
  return rf + beta * erp;
}

export function waccFromInputs(ke: number, kdPreTax: number, tax: number, equityValue: number, debtValue: number): number | null {
  const total = equityValue + debtValue;
  if (!(total > 0)) return null;
  return (ke * equityValue + kdPreTax * (1 - tax / 100) * debtValue) / total;
}

export function marginOfSafety(fair: number | null, price: number | null): number | null {
  if (fair === null || price === null || fair <= 0 || price <= 0) return null;
  return ((fair - price) / fair) * 100;
}

export type Verdict = "Potentially undervalued" | "Approximately fairly valued" | "Potentially overvalued" | "Insufficient data for a reliable conclusion";

export function classify(fair: number | null, price: number | null, underPct: number, overPct: number): Verdict {
  if (fair === null || price === null || fair <= 0 || price <= 0) return "Insufficient data for a reliable conclusion";
  const mos = ((fair - price) / fair) * 100; // margin of safety
  const premium = ((price - fair) / fair) * 100;
  if (mos >= underPct) return "Potentially undervalued";
  if (premium >= overPct) return "Potentially overvalued";
  return "Approximately fairly valued";
}

// ---------------- Seeding default assumptions from history ----------------
export interface SeedInfo {
  scenarios: ValuationSettings["scenarios"];
  basis: string[];
}

export function seedScenarios(view: FactView, fys: string[]): SeedInfo {
  const basis: string[] = [];
  const recent = fys.slice(-4);
  const rev = (p: string) => view.get(p, "revenue")?.value ?? null;
  const gs = growthSummary(view, fys, "revenue");
  let g = gs.cagr3.value ?? gs.cagr2.value ?? (gs.yoy.length ? gs.yoy[gs.yoy.length - 1] : null);
  if (g === null) {
    basis.push("Revenue growth: no history available — set to 0% placeholder; enter your own assumption.");
    g = 0;
  } else basis.push(`Revenue growth seeded from ${gs.cagr3.value !== null ? "3-year CAGR" : gs.cagr2.value !== null ? "2-year CAGR" : "latest YoY growth"} (${g.toFixed(1)}%), capped to 0–20%.`);
  g = Math.max(0, Math.min(20, g));
  const margins = recent.map((p) => {
    const e = ebitOp(view, p).value;
    const r = rev(p);
    return e !== null && r ? (e / r) * 100 : null;
  }).filter((x): x is number => x !== null);
  let m = mean(margins);
  if (m === null) {
    basis.push("EBIT margin: no history — 10% placeholder; enter your own assumption.");
    m = 10;
  } else basis.push(`EBIT margin seeded from the ${margins.length}-year average operating EBIT margin (${m.toFixed(1)}%).`);
  const taxes = recent.map((p) => effectiveTaxRate(view, p).rate);
  let tax = mean(taxes) ?? STATUTORY_TAX_RATE;
  tax = Math.max(15, Math.min(35, tax));
  basis.push(`Tax rate seeded from average effective rate, bounded 15–35% (${tax.toFixed(1)}%).`);
  const ratioAvg = (k: string, label: string, fallback: number) => {
    const xs = recent.map((p) => {
      const a = view.get(p, k)?.value;
      const r = rev(p);
      return a != null && r ? (a / r) * 100 : null;
    }).filter((x): x is number => x !== null);
    const v = mean(xs);
    if (v === null) {
      basis.push(`${label}: no history — ${fallback}% placeholder.`);
      return fallback;
    }
    basis.push(`${label} seeded from ${xs.length}-year average (${v.toFixed(1)}% of revenue).`);
    return v;
  };
  const da = ratioAvg("depreciation", "D&A", 4);
  const capex = ratioAvg("capexTotal", "Capex", 6);
  const last = fys[fys.length - 1];
  const wc = last ? operatingWcOp(view, last).value : null;
  const r = last ? rev(last) : null;
  let nwc = wc !== null && r ? (wc / r) * 100 : 15;
  nwc = Math.max(-20, Math.min(60, nwc));
  basis.push(wc !== null ? `Working-capital investment seeded at ${nwc.toFixed(1)}% of incremental revenue (latest operating WC / revenue).` : "Working capital: no data — 15% placeholder.");
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const base: DcfScenario = { revenueGrowthStart: r1(g), revenueGrowthEnd: r1(Math.min(g, Math.max(5, g / 2))), ebitMarginStart: r1(m), ebitMarginEnd: r1(m), taxRate: r1(tax), daPctRevenue: r1(da), capexPctRevenue: r1(Math.max(capex, da)), nwcPctIncrementalRevenue: r1(nwc) };
  if (capex < da) basis.push("Base capex set no lower than D&A to keep long-run reinvestment consistent with growth.");
  const bear: DcfScenario = { ...base, revenueGrowthStart: r1(Math.max(-5, base.revenueGrowthStart - 5)), revenueGrowthEnd: r1(Math.max(0, base.revenueGrowthEnd - 2)), ebitMarginStart: r1(base.ebitMarginStart - 2), ebitMarginEnd: r1(base.ebitMarginEnd - 2) };
  const bull: DcfScenario = { ...base, revenueGrowthStart: r1(base.revenueGrowthStart + 4), revenueGrowthEnd: r1(base.revenueGrowthEnd + 2), ebitMarginStart: r1(base.ebitMarginStart + 1.5), ebitMarginEnd: r1(base.ebitMarginEnd + 1.5) };
  basis.push("Bear = base −5 pp initial growth and −2 pp margin; bull = base +4 pp growth and +1.5 pp margin. These are mechanical spreads for exploration, not forecasts.");
  return { scenarios: { bear, base, bull }, basis };
}

export function defaultValuationSettings(): ValuationSettings {
  const s: DcfScenario = { revenueGrowthStart: 0, revenueGrowthEnd: 0, ebitMarginStart: 10, ebitMarginEnd: 10, taxRate: STATUTORY_TAX_RATE, daPctRevenue: 4, capexPctRevenue: 5, nwcPctIncrementalRevenue: 15 };
  return {
    earningsBase: "latestFY",
    shareBasis: "basic",
    includeLeasesInDebt: true,
    includeCurrentInvestmentsInCash: false,
    includeMinorityInterest: true,
    otherNonOperatingAssets: 0,
    otherDebtLikeClaims: 0,
    forecastYears: 7,
    wacc: 12,
    terminalGrowth: 5,
    midYear: false,
    scenarios: { bear: s, base: s, bull: s },
    activeScenario: "base",
    seeded: false,
    riskFree: 7,
    beta: 1,
    equityRiskPremium: 6,
    preTaxCostOfDebt: 9,
    costOfEquity: 13,
    fairPe: null,
    ddmGrowth1: 8,
    ddmYears: 5,
    ddmTerminalGrowth: 5,
    riRoe: null,
    riPayout: null,
    riYears: 10,
    riTerminalGrowth: 4,
    navAdjustments: [],
    methodWeights: { dcf: 1, earnings: 1, residualIncome: 1, ddm: 0, asset: 0 },
    undervaluedThreshold: 20,
    overvaluedThreshold: 20,
  };
}

// ---------------- Full valuation assembly ----------------
export interface MultipleRow {
  key: string;
  name: string;
  value: number | null;
  unit: "x" | "pct";
  formula: string;
  numerator: { label: string; value: number | null };
  denominator: { label: string; value: number | null };
  status: "ok" | "not-meaningful" | "not-applicable" | "insufficient-data";
  note: string;
}

export interface ValuationInput {
  view: FactView;
  fys: string[];
  ttm: { revenue: number | null; ebitda: number | null; pat: number | null; eps: number | null; periodId: string } | null;
  sector: SectorKey;
  price: number | null;
  sharesBasic: number | null;
  sharesDiluted: number | null;
  settings: ValuationSettings;
  roeHistory: number[];
  payoutHistory: number[];
  epsCagr3: number | null;
}

export interface MethodValue {
  key: string;
  label: string;
  value: number | null;
  applicable: boolean;
  reason?: string;
}

export interface ValuationOutput {
  latest: string | null;
  shares: number | null;
  shareNote: string;
  marketCap: number | null;
  marketCapReason?: string;
  dilutedEquityValue: number | null;
  bridge: Omit<EvBridge, "equityValue"> | null;
  bridgeNotes: string[];
  ev: number | null;
  earningsLabel: string;
  multiples: MultipleRow[];
  dcf: Record<"bear" | "base" | "bull", { result: DcfResult; perShare: PerShare | null }>;
  dcfApplicable: boolean;
  dcfNote: string;
  sensitivity: ReturnType<typeof sensitivityGrid> | null;
  sensitivityAxes: { waccs: number[]; gs: number[] };
  reverse: ReverseDcfResult | null;
  tornado: { driver: string; low: number | null; high: number | null }[];
  earningsGrid: { label: string; eps: number | null; values: { pe: number; value: number | null }[] }[];
  earningsValue: number | null;
  ddm: DdmResult;
  ri: RiResult;
  riInputs: { b0: number | null; roe: number | null; payout: number | null };
  asset: { bvps: number | null; tbvps: number | null; adjustedNavPerShare: number | null; note: string };
  methods: MethodValue[];
  weighted: number | null;
  weightNote: string;
  range: { low: number | null; high: number | null };
  marginOfSafety: number | null;
  upside: number | null;
  verdict: Verdict;
  baseDcfPerShare: number | null;
  warnings: string[];
}

export function runValuation(inp: ValuationInput): ValuationOutput {
  const { view, fys, settings: s, sector, price } = inp;
  const latest = fys.length ? fys[fys.length - 1] : null;
  const fin = isFinancial(sector);
  const g = (k: string) => (latest ? view.get(latest, k)?.value ?? null : null);
  const warnings: string[] = [];
  const shares = s.shareBasis === "diluted" ? inp.sharesDiluted ?? inp.sharesBasic : inp.sharesBasic;
  const shareNote = s.shareBasis === "diluted" && inp.sharesDiluted === null ? "Diluted share count not provided — basic shares used." : `${s.shareBasis === "diluted" ? "Diluted" : "Basic"} shares outstanding.`;
  const mc = marketCapCrore(price, inp.sharesBasic);
  const dilutedEquityValue = price && inp.sharesDiluted ? (price * inp.sharesDiluted) / CRORE : null;
  const bridgeNotes: string[] = [];
  let bridge: Omit<EvBridge, "equityValue"> | null = null;
  if (latest) {
    const debt = g("totalDebt");
    const cash = (g("cash") ?? 0) + (g("otherBankBalances") ?? 0) + (s.includeCurrentInvestmentsInCash ? g("currentInvestments") ?? 0 : 0);
    if (debt === null) bridgeNotes.push("Total borrowings not available for the latest year — EV cannot be computed reliably.");
    if (g("cash") === null) bridgeNotes.push("Cash & equivalents not available for the latest year.");
    bridge = {
      debt: debt ?? NaN,
      leases: s.includeLeasesInDebt ? g("leaseLiabilities") ?? 0 : 0,
      minorityInterest: s.includeMinorityInterest ? g("nonControllingInterestBs") ?? 0 : 0,
      otherDebtLike: s.otherDebtLikeClaims || 0,
      cash,
      nonOperatingAssets: s.otherNonOperatingAssets || 0,
    };
    bridgeNotes.push(`Balance-sheet items as at ${latest} (latest annual balance sheet).`);
    bridgeNotes.push(s.includeLeasesInDebt ? "Lease liabilities treated as debt-like." : "Lease liabilities excluded from debt.");
    bridgeNotes.push(s.includeCurrentInvestmentsInCash ? "Current investments treated as cash-like (verify liquidity)." : "Current investments not netted against debt.");
    if (s.includeMinorityInterest) bridgeNotes.push("Non-controlling interest at book value added as a claim.");
    if (s.otherDebtLikeClaims) bridgeNotes.push(`Other debt-like claims (user input): ₹${s.otherDebtLikeClaims} cr.`);
    if (s.otherNonOperatingAssets) bridgeNotes.push(`Non-operating assets (user input): ₹${s.otherNonOperatingAssets} cr.`);
  }
  const bridgeOk = bridge !== null && Number.isFinite(bridge.debt);
  const ev = mc.value !== null && bridgeOk && !fin ? enterpriseValue({ equityValue: mc.value, ...(bridge as Omit<EvBridge, "equityValue">) }) : null;

  // Earnings base
  const useTtm = s.earningsBase === "ttm" && inp.ttm && inp.ttm.revenue !== null;
  const earningsLabel = useTtm ? `TTM to ${inp.ttm!.periodId}` : latest ? `${latest} (annual)` : "n/a";
  const revenue = useTtm ? inp.ttm!.revenue : g("revenue");
  const ebitda = useTtm ? inp.ttm!.ebitda : latest ? ebitdaOp(view, latest).value : null;
  const ebit = latest && !useTtm ? ebitOp(view, latest).value : null;
  const pat = useTtm ? inp.ttm!.pat : g("patOwners");
  const eps = useTtm ? inp.ttm!.eps : g("epsDiluted") ?? g("epsBasic") ?? (pat !== null && inp.sharesBasic ? (pat * CRORE) / inp.sharesBasic : null);
  const cfo = g("cfo");
  const capex = g("capexTotal");
  const fcf = cfo !== null && capex !== null ? cfo - capex : null;
  const equity = g("totalEquity");
  const dps = g("dps") ?? (g("dividendsPaid") !== null && inp.sharesBasic ? ((g("dividendsPaid") as number) * CRORE) / inp.sharesBasic : null);
  if (g("dps") === null && dps !== null) warnings.push("Dividend per share derived from cash dividends paid ÷ shares (timing may lag the declared dividend).");

  const M = (key: string, name: string, unit: "x" | "pct", formula: string, num: { label: string; value: number | null }, den: { label: string; value: number | null }, opts: { posDen?: boolean; posNum?: boolean; na?: string; scale?: number } = {}): MultipleRow => {
    if (opts.na) return { key, name, unit, formula, numerator: num, denominator: den, value: null, status: "not-applicable", note: opts.na };
    if (num.value === null || den.value === null) return { key, name, unit, formula, numerator: num, denominator: den, value: null, status: "insufficient-data", note: `Missing ${num.value === null ? num.label : den.label}.` };
    if (den.value === 0 || (opts.posDen && den.value < 0)) return { key, name, unit, formula, numerator: num, denominator: den, value: null, status: "not-meaningful", note: `${den.label} is ${den.value === 0 ? "zero" : "negative"} — multiple not meaningful.` };
    if (opts.posNum && num.value < 0) return { key, name, unit, formula, numerator: num, denominator: den, value: null, status: "not-meaningful", note: `${num.label} is negative.` };
    return { key, name, unit, formula, numerator: num, denominator: den, value: (num.value / den.value) * (opts.scale ?? 1), status: "ok", note: "" };
  };
  const evNa = fin ? "EV-based multiples are not meaningful for banks, NBFCs and insurers (debt is operating raw material)." : undefined;
  const mcN = { label: "Market capitalisation", value: mc.value };
  const evN = { label: "Enterprise value", value: ev };
  const peg = (() => {
    const pe = price !== null && eps !== null && eps > 0 ? price / eps : null;
    if (pe === null || inp.epsCagr3 === null || inp.epsCagr3 <= 0) return null;
    return pe / inp.epsCagr3;
  })();
  const leasesV = g("leaseLiabilities");
  const multiples: MultipleRow[] = [
    M("pe", "P/E", "x", "Price ÷ diluted EPS", { label: "Price", value: price }, { label: `EPS (${earningsLabel})`, value: eps }, { posDen: true }),
    M("pb", "P/B", "x", "Market cap ÷ equity attributable to owners", mcN, { label: "Book equity", value: equity }, { posDen: true }),
    M("ps", "P/S", "x", "Market cap ÷ revenue", mcN, { label: "Revenue", value: revenue }, { posDen: true }),
    M("evEbitda", "EV/EBITDA", "x", "EV ÷ EBITDA (calculated, excl. other income)", evN, { label: "EBITDA", value: ebitda }, { posDen: true, na: evNa }),
    M("evEbit", "EV/EBIT", "x", "EV ÷ operating EBIT", evN, { label: "EBIT", value: useTtm ? null : ebit }, { posDen: true, na: evNa ?? (useTtm ? "EBIT not computed on TTM basis." : undefined) }),
    M("evSales", "EV/Sales", "x", "EV ÷ revenue", evN, { label: "Revenue", value: revenue }, { posDen: true, na: evNa }),
    M("evOcf", "EV/Operating cash flow", "x", "EV ÷ OCF (latest FY)", evN, { label: "OCF", value: cfo }, { posDen: true, na: evNa }),
    M("pFcf", "Price/FCF", "x", "Market cap ÷ (OCF − capex)", mcN, { label: "Free cash flow", value: fcf }, { posDen: true, na: fin ? "FCF is not meaningful for financial institutions." : undefined }),
    M("divYield", "Dividend yield", "pct", "DPS ÷ price × 100", { label: "Dividend per share", value: dps }, { label: "Price", value: price }, { posDen: true, scale: 100 }),
    M("earningsYield", "Earnings yield", "pct", "EPS ÷ price × 100", { label: "EPS", value: eps }, { label: "Price", value: price }, { posDen: true, scale: 100 }),
    M("fcfYield", "FCF yield", "pct", "FCF ÷ market cap × 100", { label: "FCF", value: fcf }, mcN, { posDen: true, scale: 100, na: fin ? "Not meaningful for financial institutions." : undefined }),
    {
      key: "peg",
      name: "PEG (trailing)",
      unit: "x",
      formula: "P/E ÷ historical 3-year EPS CAGR (%)",
      numerator: { label: "P/E", value: price !== null && eps ? price / eps : null },
      denominator: { label: "3-yr EPS CAGR", value: inp.epsCagr3 },
      value: peg,
      status: peg === null ? (inp.epsCagr3 !== null && inp.epsCagr3 <= 0 ? "not-meaningful" : "insufficient-data") : "ok",
      note: peg === null ? "Requires positive EPS and positive historical 3-year EPS CAGR. No forward growth is assumed." : "Backward-looking: uses historical EPS growth, not a forecast.",
    },
    M("netDebtEbitda", "Net debt/EBITDA", "x", "(Debt − cash) ÷ EBITDA", { label: "Net debt", value: bridgeOk ? (bridge as EvBridge).debt + (bridge as EvBridge).leases - (bridge as EvBridge).cash : null }, { label: "EBITDA", value: ebitda }, { posDen: true, na: evNa }),
    M("evEbitdaLease", s.includeLeasesInDebt ? "EV/EBITDA excl. leases from EV" : "EV/EBITDA incl. leases in EV", "x", s.includeLeasesInDebt ? "(EV − lease liabilities) ÷ EBITDA" : "(EV + lease liabilities) ÷ EBITDA", { label: "Adjusted EV", value: ev !== null && leasesV !== null ? ev + (s.includeLeasesInDebt ? -leasesV : leasesV) : null }, { label: "EBITDA", value: ebitda }, { posDen: true, na: evNa ?? (leasesV === null || leasesV === 0 ? "No material lease liabilities captured." : undefined) }),
  ];
  if (eps !== null && eps <= 0) warnings.push("EPS is zero or negative — P/E and earnings-based valuation are not meaningful.");

  // DCF
  const dcfApplicable = !fin;
  const baseRevenue = latest ? g("revenue") : null;
  const sharesOk = shares !== null && shares > 0;
  const mk = (sc: DcfScenario): DcfParams => ({ ...sc, baseRevenue: baseRevenue ?? NaN, years: s.forecastYears, wacc: s.wacc, terminalGrowth: s.terminalGrowth, midYear: s.midYear });
  const dcf = {} as ValuationOutput["dcf"];
  for (const k of ["bear", "base", "bull"] as const) {
    const result = dcfApplicable ? runDcf(mk(s.scenarios[k])) : runDcf({ ...mk(s.scenarios[k]), baseRevenue: NaN });
    const perShare = result.check.ok && bridgeOk && sharesOk ? perShareFromEv(result.enterpriseValue, bridge as Omit<EvBridge, "equityValue">, shares as number, price) : null;
    dcf[k] = { result, perShare };
  }
  let dcfNote = "FCFF model: free cash flow to the firm discounted at WACC, then bridged to equity. Chosen because it is independent of the financing mix and suits non-financial companies.";
  if (!dcfApplicable) dcfNote = "FCFF DCF is not suitable for banks/NBFCs/insurers: debt and deposits are operating items, so 'free cash flow to the firm' is not defined. Residual income and P/B–ROE are used instead.";
  else if (!s.seeded) dcfNote += " Assumptions have not been seeded from history yet.";
  if (dcfApplicable && !bridgeOk) dcfNote += " Equity bridge incomplete (debt/cash missing).";
  if (dcfApplicable && !sharesOk) dcfNote += " Share count missing — per-share value cannot be computed.";

  const waccs = [-2, -1, 0, 1, 2].map((d) => Math.round((s.wacc + d) * 10) / 10);
  const gsAx = [-1.5, -0.75, 0, 0.75, 1.5].map((d) => Math.round((s.terminalGrowth + d) * 100) / 100);
  const baseParams = mk(s.scenarios[s.activeScenario]);
  const sensitivity = dcfApplicable && bridgeOk && sharesOk && dcf.base.result.check.ok ? sensitivityGrid(baseParams, bridge as Omit<EvBridge, "equityValue">, shares as number, price, waccs, gsAx) : null;
  const reverse = dcfApplicable && bridgeOk && sharesOk && price && price > 0 && runDcf(baseParams).check.ok ? reverseDcf(baseParams, bridge as Omit<EvBridge, "equityValue">, shares as number, price) : null;

  // Tornado on active scenario
  const tornado: ValuationOutput["tornado"] = [];
  if (dcfApplicable && bridgeOk && sharesOk && runDcf(baseParams).check.ok) {
    const ps = (p: DcfParams) => {
      const r = runDcf(p);
      return r.check.ok ? perShareFromEv(r.enterpriseValue, bridge as Omit<EvBridge, "equityValue">, shares as number, price).perShare : null;
    };
    const t = (driver: string, lo: DcfParams, hi: DcfParams) => tornado.push({ driver, low: ps(lo), high: ps(hi) });
    t("WACC ±1 pp", { ...baseParams, wacc: baseParams.wacc + 1 }, { ...baseParams, wacc: baseParams.wacc - 1 });
    t("Terminal growth ±1 pp", { ...baseParams, terminalGrowth: baseParams.terminalGrowth - 1 }, { ...baseParams, terminalGrowth: Math.min(baseParams.terminalGrowth + 1, baseParams.wacc - 0.5) });
    t("EBIT margin ±2 pp", { ...baseParams, ebitMarginStart: baseParams.ebitMarginStart - 2, ebitMarginEnd: baseParams.ebitMarginEnd - 2 }, { ...baseParams, ebitMarginStart: baseParams.ebitMarginStart + 2, ebitMarginEnd: baseParams.ebitMarginEnd + 2 });
    t("Revenue growth ±3 pp", { ...baseParams, revenueGrowthStart: baseParams.revenueGrowthStart - 3, revenueGrowthEnd: baseParams.revenueGrowthEnd - 3 }, { ...baseParams, revenueGrowthStart: baseParams.revenueGrowthStart + 3, revenueGrowthEnd: baseParams.revenueGrowthEnd + 3 });
    t("Capex ±1 pp of revenue", { ...baseParams, capexPctRevenue: baseParams.capexPctRevenue + 1 }, { ...baseParams, capexPctRevenue: baseParams.capexPctRevenue - 1 });
    tornado.sort((a, b) => Math.abs((b.high ?? 0) - (b.low ?? 0)) - Math.abs((a.high ?? 0) - (a.low ?? 0)));
  }

  // Earnings-based
  const exc = latest ? view.get(latest, "exceptionalEffect")?.value ?? null : null;
  const etr = latest ? effectiveTaxRate(view, latest).rate : STATUTORY_TAX_RATE;
  const normEps = latest && g("patOwners") !== null && inp.sharesBasic ? ((((g("patOwners") as number) - (exc ?? 0) * (1 - etr / 100)) * CRORE) / inp.sharesBasic) : null;
  const fwdEps = dcf.base.result.check.ok && dcf.base.result.rows[0] && inp.sharesBasic && latest && g("financeCost") !== null ? ((dcf.base.result.rows[0].ebit - (g("financeCost") as number) + (g("otherIncome") ?? 0)) * (1 - etr / 100) * CRORE) / inp.sharesBasic : null;
  const peList = s.fairPe ? [s.fairPe * 0.7, s.fairPe * 0.85, s.fairPe, s.fairPe * 1.15, s.fairPe * 1.3].map((x) => Math.round(x * 10) / 10) : [10, 15, 20, 25, 30];
  const epsRows: { label: string; eps: number | null }[] = [
    { label: `Reported EPS (${earningsLabel})`, eps },
    { label: "Normalised EPS (excl. exceptional items)", eps: normEps },
    { label: "Model year-1 EPS (base DCF EBIT − current interest + other income, after tax)", eps: fwdEps },
  ];
  const earningsGrid = epsRows.map((r) => ({ ...r, values: peList.map((pe) => ({ pe, value: r.eps !== null && r.eps > 0 ? r.eps * pe : null })) }));
  const earningsValue = s.fairPe && normEps !== null && normEps > 0 ? normEps * s.fairPe : null;

  // DDM
  const payoutAvg = mean(inp.payoutHistory);
  const ke = s.costOfEquity;
  const ddm = dividendDiscount(dps, s.ddmGrowth1, s.ddmYears, s.ddmTerminalGrowth, ke, payoutAvg);

  // Residual income
  const b0 = equity !== null && inp.sharesBasic ? (equity * CRORE) / inp.sharesBasic : null;
  const roeAssump = s.riRoe ?? mean(inp.roeHistory.slice(-3));
  const payoutAssump = s.riPayout ?? (payoutAvg !== null ? Math.max(0, Math.min(100, payoutAvg)) : null);
  const ri = residualIncome(b0, roeAssump, payoutAssump, ke, s.riYears, s.riTerminalGrowth);

  // Asset based
  const gwI = (g("goodwill") ?? 0) + (g("intangibles") ?? 0);
  const tbvps = equity !== null && inp.sharesBasic ? (((equity - gwI) * CRORE) / inp.sharesBasic) : null;
  const navAdj = s.navAdjustments.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const adjustedNavPerShare = equity !== null && inp.sharesBasic && s.navAdjustments.length ? (((equity + navAdj) * CRORE) / inp.sharesBasic) : null;

  const methods: MethodValue[] = [
    { key: "dcf", label: "DCF (FCFF, active scenario)", value: dcf[s.activeScenario].perShare?.perShare ?? null, applicable: dcfApplicable, reason: !dcfApplicable ? "Unsuitable for financials" : dcf[s.activeScenario].result.check.errors[0] },
    { key: "earnings", label: "Earnings-based (normalised EPS × your fair P/E)", value: earningsValue, applicable: true, reason: s.fairPe ? (normEps === null || normEps <= 0 ? "Normalised EPS not positive" : undefined) : "Enter a fair P/E assumption" },
    { key: "residualIncome", label: "Residual income", value: ri.value, applicable: true, reason: ri.check.errors[0] },
    { key: "ddm", label: "Dividend discount", value: ddm.value, applicable: true, reason: ddm.check.errors[0] },
    { key: "asset", label: s.navAdjustments.length ? "Adjusted net asset value" : "Book value per share", value: adjustedNavPerShare ?? b0, applicable: true, reason: b0 === null ? "Equity or shares missing" : undefined },
  ];
  let wSum = 0;
  let acc = 0;
  const used: string[] = [];
  for (const mth of methods) {
    const w = s.methodWeights[mth.key] ?? 0;
    if (w > 0 && mth.value !== null && mth.applicable && Number.isFinite(mth.value)) {
      wSum += w;
      acc += w * mth.value;
      used.push(`${mth.label} (weight ${w})`);
    }
  }
  const weighted = wSum > 0 ? acc / wSum : null;
  const weightNote = used.length ? `Weighted average of: ${used.join("; ")}. Weights are yours to change; methods with zero weight or no value are excluded.` : "No method has both a value and a positive weight.";
  const vals = [...methods.filter((m) => m.value !== null && m.applicable && (s.methodWeights[m.key] ?? 0) > 0).map((m) => m.value as number), ...(dcfApplicable ? (["bear", "bull"] as const).map((k) => dcf[k].perShare?.perShare).filter((x): x is number => x !== undefined && x !== null) : [])];
  const range = vals.length ? { low: Math.min(...vals), high: Math.max(...vals) } : { low: null, high: null };
  if (price === null) warnings.push("Enter the current share price to compute market value, multiples and upside/downside.");
  if (inp.sharesBasic === null) warnings.push("Share count is missing — enter it on the Valuation page or confirm the value derived from paid-up capital.");
  return {
    latest,
    shares,
    shareNote,
    marketCap: mc.value,
    marketCapReason: mc.reason,
    dilutedEquityValue,
    bridge,
    bridgeNotes,
    ev,
    earningsLabel,
    multiples,
    dcf,
    dcfApplicable,
    dcfNote,
    sensitivity,
    sensitivityAxes: { waccs, gs: gsAx },
    reverse,
    tornado,
    earningsGrid,
    earningsValue,
    ddm,
    ri,
    riInputs: { b0, roe: roeAssump, payout: payoutAssump },
    asset: { bvps: b0, tbvps, adjustedNavPerShare, note: "Accounting book value is not realisable or liquidation value; adjustments are your own estimates." },
    methods,
    weighted,
    weightNote,
    range,
    marginOfSafety: marginOfSafety(weighted, price),
    upside: weighted !== null && price ? (weighted / price - 1) * 100 : null,
    verdict: classify(weighted, price, s.undervaluedThreshold, s.overvaluedThreshold),
    baseDcfPerShare: dcf.base.perShare?.perShare ?? null,
    warnings,
  };
}
