// Five-year bear/base/bull projections. Model-generated estimates driven by
// explicit, editable assumptions — never presented as management forecasts.
import type { DcfScenario, ProjectionSettings } from "../types";
import type { FactView } from "./core";
import { ebitOp } from "./metrics";

export interface ProjectionRow {
  year: number;
  label: string;
  revenue: number;
  growth: number;
  ebitda: number;
  ebitdaMargin: number;
  ebit: number;
  otherIncome: number;
  interest: number;
  pbt: number;
  tax: number;
  pat: number;
  eps: number | null;
  capex: number;
  deltaNwc: number;
  ocf: number;
  fcf: number;
  dividends: number;
  debt: number;
  netDebt: number;
  equity: number;
  roce: number | null;
  roic: number | null;
}

export interface ProjectionResult {
  ok: boolean;
  errors: string[];
  assumptions: string[];
  base: { fy: string; revenue: number; debt: number; cash: number; equity: number; otherIncome: number } | null;
  rows: ProjectionRow[];
}

export function project(view: FactView, latestFy: string | null, sc: DcfScenario, ps: ProjectionSettings, shares: number | null, years = 5): ProjectionResult {
  const errors: string[] = [];
  const assumptions: string[] = [];
  if (!latestFy) return { ok: false, errors: ["No annual data available."], assumptions, base: null, rows: [] };
  const g = (k: string) => view.get(latestFy, k)?.value ?? null;
  const revenue0 = g("revenue");
  const debt0 = g("totalDebt");
  const cash0 = (g("cash") ?? 0) + (g("otherBankBalances") ?? 0);
  const equity0 = g("totalEquity");
  const fin0 = g("financeCost");
  if (revenue0 === null || revenue0 <= 0) errors.push("Latest annual revenue is missing.");
  if (debt0 === null) errors.push("Latest total borrowings are missing.");
  if (equity0 === null) errors.push("Latest equity is missing.");
  if (errors.length) return { ok: false, errors, assumptions, base: null, rows: [] };
  const prevDebt = view.get(`FY${Number(latestFy.slice(2)) - 1}`, "totalDebt")?.value ?? null;
  const avgDebt0 = prevDebt !== null ? (debt0! + prevDebt) / 2 : debt0!;
  let rate = ps.interestRateOnDebt;
  if (rate === null) {
    rate = fin0 !== null && avgDebt0 > 0 ? Math.min(20, (fin0 / avgDebt0) * 100) : 9;
    assumptions.push(fin0 !== null && avgDebt0 > 0 ? `Interest rate ${rate.toFixed(1)}% = latest finance costs ÷ average borrowings (includes lease interest and other finance charges).` : "Interest rate 9% placeholder (no finance-cost history).");
  } else assumptions.push(`Interest rate on debt: ${rate}% (your assumption).`);
  const oi = g("otherIncome") ?? 0;
  assumptions.push(`Other income held flat at the latest annual level (₹${oi.toFixed(0)} cr).`);
  const latestPat = g("patOwners");
  const latestDiv = g("dividendsPaid");
  const payout = ps.payoutRatio ?? (latestPat && latestPat > 0 && latestDiv !== null ? Math.min(100, (latestDiv / latestPat) * 100) : 20);
  assumptions.push(`Dividend payout ${payout.toFixed(0)}% of PAT${ps.payoutRatio === null ? " (latest cash payout; editable)" : ""}.`);
  assumptions.push(ps.useFcfToRepayDebt ? "Free cash flow after dividends is used to repay debt (debt floored at zero; shortfalls are borrowed)." : `Net borrowing of ${ps.netBorrowingPctRevenue}% of revenue each year.`);
  assumptions.push("Cash balance held constant; OCF (model) = PAT + D&A − increase in operating working capital.");
  assumptions.push(`Revenue growth ${sc.revenueGrowthStart}% → ${sc.revenueGrowthEnd}%, EBIT margin ${sc.ebitMarginStart}% → ${sc.ebitMarginEnd}%, tax ${sc.taxRate}%, D&A ${sc.daPctRevenue}% and capex ${sc.capexPctRevenue}% of revenue, working capital ${sc.nwcPctIncrementalRevenue}% of incremental revenue (from the valuation scenario).`);
  const rows: ProjectionRow[] = [];
  let rev = revenue0!;
  let debt = debt0!;
  let equity = equity0!;
  const fy0 = Number(latestFy.slice(2));
  const lastEbit = ebitOp(view, latestFy).value;
  let prevCap = equity0! + debt0!;
  let prevIc = prevCap - cash0;
  for (let y = 1; y <= years; y++) {
    const t = years === 1 ? 1 : (y - 1) / (years - 1);
    const gr = sc.revenueGrowthStart + (sc.revenueGrowthEnd - sc.revenueGrowthStart) * t;
    const mg = sc.ebitMarginStart + (sc.ebitMarginEnd - sc.ebitMarginStart) * t;
    const prevRev = rev;
    rev = prevRev * (1 + gr / 100);
    const ebit = (rev * mg) / 100;
    const da = (rev * sc.daPctRevenue) / 100;
    const ebitda = ebit + da;
    const capex = (rev * sc.capexPctRevenue) / 100;
    const dNwc = ((rev - prevRev) * sc.nwcPctIncrementalRevenue) / 100;
    // interest on opening debt (avoids circularity)
    const interest = (debt * (rate as number)) / 100;
    const pbt = ebit + oi - interest;
    const tax = pbt > 0 ? (pbt * sc.taxRate) / 100 : 0;
    const pat = pbt - tax;
    const ocf = pat + da - dNwc;
    const fcf = ocf - capex;
    const dividends = pat > 0 ? (pat * payout) / 100 : 0;
    const openDebt = debt;
    if (ps.useFcfToRepayDebt) debt = Math.max(0, debt - (fcf - dividends));
    else debt = Math.max(0, debt + (rev * ps.netBorrowingPctRevenue) / 100);
    if (!ps.useFcfToRepayDebt && fcf - dividends + (debt - openDebt) < 0) {
      // funding gap shows up as extra borrowing to keep cash constant
      debt += -(fcf - dividends + (debt - openDebt));
    }
    equity = equity + pat - dividends;
    const cap = equity + debt;
    const ic = cap - cash0;
    const roce = (prevCap + cap) / 2 > 0 ? ((ebit + oi) / ((prevCap + cap) / 2)) * 100 : null;
    const roic = (prevIc + ic) / 2 > 0 ? ((ebit * (1 - sc.taxRate / 100)) / ((prevIc + ic) / 2)) * 100 : null;
    prevCap = cap;
    prevIc = ic;
    rows.push({
      year: y,
      label: `FY${fy0 + y - 1}-${String(fy0 + y).slice(2)}E`,
      revenue: rev,
      growth: gr,
      ebitda,
      ebitdaMargin: (ebitda / rev) * 100,
      ebit,
      otherIncome: oi,
      interest,
      pbt,
      tax,
      pat,
      eps: shares ? (pat * 1e7) / shares : null,
      capex,
      deltaNwc: dNwc,
      ocf,
      fcf,
      dividends,
      debt,
      netDebt: debt - cash0,
      equity,
      roce,
      roic,
    });
  }
  if (lastEbit !== null && revenue0 && Math.abs(sc.ebitMarginStart - (lastEbit / revenue0) * 100) > 5) {
    assumptions.push(`Note: year-1 EBIT margin (${sc.ebitMarginStart}%) differs by more than 5 pp from the latest actual (${((lastEbit / revenue0) * 100).toFixed(1)}%).`);
  }
  return { ok: true, errors, assumptions, base: { fy: latestFy, revenue: revenue0!, debt: debt0!, cash: cash0, equity: equity0!, otherIncome: oi }, rows };
}
