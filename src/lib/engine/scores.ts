// Transparent, configurable scoring. Scores summarise the calculated metrics
// using disclosed heuristic bands — they are analytical aids, not truths.
import type { GuidanceItem, ScoreWeights, StrategyItem } from "../types";
import { bandScore, type Band, type SectorProfile } from "../sector/profiles";
import type { MetricSeries } from "./metrics";
import type { FactView, MetricUnit } from "./core";
import type { ModelResult, RedFlag } from "./forensics";
import type { ValuationOutput } from "./valuation";
import type { GuidanceEval } from "./management";

export interface ScoreInput {
  label: string;
  value: number | null;
  unit: MetricUnit;
  band: Band;
  subScore: number | null;
}

export interface ComponentScore {
  key: keyof ScoreWeights;
  label: string;
  score: number | null;
  weight: number;
  inputs: ScoreInput[];
  note?: string;
}

export interface CompositeScore {
  key: string;
  label: string;
  score: number | null;
  confidence: "high" | "medium" | "low" | "n/a";
  explanation: string[];
  components?: ComponentScore[];
  inputs?: ScoreInput[];
  higherIsBetter: boolean;
}

const LABELS: Record<keyof ScoreWeights, string> = {
  profitability: "Profitability",
  growth: "Growth",
  cashFlow: "Cash-flow quality",
  balanceSheet: "Balance-sheet strength",
  capitalEfficiency: "Capital efficiency",
  workingCapital: "Working-capital management",
  earningsQuality: "Earnings quality",
  resilience: "Financial resilience",
};

