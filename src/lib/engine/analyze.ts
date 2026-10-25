// Orchestrates the full deterministic analysis for one project + basis.
import type { AuditFinding, DocMeta, Project, SegmentFact } from "../types";
import { makeView, isFinancial, type FactView, type MetricResult } from "./core";
import { availablePeriods, deriveFacts, prevFy, prevQuarter } from "./derive";
import { ANNUAL_METRICS, computeSeries, growthSummary, QUARTERLY_METRICS, ebitdaOp, type EngineSettings, type MetricSeries } from "./metrics";
import { computeTtm, earningsVolatility, missingQuarters, reconcileQuarters, seasonality, type TtmPoint } from "./quarterly";
import { altman, beneish, forensicFlags, type ModelResult, type RedFlag } from "./forensics";
import { runValuation, type ValuationOutput } from "./valuation";
import { project as runProjection, type ProjectionResult } from "./projections";
import { dataQuality, type DqResult } from "./dataQuality";
import { evaluateGuidance, type GuidanceEval } from "./management";
import { computeScores } from "./scores";
import { buildRisks, type RiskItem } from "./risks";
import { SECTOR_PROFILES } from "../sector/profiles";
import { periodSortKey } from "../extraction/parseUtils";
import { itemLabel } from "../lineItems";

export interface Finding {
  kind: "positive" | "concern" | "trend" | "question" | "priority";
  title: string;
  detail: string;
  evidence: { label: string; value: string; period?: string }[];
  link?: string;
  sources?: { docName: string; page?: number }[];
}

export interface Analysis {
  basis: Project["ui"]["basis"];
  view: FactView;
  fys: string[];
  quarters: string[];
  latestFy: string | null;
  annual: Record<string, MetricSeries>;
  quarterly: Record<string, MetricSeries>;
  growth: Record<string, ReturnType<typeof growthSummary>>;
  ttm: TtmPoint[];
  recon: ReturnType<typeof reconcileQuarters>;
  season: ReturnType<typeof seasonality>;
  volatility: ReturnType<typeof earningsVolatility>;
  missingQs: string[];
  shares: { basic: number | null; diluted: number | null; source: string };
  valuation: ValuationOutput;
  flags: RedFlag[];
  beneish: ModelResult;
  altman: ModelResult[];
  dq: DqResult;
  guidance: { item: Project["guidance"][number]; eval: GuidanceEval }[];
  scores: ReturnType<typeof computeScores>;
  risks: RiskItem[];
  projections: Record<"bear" | "base" | "bull", ProjectionResult>;
  capitalAllocation: CapitalAllocation;
  findings: Finding[];
  segments: SegmentFact[];
  auditFindings: AuditFinding[];
  financial: boolean;
  conclusion: string[];
}

export interface CapitalAllocation {
  years: string[];
  totals: { label: string; value: number | null; note?: string }[];
  perYear: { fy: string; cfo: number | null; capex: number | null; acquisitions: number | null; dividends: number | null; buyback: number | null; netBorrowing: number | null; fcf: number | null }[];
  retentionRatio: number | null;
  payoutRatio: number | null;
  incrementalReturn: { value: number | null; note: string };
  observations: string[];
}

