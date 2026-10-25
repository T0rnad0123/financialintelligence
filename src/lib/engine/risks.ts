// Risk register and early-warning system. Severity is derived from
// calculated metrics or disclosures; likelihood is qualitative and only
// stated when evidence supports it. No invented probabilities or losses.
import type { Excerpt, SegmentFact, SectorKey } from "../types";
import type { FactView } from "./core";
import type { MetricSeries } from "./metrics";
import type { RedFlag, Severity } from "./forensics";

export type Likelihood = "Elevated" | "Moderate" | "Low" | "Not assessable";

export interface RiskItem {
  id: string;
  name: string;
  category: "Financial" | "Operational" | "Regulatory & legal" | "Market" | "Governance";
  severity: Severity | "none";
  likelihood: Likelihood;
  impact: string;
  evidence: string;
  history: string;
  mitigation: string;
  uncertainty: string;
  sources: { docName: string; page?: number; text?: string }[];
}

const CYCLICAL: SectorKey[] = ["metals", "auto", "energy", "infrastructure", "manufacturing"];

function textHits(excerpts: Excerpt[], re: RegExp, n = 3) {
  return excerpts.filter((e) => re.test(e.text)).slice(0, n);
}

function mitigationFor(excerpts: Excerpt[], re: RegExp) {
  const hit = excerpts.find((e) => re.test(e.text) && /mitigat|hedg|insur|diversif|long[- ]term contract|pass[- ]through|escalation clause/i.test(e.text));
  return hit ? `Company states: “${hit.text.slice(0, 220)}${hit.text.length > 220 ? "…" : ""}” (${hit.docName}, p.${hit.page})` : "No specific mitigation disclosure found in the extracted text.";
}