function avgScores(inputs: ScoreInput[]): number | null {
  const v = inputs.map((i) => i.subScore).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const si = (label: string, value: number | null, unit: MetricUnit, band: Band): ScoreInput => ({ label, value, unit, band, subScore: bandScore(value, band) });

export interface ScoreContext {
  view: FactView;
  fys: string[];
  annual: Record<string, MetricSeries>;
  profile: SectorProfile;
  weights: ScoreWeights;
  growth: { revenueCagr3: number | null; patCagr3: number | null; revenueVol: number | null; totalIncomeCagr3: number | null };
  flags: RedFlag[];
  altmanZpp: ModelResult | null;
  valuation: ValuationOutput | null;
  costOfEquity: number;
  wacc: number;
  strategy: StrategyItem[];
  guidance: { item: GuidanceItem; eval: GuidanceEval }[];
}

export function computeScores(c: ScoreContext) {
  const L = c.fys[c.fys.length - 1];
  const m = (k: string, p = L) => (p ? c.annual[k]?.byPeriod[p]?.value ?? null : null);
  const B = c.profile.bands;
  const fin = c.profile.financial;
  const v = (k: string) => (L ? c.view.get(L, k)?.value ?? null : null);

  // cumulative conversion & FCF positivity
  let cumCfo = 0, cumPat = 0, nConv = 0, fcfPos = 0, fcfN = 0;
  for (const p of c.fys) {
    const cfo = c.view.get(p, "cfo")?.value;
    const pat = c.view.get(p, "pat")?.value;
    if (cfo != null && pat != null) { cumCfo += cfo; cumPat += pat; nConv++; }
    const f = m("fcf", p);
    if (f !== null) { fcfN++; if (f > 0) fcfPos++; }
  }
  const cumConv = nConv >= 2 && cumPat > 0 ? cumCfo / cumPat : null;
  const auditPenalty = c.flags.filter((f) => f.category === "audit" && (f.severity === "critical" || f.severity === "high")).length;

  const comps: ComponentScore[] = [];
  const add = (key: keyof ScoreWeights, inputs: ScoreInput[], note?: string, adj = 0) => {
    const base = avgScores(inputs);
    comps.push({ key, label: LABELS[key], score: base === null ? null : Math.max(0, Math.min(100, base + adj)), weight: c.weights[key], inputs, note });
  };
  if (!fin) {
    const em = m("ebitdaMargin");
    const emOld = c.fys.length >= 3 ? m("ebitdaMargin", c.fys[c.fys.length - 3]) : null;
    const trendAdj = em !== null && emOld !== null ? (em - emOld > 1 ? 5 : em - emOld < -1 ? -5 : 0) : 0;
    add("profitability", [si("EBITDA margin", em, "pct", B.ebitdaMargin), si("PAT margin", m("patMargin"), "pct", B.patMargin), si("ROE", m("roe"), "pct", B.roe)], trendAdj ? `Trend adjustment ${trendAdj > 0 ? "+" : ""}${trendAdj} (EBITDA margin vs two years earlier).` : undefined, trendAdj);
    add("growth", [si("Revenue 3-yr CAGR", c.growth.revenueCagr3, "pct", { worst: 0, best: 20 }), si("PAT 3-yr CAGR", c.growth.patCagr3, "pct", { worst: -5, best: 25 }), si("Revenue growth volatility (σ)", c.growth.revenueVol, "pct", { worst: 25, best: 2 })]);
    add("cashFlow", [si("Cumulative OCF / PAT", cumConv, "x", { worst: 0.3, best: 1.2 }), si("Share of years with positive FCF", fcfN ? (fcfPos / fcfN) * 100 : null, "pct", { worst: 0, best: 100 }), si("OCF / EBITDA (latest)", m("ocfToEbitda"), "pct", { worst: 40, best: 90 })]);
    add("balanceSheet", [si("Net debt / EBITDA", m("netDebtToEbitda") ?? (m("netDebt") !== null && m("netDebt")! <= 0 ? 0 : null), "x", B.netDebtToEbitda), si("Debt / equity", m("debtToEquity"), "x", B.debtToEquity), si("Current ratio", m("currentRatio"), "x", { worst: 0.7, best: 2 })]);
    add("capitalEfficiency", [si("ROCE", m("roce"), "pct", B.roce), si("ROIC", m("roic"), "pct", { worst: 0, best: 20 })]);
    const ccc = m("ccc");
    const cccOld = c.fys.length >= 3 ? m("ccc", c.fys[c.fys.length - 3]) : null;
    add("workingCapital", [si("Cash conversion cycle", ccc, "days", B.ccc), si("Receivable days", m("receivableDays"), "days", B.receivableDays)], undefined, ccc !== null && cccOld !== null ? (ccc < cccOld - 5 ? 5 : ccc > cccOld + 5 ? -5 : 0) : 0);
    add("earningsQuality", [si("Other income / PBT", m("otherIncomeToPbt"), "pct", { worst: 50, best: 0 }), si("Accruals ratio", m("accrualsRatio"), "pct", { worst: 15, best: -5 }), si("|Exceptional| / PBT", m("exceptionalToPbt") !== null ? Math.abs(m("exceptionalToPbt") as number) : null, "pct", { worst: 25, best: 0 })], auditPenalty ? `Penalty −${auditPenalty * 15} for ${auditPenalty} serious audit finding(s).` : undefined, -auditPenalty * 15);
    add("resilience", [si("Interest coverage", m("interestCoverage") ?? (v("financeCost") === 0 ? 20 : null), "x", B.interestCoverage), si("Cash ratio", m("cashRatio"), "x", { worst: 0, best: 0.5 }), si("Altman Z''", c.altmanZpp?.computed ? c.altmanZpp.value : null, "num", { worst: 1.1, best: 2.6 })]);
  } else {
    add("profitability", [si("ROA", m("roa"), "pct", { worst: 0, best: 1.8 }), si("ROE", m("roe"), "pct", { worst: 0, best: 18 })]);
    add("growth", [si("Total income 3-yr CAGR", c.growth.totalIncomeCagr3, "pct", { worst: 0, best: 20 }), si("PAT 3-yr CAGR", c.growth.patCagr3, "pct", { worst: -5, best: 25 })]);
    add("balanceSheet", [si("Gross NPA %", v("grossNpaPct"), "pct", { worst: 10, best: 1 }), si("Net NPA %", v("netNpaPct"), "pct", { worst: 5, best: 0.3 }), si("Capital adequacy %", v("car"), "pct", { worst: 9, best: 18 }), si("Provision coverage %", m("pcr"), "pct", { worst: 40, best: 85 })]);
    add("capitalEfficiency", [si("ROE", m("roe"), "pct", { worst: 0, best: 18 })]);
    add("earningsQuality", [si("Cost-to-income", m("costToIncome"), "pct", { worst: 70, best: 35 }), si("Credit cost", m("creditCost"), "pct", { worst: 3, best: 0.3 })], auditPenalty ? `Penalty −${auditPenalty * 15} for serious audit findings.` : undefined, -auditPenalty * 15);
    add("resilience", [si("Capital adequacy %", v("car"), "pct", { worst: 9, best: 20 }), si("Equity ratio", m("equityRatio"), "pct", { worst: 5, best: 14 })]);
    add("cashFlow", [], "Not used for financial institutions.");
    add("workingCapital", [], "Not used for financial institutions.");
  }
  const avail = comps.filter((x) => x.score !== null && x.weight > 0);
  const totalW = comps.filter((x) => x.weight > 0).reduce((s, x) => s + x.weight, 0);
  const availW = avail.reduce((s, x) => s + x.weight, 0);
  const health = availW > 0 ? avail.reduce((s, x) => s + (x.score as number) * x.weight, 0) / availW : null;
  const coverage = totalW > 0 ? availW / totalW : 0;
  const conf = (cov: number, years: number): CompositeScore["confidence"] => (cov >= 0.75 && years >= 4 ? "high" : cov >= 0.5 && years >= 2 ? "medium" : "low");

  const financialHealth: CompositeScore = {
    key: "financialHealth",
    label: "Financial Health",
    score: health,
    confidence: health === null ? "n/a" : conf(coverage, c.fys.length),
    higherIsBetter: true,
    components: comps,
    explanation: [
      `Weighted average of ${avail.length} available component(s) covering ${(coverage * 100).toFixed(0)}% of total weight (${c.profile.label} profile).`,
      "Each input is mapped linearly onto 0–100 between a 'worst' and 'best' reference value (bands shown per input). Bands are heuristic, disclosed, and not peer averages.",
      c.fys.length < 4 ? `Only ${c.fys.length} year(s) of data — confidence reduced.` : "Four or more years of data available.",
    ],
  };
  const eqComp = comps.find((x) => x.key === "earningsQuality");
  const earningsQuality: CompositeScore = { key: "earningsQuality", label: "Earnings Quality", score: eqComp?.score ?? null, confidence: eqComp?.score == null ? "n/a" : conf(eqComp.inputs.filter((i) => i.subScore !== null).length / Math.max(1, eqComp.inputs.length), c.fys.length), higherIsBetter: true, inputs: [...(eqComp?.inputs ?? []), ...(!fin ? [si("Cumulative OCF / PAT", cumConv, "x", { worst: 0.3, best: 1.2 })] : [])], explanation: ["Other-income dependence, accruals, exceptional items and serious audit findings.", eqComp?.note ?? ""].filter(Boolean) };
  if (!fin && earningsQuality.inputs) {
    const s2 = avgScores(earningsQuality.inputs);
    earningsQuality.score = s2 === null ? null : Math.max(0, s2 - auditPenalty * 15);
  }
  const bs = comps.find((x) => x.key === "balanceSheet")?.score ?? null;
  const rs = comps.find((x) => x.key === "resilience")?.score ?? null;
  const bsRiskVals = [bs, rs].filter((x): x is number => x !== null).map((x) => 100 - x);
  const balanceSheetRisk: CompositeScore = { key: "balanceSheetRisk", label: "Balance-Sheet Risk", score: bsRiskVals.length ? bsRiskVals.reduce((a, b) => a + b, 0) / bsRiskVals.length : null, confidence: bsRiskVals.length === 2 ? conf(1, c.fys.length) : bsRiskVals.length ? "low" : "n/a", higherIsBetter: false, inputs: [...(comps.find((x) => x.key === "balanceSheet")?.inputs ?? []), ...(comps.find((x) => x.key === "resilience")?.inputs ?? [])], explanation: ["Higher = MORE risk. Computed as 100 − average of the balance-sheet strength and resilience components."] };

  // Capital allocation
  const roic = m("roic");
  const spread = roic !== null && !fin ? roic - c.wacc : fin && m("roe") !== null ? (m("roe") as number) - c.costOfEquity : null;
  let incRoic: number | null = null;
  if (!fin && c.fys.length >= 3) {
    const a = c.fys[0];
    const nop = (p: string) => {
      const e = c.annual.ebit?.byPeriod[p]?.value;
      const t = c.annual.effectiveTaxRate?.byPeriod[p]?.value;
      return e != null ? e * (1 - (t != null && t >= 0 && t <= 50 ? t : 25.168) / 100) : null;
    };
    const ic = (p: string) => {
      const ce = c.annual.capitalEmployed?.byPeriod[p]?.value;
      const cl = c.annual.cashLike?.byPeriod[p]?.value;
      return ce != null && cl != null ? ce - cl : null;
    };
    const dN = nop(L!) !== null && nop(a) !== null ? (nop(L!) as number) - (nop(a) as number) : null;
    const dI = ic(L!) !== null && ic(a) !== null ? (ic(L!) as number) - (ic(a) as number) : null;
    incRoic = dN !== null && dI !== null && dI > 0 ? (dN / dI) * 100 : null;
  }
  let fcfAfterDivPos = 0, fcfAfterDivN = 0;
  for (const p of c.fys) {
    const x = m("fcfAfterDividends", p);
    if (x !== null) { fcfAfterDivN++; if (x >= 0) fcfAfterDivPos++; }
  }
  const caInputs = [
    si(fin ? "ROE − cost of equity (pp)" : "ROIC − WACC (pp)", spread, "pct", { worst: -5, best: 10 }),
    si("Incremental ROIC (first → latest year)", incRoic, "pct", { worst: 0, best: 25 }),
    si("Years where FCF covered dividends", fcfAfterDivN ? (fcfAfterDivPos / fcfAfterDivN) * 100 : null, "pct", { worst: 0, best: 100 }),
  ];
  const caScore = avgScores(caInputs);
  const capitalAllocation: CompositeScore = { key: "capitalAllocation", label: "Capital Allocation", score: caScore, confidence: caScore === null ? "n/a" : conf(caInputs.filter((i) => i.subScore !== null).length / caInputs.length, c.fys.length), higherIsBetter: true, inputs: caInputs, explanation: [`Uses your ${fin ? "cost of equity" : "WACC"} assumption (${fin ? c.costOfEquity : c.wacc}%) — change it on the Valuation page.`, "Incremental ROIC = Δ NOPAT ÷ Δ invested capital between the first and latest available years (only when invested capital grew)."] };

  // Management outlook
  const statusScore: Record<string, number> = { achieved: 100, "on-track": 80, "partially-achieved": 50, delayed: 25, "not-achieved": 0 };
  const assessed = c.strategy.filter((s) => s.confirmed && s.status !== "insufficient-evidence");
  const gEval = c.guidance.filter((g) => g.eval.status !== "insufficient-evidence" && g.eval.status !== "pending");
  const vals = [...assessed.map((s) => statusScore[s.status]), ...gEval.map((g) => statusScore[g.eval.status] ?? 0)];
  const managementOutlook: CompositeScore = {
    key: "managementOutlook",
    label: "Management Delivery",
    score: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    confidence: vals.length >= 5 ? "medium" : vals.length ? "low" : "n/a",
    higherIsBetter: true,
    explanation: vals.length
      ? [`Average delivery score across ${assessed.length} assessed strategic commitment(s) and ${gEval.length} quantified guidance item(s) (achieved 100, on track 80, partial 50, delayed 25, not achieved 0).`]
      : ["Insufficient evidence: confirm strategic statements and record guidance on the Management page to assess delivery."],
  };

  // Valuation attractiveness (kept separate from quality)
  const val = c.valuation;
  const ey = val?.multiples.find((x) => x.key === "earningsYield")?.value ?? null;
  const fy = val?.multiples.find((x) => x.key === "fcfYield")?.value ?? null;
  const vInputs = [
    si("Margin of safety vs weighted fair value", val?.marginOfSafety ?? null, "pct", { worst: -50, best: 40 }),
    si("Earnings yield − cost of equity (pp)", ey !== null ? ey - c.costOfEquity : null, "pct", { worst: -8, best: 3 }),
    ...(fin ? [] : [si("FCF yield", fy, "pct", { worst: 0, best: 8 })]),
  ];
  const vScore = avgScores(vInputs);
  const valuationAttractiveness: CompositeScore = { key: "valuationAttractiveness", label: "Valuation Attractiveness", score: vScore, confidence: vScore === null ? "n/a" : val?.weighted !== null ? "medium" : "low", higherIsBetter: true, inputs: vInputs, explanation: ["Based only on the user-entered share price and your valuation assumptions. Deliberately separate from company quality."] };

  return { financialHealth, earningsQuality, balanceSheetRisk, capitalAllocation, managementOutlook, valuationAttractiveness };
}