const fmt = (v: number | null | undefined, d = 1, suffix = "") => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}${suffix}`);

export function analyze(project: Project, docs: DocMeta[]): Analysis {
  const basis = project.ui.basis;
  const raw = project.facts[basis] ?? {};
  const derived = deriveFacts(raw, { basis });
  const view = makeView(derived);
  const { fy: fys, q: quarters } = availablePeriods(derived);
  const latestFy = fys.length ? fys[fys.length - 1] : null;
  const sector = project.sector;
  const profile = SECTOR_PROFILES[sector] ?? SECTOR_PROFILES.general;
  const financial = isFinancial(sector);
  const vs = project.settings.valuation;
  const es: EngineSettings = { includeLeasesInDebt: vs.includeLeasesInDebt, includeCurrentInvestmentsInCash: vs.includeCurrentInvestmentsInCash, wacc: vs.wacc, sector };

  const annual = computeSeries(ANNUAL_METRICS, view, fys, es, prevFy);
  const quarterly = computeSeries(QUARTERLY_METRICS, view, quarters, es, prevQuarter);
  const growth = {
    revenue: growthSummary(view, fys, "revenue"),
    pat: growthSummary(view, fys, "patOwners"),
    ebitda: growthSummary(view, fys, "ebitda", (v, p) => ebitdaOp(v, p)),
    eps: growthSummary(view, fys, "epsDiluted"),
    totalIncome: growthSummary(view, fys, "totalIncome"),
  };
  const ttm = computeTtm(view, quarters);
  const recon = reconcileQuarters(view, fys);
  const season = seasonality(view, fys);
  const volatility = earningsVolatility(view, quarters);
  const missingQs = missingQuarters(quarters);

  // Shares from paid-up capital ÷ face value: latest FY first, else the most recent period that has it.
  let derivedShares: number | null = latestFy ? view.get(latestFy, "sharesDerived")?.value ?? null : null;
  let derivedFrom = latestFy;
  if (derivedShares === null) {
    const all = [...fys, ...quarters].sort((x, y) => periodSortKey(y) - periodSortKey(x));
    for (const p of all) {
      const v = view.get(p, "sharesDerived")?.value;
      if (v != null) {
        derivedShares = v;
        derivedFrom = p;
        break;
      }
    }
  }
  const shares = {
    basic: project.sharesOutstanding ?? derivedShares,
    diluted: project.dilutedShares,
    source: project.sharesOutstanding ? project.sharesSource || "Entered by user" : derivedShares ? `Derived: paid-up capital ÷ face value (${derivedFrom}) — confirm on the Valuation page` : "Not available",
  };

  const roeHistory = fys.map((p) => annual.roe?.byPeriod[p]?.value).filter((x): x is number => x != null);
  const payoutHistory = fys.map((p) => annual.payoutRatio?.byPeriod[p]?.value).filter((x): x is number => x != null);
  const lastTtm = ttm.length ? ttm[ttm.length - 1] : null;
  const valuation = runValuation({
    view,
    fys,
    ttm: lastTtm ? { revenue: lastTtm.revenue, ebitda: lastTtm.ebitda, pat: lastTtm.pat, eps: lastTtm.eps, periodId: lastTtm.periodId } : null,
    sector,
    price: project.price,
    sharesBasic: shares.basic,
    sharesDiluted: shares.diluted,
    settings: vs,
    roeHistory,
    payoutHistory,
    epsCagr3: growth.eps.cagr3.value,
  });

  const docAudit = docs.flatMap((d) => d.auditFindings ?? []);
  const dqPre = dataQuality(view, basis, project.facts, fys, quarters, docs, recon, missingQs, project.sharesOutstanding ?? derivedShares, financial);
  const conflicts = dqPre.conflicts.map((c) => ({ label: c.label, periodId: c.periodId, values: c.values }));
  const flags = forensicFlags({ view, fys, annual, sector, auditFindings: docAudit, excerpts: project.excerpts, conflicts, beneishUseOtherExpensesAsSga: project.settings.beneishUseOtherExpensesAsSga, altmanUseOtherEquityAsRetainedEarnings: project.settings.altmanUseOtherEquityAsRetainedEarnings, marketCap: valuation.marketCap });
  const ben = beneish(view, fys, sector, project.settings.beneishUseOtherExpensesAsSga);
  const alt = altman(view, fys, sector, valuation.marketCap, project.settings.altmanUseOtherEquityAsRetainedEarnings);
  if (ben.computed && ben.value !== null && ben.value > -1.78) {
    flags.push({ id: "beneish", severity: "medium", category: "model", title: "Beneish M-Score above −1.78", observation: ben.interpretation, numbers: [{ label: "M-Score", value: ben.value, unit: "num", period: ben.period }], history: "", whyItMatters: "Statistical association with earnings manipulation in the original study.", alternatives: "High growth (SGI) and investment-heavy phases raise the score without any manipulation.", verify: "Examine DSRI/TATA drivers on the Earnings Quality page.", sources: [], kind: "potential-warning" });
  }
  for (const a of alt) if (a.computed && a.zone?.startsWith("Distress")) flags.push({ id: `altman-${a.name}`, severity: "high", category: "model", title: `${a.name}: distress zone`, observation: a.interpretation, numbers: [{ label: "Z", value: a.value, unit: "num", period: a.period }], history: "", whyItMatters: "Historically associated with elevated bankruptcy risk within two years (US data).", alternatives: "Asset-heavy or regulated businesses can sit in the distress zone without default risk.", verify: "Liquidity, debt maturities and covenants.", sources: [], kind: "potential-warning" });

  const latestFyNum = latestFy ? Number(latestFy.slice(2)) : null;
  const guidance = project.guidance.map((g) => ({ item: g, eval: evaluateGuidance(view, g, latestFyNum) }));
  const scores = computeScores({
    view,
    fys,
    annual,
    profile,
    weights: project.settings.scoreWeights,
    growth: { revenueCagr3: growth.revenue.cagr3.value, patCagr3: growth.pat.cagr3.value, revenueVol: growth.revenue.volatility, totalIncomeCagr3: growth.totalIncome.cagr3.value },
    flags,
    altmanZpp: alt[0] ?? null,
    valuation,
    costOfEquity: vs.costOfEquity,
    wacc: vs.wacc,
    strategy: project.strategy,
    guidance,
  });
  const segments = project.segments.filter((s) => s.basis === basis);
  const risks = buildRisks({ view, fys, annual, flags, excerpts: project.excerpts, segments, sector });
  const projections = {
    bear: runProjection(view, latestFy, vs.scenarios.bear, project.settings.projection, shares.basic),
    base: runProjection(view, latestFy, vs.scenarios.base, project.settings.projection, shares.basic),
    bull: runProjection(view, latestFy, vs.scenarios.bull, project.settings.projection, shares.basic),
  };
  const capitalAllocation = buildCapitalAllocation(view, fys, annual);
  const analysis: Analysis = {
    basis,
    view,
    fys,
    quarters,
    latestFy,
    annual,
    quarterly,
    growth,
    ttm,
    recon,
    season,
    volatility,
    missingQs,
    shares,
    valuation,
    flags,
    beneish: ben,
    altman: alt,
    dq: dqPre,
    guidance,
    scores,
    risks,
    projections,
    capitalAllocation,
    findings: [],
    segments,
    auditFindings: docAudit,
    financial,
    conclusion: [],
  };
  analysis.findings = buildFindings(analysis, project);
  analysis.conclusion = buildConclusion(analysis, project);
  return analysis;
}

function buildCapitalAllocation(view: FactView, fys: string[], annual: Record<string, MetricSeries>): CapitalAllocation {
  const g = (p: string, k: string) => view.get(p, k)?.value ?? null;
  const perYear = fys.map((fy) => ({ fy, cfo: g(fy, "cfo"), capex: g(fy, "capexTotal"), acquisitions: g(fy, "acquisitions"), dividends: g(fy, "dividendsPaid"), buyback: g(fy, "buyback"), netBorrowing: annual.netBorrowing?.byPeriod[fy]?.value ?? null, fcf: annual.fcf?.byPeriod[fy]?.value ?? null }));
  const sum = (k: keyof (typeof perYear)[number]) => {
    const vals = perYear.map((r) => r[k]).filter((x): x is number => typeof x === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const totPat = fys.map((p) => g(p, "patOwners")).filter((x): x is number => x !== null).reduce((a, b) => a + b, 0);
  const totDiv = sum("dividends");
  const payout = totPat > 0 && totDiv !== null ? (totDiv / totPat) * 100 : null;
  const observations: string[] = [];
  const capexT = sum("capex");
  const cfoT = sum("cfo");
  if (capexT !== null && cfoT !== null) observations.push(`Over ${fys.length} years, capex absorbed ${fmt((capexT / cfoT) * 100, 0)}% of operating cash flow.`);
  if (payout !== null) observations.push(`Cash dividends equalled ${fmt(payout, 0)}% of cumulative PAT attributable to owners (retention ${fmt(100 - payout, 0)}%).`);
  const nb = sum("netBorrowing");
  if (nb !== null) observations.push(nb > 0 ? `Net new borrowing of ₹${fmt(nb, 0)} cr over the period.` : `Net debt repayment of ₹${fmt(-nb, 0)} cr over the period.`);
  const roce = fys.map((p) => annual.roce?.byPeriod[p]?.value).filter((x): x is number => x != null);
  if (roce.length >= 2) observations.push(`ROCE moved from ${fmt(roce[0])}% to ${fmt(roce[roce.length - 1])}% while capital employed ${(() => { const a = annual.capitalEmployed?.byPeriod[fys[0]]?.value; const b = annual.capitalEmployed?.byPeriod[fys[fys.length - 1]]?.value; return a && b ? `changed by ${fmt(((b / a) - 1) * 100, 0)}%` : "changed"; })()}.`);
  // incremental return on retained earnings: ΔPAT / cumulative retained earnings
  let inc: CapitalAllocation["incrementalReturn"] = { value: null, note: "Needs at least three years of PAT and dividends." };
  if (fys.length >= 3) {
    const first = g(fys[0], "patOwners");
    const last = g(fys[fys.length - 1], "patOwners");
    const retained = fys.slice(0, -1).reduce((s, p) => {
      const pat = g(p, "patOwners");
      const div = g(p, "dividendsPaid");
      return pat !== null ? s + pat - (div ?? 0) : s;
    }, 0);
    if (first !== null && last !== null && retained > 0) inc = { value: ((last - first) / retained) * 100, note: "Increase in PAT between first and latest year ÷ earnings retained in the intervening years. Rough indicator; ignores external capital raised." };
  }
  return {
    years: fys,
    totals: [
      { label: "Cumulative operating cash flow", value: cfoT },
      { label: "Cumulative capex", value: capexT },
      { label: "Cumulative free cash flow", value: sum("fcf") },
      { label: "Cumulative acquisitions", value: sum("acquisitions"), note: "Only if separately presented in the cash flow statement." },
      { label: "Cumulative dividends paid", value: totDiv },
      { label: "Cumulative buy-backs", value: sum("buyback") },
      { label: "Cumulative net borrowing", value: nb },
    ],
    perYear,
    retentionRatio: payout !== null ? 100 - payout : null,
    payoutRatio: payout,
    incrementalReturn: inc,
    observations,
  };
}

function lv(a: Analysis, k: string): MetricResult | undefined {
  return a.latestFy ? a.annual[k]?.byPeriod[a.latestFy] : undefined;
}

function buildFindings(a: Analysis, p: Project): Finding[] {
  const f: Finding[] = [];
  const L = a.latestFy;
  if (!L) {
    f.push({ kind: "question", title: "No annual financial data yet", detail: "Upload annual reports (or switch basis) to generate findings.", evidence: [] });
    return f;
  }
  const v = (k: string) => lv(a, k)?.value ?? null;
  const rc = a.growth.revenue.cagr3;
  if (rc.value !== null && rc.value >= 10) f.push({ kind: "positive", title: "Strong multi-year revenue growth", detail: `Revenue compounded at ${fmt(rc.value)}% a year from ${rc.from} to ${L}.`, evidence: [{ label: "3-yr revenue CAGR", value: `${fmt(rc.value)}%` }], link: "revenue" });
  const roce = v("roce");
  if (roce !== null && roce >= 15) f.push({ kind: "positive", title: "Attractive return on capital", detail: `ROCE of ${fmt(roce)}% in ${L}.`, evidence: [{ label: "ROCE", value: `${fmt(roce)}%`, period: L }], link: "returns" });
  const nd = v("netDebt");
  if (nd !== null && nd <= 0 && !a.financial) f.push({ kind: "positive", title: "Net cash balance sheet", detail: `Cash-like balances exceed borrowings by ₹${fmt(-nd, 0)} cr.`, evidence: [{ label: "Net debt", value: `₹${fmt(nd, 0)} cr`, period: L }], link: "balance-sheet" });
  let sc = 0, sp = 0;
  for (const y of a.fys) {
    const c = a.view.get(y, "cfo")?.value;
    const pt = a.view.get(y, "pat")?.value;
    if (c != null && pt != null) { sc += c; sp += pt; }
  }
  if (!a.financial && sp > 0 && sc / sp >= 1) f.push({ kind: "positive", title: "Profits backed by cash", detail: `Cumulative OCF is ${fmt(sc / sp, 2)}x cumulative PAT over the available years.`, evidence: [{ label: "Σ OCF", value: `₹${fmt(sc, 0)} cr` }, { label: "Σ PAT", value: `₹${fmt(sp, 0)} cr` }], link: "cash-flow" });
  const ic = v("interestCoverage");
  if (ic !== null && ic >= 5) f.push({ kind: "positive", title: "Comfortable interest coverage", detail: `PBIT covers finance costs ${fmt(ic)}x.`, evidence: [{ label: "Interest coverage", value: `${fmt(ic)}x`, period: L }], link: "balance-sheet" });
  const em = a.annual.ebitdaMargin?.byPeriod;
  if (em && a.fys.length >= 3) {
    const first = em[a.fys[a.fys.length - 3]]?.value;
    const last = em[L]?.value;
    if (first != null && last != null) {
      const d = last - first;
      if (Math.abs(d) >= 1) f.push({ kind: d > 0 ? "trend" : "concern", title: d > 0 ? "EBITDA margin expanding" : "EBITDA margin compressing", detail: `EBITDA margin moved from ${fmt(first)}% (${a.fys[a.fys.length - 3]}) to ${fmt(last)}% (${L}).`, evidence: [{ label: "Change", value: `${d > 0 ? "+" : ""}${fmt(d)} pp` }], link: "profitability" });
    }
  }
  const yoy = a.growth.revenue.yoy;
  if (yoy.length >= 2) {
    const accel = yoy[yoy.length - 1] - yoy[yoy.length - 2];
    if (Math.abs(accel) >= 3) f.push({ kind: "trend", title: accel > 0 ? "Revenue growth accelerating" : "Revenue growth decelerating", detail: `YoY growth went from ${fmt(yoy[yoy.length - 2])}% to ${fmt(yoy[yoy.length - 1])}%.`, evidence: [{ label: "Change in growth", value: `${accel > 0 ? "+" : ""}${fmt(accel)} pp` }], link: "revenue" });
  }
  const lq = a.quarters[a.quarters.length - 1];
  if (lq) {
    const g = a.quarterly.revenueYoY?.byPeriod[lq]?.value;
    const pg = a.quarterly.patYoY?.byPeriod[lq]?.value;
    if (g != null) f.push({ kind: "trend", title: `Latest quarter (${lq}) revenue ${g >= 0 ? "up" : "down"} ${fmt(Math.abs(g))}% YoY`, detail: pg != null ? `PAT ${pg >= 0 ? "up" : "down"} ${fmt(Math.abs(pg))}% YoY.` : "PAT YoY not available.", evidence: [{ label: "Revenue YoY", value: `${fmt(g)}%`, period: lq }], link: "quarterly" });
  }
  const dso = a.annual.receivableDays?.byPeriod;
  if (dso && a.fys.length >= 2) {
    const prev = dso[a.fys[a.fys.length - 2]]?.value;
    const cur = dso[L]?.value;
    if (prev != null && cur != null && Math.abs(cur - prev) >= 5) f.push({ kind: cur > prev ? "concern" : "positive", title: cur > prev ? "Customers paying more slowly" : "Collections improving", detail: `Receivable days ${fmt(prev, 0)} → ${fmt(cur, 0)}.`, evidence: [{ label: "Receivable days", value: `${fmt(cur, 0)}`, period: L }], link: "working-capital" });
  }
  for (const fl of a.flags.filter((x) => x.severity === "critical" || x.severity === "high" || (x.severity === "medium" && x.kind === "potential-warning")).slice(0, 6)) {
    f.push({ kind: "concern", title: fl.title, detail: fl.observation, evidence: fl.numbers.slice(0, 3).map((n) => ({ label: n.label, value: n.value === null ? "n/a" : n.unit === "pct" ? `${fmt(n.value)}%` : n.unit === "x" ? `${fmt(n.value, 2)}x` : n.unit === "days" ? `${fmt(n.value, 0)} d` : `₹${fmt(n.value, 0)} cr`, period: n.period })), link: "forensics", sources: fl.sources });
  }
  for (const i of a.dq.issues.filter((x) => x.level === "error").slice(0, 3)) f.push({ kind: "concern", title: `Data issue: ${i.title}`, detail: i.detail, evidence: [], link: "data-quality" });
  // Management priorities: confirmed strategy items or top outlook excerpts
  const pri = p.strategy.filter((s) => s.confirmed).slice(0, 4);
  const pri2 = pri.length ? [] : p.excerpts.filter((e) => e.category === "strategy" || e.category === "outlook" || e.category === "guidance").sort((x, y) => y.score - x.score).slice(0, 4);
  for (const s of pri) f.push({ kind: "priority", title: s.category, detail: s.statement, evidence: [], link: "management", sources: s.docName ? [{ docName: s.docName, page: s.page }] : [] });
  for (const e of pri2) f.push({ kind: "priority", title: `Management statement (${e.category})`, detail: e.text, evidence: [], link: "management", sources: [{ docName: e.docName, page: e.page }] });
  // Questions
  const qs = new Set<string>();
  for (const fl of a.flags.slice(0, 6)) if (fl.verify) qs.add(fl.verify);
  if (!p.price) qs.add("What is the current share price? (needed for all valuation outputs)");
  if (!a.shares.basic) qs.add("How many shares are outstanding? (enter on the Valuation page)");
  if (!a.segments.length) qs.add("How do individual business segments perform? (segment data not extracted)");
  if (!p.excerpts.some((e) => e.category === "outlook" || e.category === "guidance")) qs.add("What has management guided for the next 2–3 years? (no outlook passages extracted)");
  if (a.missingQs.length) qs.add(`Can the missing quarters (${a.missingQs.slice(0, 4).join(", ")}${a.missingQs.length > 4 ? "…" : ""}) be uploaded?`);
  [...qs].slice(0, 8).forEach((q) => f.push({ kind: "question", title: q, detail: "", evidence: [] }));
  return f;
}

function buildConclusion(a: Analysis, p: Project): string[] {
  const out: string[] = [];
  const h = a.scores.financialHealth;
  if (h.score === null) out.push("Financial health cannot be scored yet — key statements are missing for the selected basis.");
  else {
    const band = h.score >= 70 ? "strong" : h.score >= 50 ? "moderate" : h.score >= 35 ? "weak" : "poor";
    const comps = (h.components ?? []).filter((c) => c.score !== null).sort((x, y) => (y.score as number) - (x.score as number));
    out.push(`On the calculated evidence, financial health looks ${band} (score ${h.score.toFixed(0)}/100, ${h.confidence} confidence). Strongest area: ${comps[0]?.label ?? "n/a"}; weakest: ${comps[comps.length - 1]?.label ?? "n/a"}.`);
  }
  const serious = a.flags.filter((f) => f.severity === "critical" || f.severity === "high");
  out.push(serious.length ? `${serious.length} high-severity warning sign(s) need investigation: ${serious.slice(0, 3).map((s) => s.title.toLowerCase()).join("; ")}.` : "No high-severity forensic warning signs were triggered by the available data.");
  const val = a.valuation;
  if (!p.price) out.push("Valuation conclusion pending: enter the current share price.");
  else if (val.weighted === null) out.push(`At ₹${p.price}, no valuation method currently has enough inputs and weight to form a conclusion.`);
  else out.push(`At the entered price of ₹${p.price}, the weighted fair-value estimate is ₹${val.weighted.toFixed(0)} per share (${val.verdict.toLowerCase()}; margin of safety ${val.marginOfSafety?.toFixed(0) ?? "n/a"}%). This depends heavily on your assumptions — see the sensitivity table.`);
  out.push(`Data quality score ${a.dq.score}/100 — ${a.dq.issues.filter((i) => i.level === "error").length} error(s) and ${a.dq.issues.filter((i) => i.level === "warning").length} warning(s) to review.`);
  out.push("This is an analytical summary of the uploaded documents, not investment advice.");
  return out;
}

export { itemLabel };