export function buildRisks(p: { view: FactView; fys: string[]; annual: Record<string, MetricSeries>; flags: RedFlag[]; excerpts: Excerpt[]; segments: SegmentFact[]; sector: SectorKey }): RiskItem[] {
  const { view, fys, annual, flags, excerpts, segments, sector } = p;
  const L = fys[fys.length - 1];
  const m = (k: string, pid = L) => (pid ? annual[k]?.byPeriod[pid]?.value ?? null : null);
  const hist = (k: string, unit = "") => fys.map((x) => `${x}: ${m(k, x) === null ? "n/a" : (m(k, x) as number).toFixed(unit === "cr" ? 0 : 1)}${unit === "cr" ? "" : unit}`).join(" · ");
  const risks: RiskItem[] = [];
  const flagSev = (id: string) => flags.find((f) => f.id === id)?.severity;
  const trendUp = (k: string) => {
    const vals = fys.slice(-3).map((x) => m(k, x)).filter((x): x is number => x !== null);
    return vals.length >= 2 ? vals[vals.length - 1] > vals[0] : null;
  };

  // Margin deterioration
  {
    const em = m("ebitdaMargin");
    const em2 = fys.length >= 3 ? m("ebitdaMargin", fys[fys.length - 3]) : null;
    const d = em !== null && em2 !== null ? em - em2 : null;
    risks.push({
      id: "margin",
      name: "Margin deterioration",
      category: "Financial",
      severity: d === null ? "none" : d < -4 ? "high" : d < -2 ? "medium" : d < 0 ? "low" : "none",
      likelihood: d === null ? "Not assessable" : d < -2 ? "Elevated" : d < 0 ? "Moderate" : "Low",
      impact: em !== null ? `Each 1 pp of EBITDA margin ≈ ₹${(((view.get(L!, "revenue")?.value ?? 0) * 0.01)).toFixed(0)} cr of annual EBITDA at current revenue.` : "Not estimable.",
      evidence: d === null ? "Insufficient margin history." : `EBITDA margin ${em!.toFixed(1)}% vs ${em2!.toFixed(1)}% two years earlier (${d >= 0 ? "+" : ""}${d.toFixed(1)} pp).`,
      history: hist("ebitdaMargin", "%"),
      mitigation: mitigationFor(excerpts, /margin|cost|price/i),
      uncertainty: "Margins depend on input costs and pricing power that historical statements alone cannot predict.",
      sources: [],
    });
  }
  // Leverage
  {
    const nde = m("netDebtToEbitda");
    const de = m("debtToEquity");
    const sev = flagSev("high-leverage") ?? flagSev("rising-leverage") ?? (nde !== null && nde > 2.5 ? "low" : "none");
    risks.push({ id: "leverage", name: "Leverage", category: "Financial", severity: sev, likelihood: nde === null ? "Not assessable" : nde > 3.5 ? "Elevated" : nde > 2 ? "Moderate" : "Low", impact: m("totalDebt") !== null ? `Gross debt ₹${(m("totalDebt") as number).toFixed(0)} cr; a 1 pp rise in borrowing cost ≈ ₹${((m("totalDebt") as number) * 0.01).toFixed(0)} cr extra interest a year.` : "Not estimable.", evidence: `Net debt/EBITDA ${nde?.toFixed(2) ?? "n/a"}x; debt/equity ${de?.toFixed(2) ?? "n/a"}x.`, history: hist("netDebtToEbitda", "x"), mitigation: mitigationFor(excerpts, /debt|borrow|refinanc|rating/i), uncertainty: "Maturity profile, covenants and interest-rate mix are usually in notes not captured numerically.", sources: textHits(excerpts.filter((e) => e.category === "debt"), /./, 2).map((e) => ({ docName: e.docName, page: e.page, text: e.text })) });
  }
  // Liquidity & refinancing
  {
    const cr = m("currentRatio");
    const st = m("shortTermDebtShare");
    const sev = flagSev("weak-liquidity") ?? (st !== null && st > 50 && cr !== null && cr < 1.2 ? "medium" : "none");
    risks.push({ id: "liquidity", name: "Liquidity & refinancing", category: "Financial", severity: sev, likelihood: cr === null ? "Not assessable" : cr < 1 ? "Elevated" : cr < 1.3 ? "Moderate" : "Low", impact: "Not estimable from statements alone.", evidence: `Current ratio ${cr?.toFixed(2) ?? "n/a"}x; short-term share of borrowings ${st?.toFixed(0) ?? "n/a"}%; cash ratio ${m("cashRatio")?.toFixed(2) ?? "n/a"}x.`, history: hist("currentRatio", "x"), mitigation: mitigationFor(excerpts, /liquidit|credit line|undrawn|working capital facilit/i), uncertainty: "Undrawn facilities and maturity ladders are not captured.", sources: [] });
  }
  // Cash flow weakness
  {
    const fcfNeg = fys.slice(-3).filter((x) => (m("fcf", x) ?? 1) < 0).length;
    risks.push({ id: "cashflow", name: "Cash-flow weakness", category: "Financial", severity: flagSev("negative-fcf") ?? flagSev("cum-cash-conversion") ?? "none", likelihood: fcfNeg >= 2 ? "Elevated" : fcfNeg === 1 ? "Moderate" : fys.length ? "Low" : "Not assessable", impact: m("fcf") !== null ? `Latest FCF ₹${(m("fcf") as number).toFixed(0)} cr.` : "Not estimable.", evidence: `Negative FCF in ${fcfNeg} of the last ${Math.min(3, fys.length)} years.`, history: hist("fcf", "cr"), mitigation: "Check whether negative FCF reflects growth capex with disclosed commissioning timelines.", uncertainty: "Split between maintenance and growth capex is rarely disclosed.", sources: [] });
  }
  // Receivables
  {
    const up = trendUp("receivableDays");
    risks.push({ id: "receivables", name: "Receivables / collection", category: "Operational", severity: flagSev("receivables-vs-revenue") ?? (up ? "low" : "none"), likelihood: up === null ? "Not assessable" : up ? "Moderate" : "Low", impact: m("receivableDays") !== null && view.get(L!, "revenue")?.value ? `10 extra days of receivables ≈ ₹${(((view.get(L!, "revenue")!.value as number) * 10) / 365).toFixed(0)} cr of cash tied up.` : "Not estimable.", evidence: `Receivable days ${m("receivableDays")?.toFixed(0) ?? "n/a"}.`, history: hist("receivableDays", "d"), mitigation: mitigationFor(excerpts, /receivable|collection|credit (risk|period)/i), uncertainty: "Ageing and customer quality not captured numerically.", sources: [] });
  }
  // Inventory
  {
    const up = trendUp("inventoryDays");
    risks.push({ id: "inventory", name: "Inventory build-up", category: "Operational", severity: flagSev("inventory-vs-revenue") ?? (up ? "low" : "none"), likelihood: up === null ? "Not assessable" : up ? "Moderate" : "Low", impact: "Write-down risk and cash absorption.", evidence: `Inventory days ${m("inventoryDays")?.toFixed(0) ?? "n/a"}.`, history: hist("inventoryDays", "d"), mitigation: mitigationFor(excerpts, /inventor/i), uncertainty: "Composition (raw material vs finished goods) not captured.", sources: [] });
  }
  // Contingent liabilities, related parties, auditor
  const cont = flags.find((f) => f.id.startsWith("contingent"));
  risks.push({ id: "contingent", name: "Contingent liabilities & litigation", category: "Regulatory & legal", severity: cont ? cont.severity : "none", likelihood: "Not assessable", impact: cont?.observation ?? "Not quantified.", evidence: cont ? cont.observation : "No contingent-liability disclosure captured.", history: "", mitigation: "Review management's assessment of each claim in the notes.", uncertainty: "Outcomes of legal/tax disputes cannot be predicted from financial statements.", sources: cont?.sources ?? [] });
  const rpt = flags.find((f) => f.id === "rpt-review");
  risks.push({ id: "rpt", name: "Related-party transactions", category: "Governance", severity: rpt ? "informational" : "none", likelihood: "Not assessable", impact: "Depends on materiality — not computed.", evidence: rpt?.observation ?? "No related-party passages captured.", history: "", mitigation: "Audit committee approval and arm's-length disclosures.", uncertainty: "Amounts are in notes and usually not extracted.", sources: rpt?.sources ?? [] });
  const aud = flags.filter((f) => f.category === "audit" && f.severity !== "informational");
  risks.push({ id: "auditor", name: "Auditor concerns", category: "Governance", severity: aud.length ? aud[0].severity : "none", likelihood: aud.length ? "Elevated" : "Low", impact: "Reduces reliance on reported figures.", evidence: aud.length ? aud.map((a) => a.title).join("; ") : "No qualification, adverse opinion, going-concern or control-weakness wording detected.", history: "", mitigation: "Read management's response in the Board's report.", uncertainty: "Detection is keyword-based; read the auditor's report in full.", sources: aud.flatMap((a) => a.sources) });

  // Segment / revenue concentration
  if (L) {
    const segRev = segments.filter((s) => s.periodId === L && s.metric === "revenue" && s.dp.value !== null && (s.dp.value as number) > 0);
    const total = segRev.reduce((s, x) => s + (x.dp.value as number), 0);
    const top = segRev.sort((a, b) => (b.dp.value as number) - (a.dp.value as number))[0];
    const share = top && total > 0 ? ((top.dp.value as number) / total) * 100 : null;
    risks.push({ id: "concentration", name: "Revenue (segment) concentration", category: "Market", severity: share === null ? "none" : share > 85 ? "medium" : share > 70 ? "low" : "none", likelihood: share === null ? "Not assessable" : share > 70 ? "Moderate" : "Low", impact: share !== null ? `Largest segment (${top!.segment}) = ${share.toFixed(0)}% of segment revenue.` : "Segment data not available for the latest year.", evidence: share !== null ? `${segRev.length} segments reported.` : "No segment table extracted.", history: "", mitigation: "Diversification plans in MD&A.", uncertainty: "Customer-level concentration is rarely quantified.", sources: [] });
  }
  // Text-based risks
  const textRisk = (id: string, name: string, category: RiskItem["category"], re: RegExp, impact: string) => {
    const hits = textHits(excerpts, re, 3);
    risks.push({ id, name, category, severity: hits.length ? "informational" : "none", likelihood: "Not assessable", impact, evidence: hits.length ? `${hits.length} disclosure passage(s) found.` : "No specific disclosure found in extracted text.", history: "", mitigation: mitigationFor(excerpts, re), uncertainty: "Qualitative disclosure — magnitude not quantified in statements.", sources: hits.map((e) => ({ docName: e.docName, page: e.page, text: e.text })) });
  };
  textRisk("customer", "Customer concentration", "Market", /single (largest )?customer|top (five|ten|\d+) customers|customer concentration|largest customer/i, "Loss of a key customer could materially reduce revenue.");
  textRisk("supplier", "Supplier concentration", "Operational", /single supplier|supplier concentration|limited (number of )?suppliers|sole supplier/i, "Supply disruption risk.");
  textRisk("regulatory", "Regulatory risk", "Regulatory & legal", /regulat|tariff|policy change|licen[cs]e|cerc|serc|sebi|rbi|usfda|warning letter/i, "Regulatory changes can alter pricing, costs or permissions.");
  textRisk("commodity", "Commodity exposure", "Market", /commodit|raw material (price|cost)|coking coal|iron ore|crude|steel prices|metal prices/i, "Input-cost swings flow directly into margins.");
  textRisk("fx", "Foreign-exchange exposure", "Market", /foreign (exchange|currency)|forex|exchange rate|hedg/i, "Currency moves affect import costs, export realisations and foreign debt.");
  textRisk("interest", "Interest-rate exposure", "Financial", /interest rate (risk|movement|fluctuation)|floating rate/i, "Higher rates raise finance costs on floating-rate debt.");
  textRisk("environment", "Environmental & ESG", "Regulatory & legal", /environment(al)? (norm|clearance|regulation)|emission|pollution|carbon|esg/i, "Compliance capex, carbon costs or operating restrictions.");
  // Capex / execution
  {
    const cd = m("capexToDepreciation");
    const strat = excerpts.filter((e) => e.category === "capex" || e.category === "expansion");
    risks.push({ id: "capex", name: "Capital-expenditure & execution risk", category: "Operational", severity: cd !== null && cd > 2 ? "medium" : strat.length ? "low" : "none", likelihood: cd !== null && cd > 2 ? "Moderate" : "Not assessable", impact: m("capex") !== null ? `Latest capex ₹${(m("capex") as number).toFixed(0)} cr (${cd?.toFixed(1) ?? "n/a"}x depreciation).` : "Not estimable.", evidence: `${strat.length} capex/expansion statement(s) in reports.`, history: hist("capexToDepreciation", "x"), mitigation: "Track commissioning milestones on the Management page.", uncertainty: "Project returns depend on timelines and demand not visible in historical statements.", sources: strat.slice(0, 2).map((e) => ({ docName: e.docName, page: e.page, text: e.text })) });
  }
  risks.push({ id: "cyclicality", name: "Sector cyclicality", category: "Market", severity: CYCLICAL.includes(sector) ? "low" : "none", likelihood: CYCLICAL.includes(sector) ? "Moderate" : "Low", impact: "Earnings can swing sharply through the cycle.", evidence: `Sector profile: ${sector}. ${p.annual.revenueGrowth ? `Revenue growth history: ${hist("revenueGrowth", "%")}.` : ""}`, history: "", mitigation: "Evaluate valuation on mid-cycle (normalised) earnings.", uncertainty: "Cycle position cannot be determined from company documents alone.", sources: [] });
  const order: (Severity | "none")[] = ["critical", "high", "medium", "low", "informational", "none"];
  return risks.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
