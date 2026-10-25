"use client";
// Builds a structured research report from the SAME analysis object the
// dashboard renders, then exports it to HTML (print), PDF and Excel.
import type { Analysis } from "../engine/analyze";
import type { DocMeta, Project } from "../types";
import { fmtNum } from "../engine/core";
import { ANNUAL_METRICS_BY_KEY } from "../engine/metrics";
import { SECTOR_PROFILES } from "../sector/profiles";
import { LINE_ITEMS } from "../lineItems";
import { UNIT_LABEL } from "../extraction/parseUtils";

export interface ReportTable {
  title: string;
  head: string[];
  rows: string[][];
}
export interface ReportSection {
  n: number;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  tables: ReportTable[];
}

const mtable = (a: Analysis, title: string, keys: string[]): ReportTable => ({
  title,
  head: ["Metric", ...a.fys],
  rows: keys.filter((k) => a.annual[k]).map((k) => [a.annual[k].def.name, ...a.fys.map((p) => { const r = a.annual[k].byPeriod[p]; return r?.status === "ok" ? fmtNum(r.value, r.unit) : r?.status === "not-applicable" ? "N/A" : "Insufficient data"; })]),
});

export function buildReport(p: Project, a: Analysis, docs: DocMeta[]): ReportSection[] {
  const L = a.latestFy;
  const v = a.valuation;
  const s: ReportSection[] = [];
  let n = 0;
  const add = (title: string, paragraphs: string[], tables: ReportTable[] = [], bullets?: string[]) => s.push({ n: ++n, title, paragraphs, tables, bullets });
  const ai = (task: string) => p.aiOutputs.find((o) => o.task === task);

  add("Company overview", [
    `${p.name}${p.nseSymbol ? ` (NSE: ${p.nseSymbol})` : ""}${p.bseCode ? ` (BSE: ${p.bseCode})` : ""}. Sector profile: ${SECTOR_PROFILES[p.sector].label}. Reporting basis analysed: ${a.basis}. Currency INR; figures in ₹ crore unless stated.`,
    `User-entered share price: ${p.price ? `₹${p.price}` : "not entered"}${p.priceDate ? ` (as of ${p.priceDate})` : ""}. No historical or live market prices are used.`,
    p.notes ? `Analyst notes: ${p.notes}` : "",
  ].filter(Boolean));
  add("Documents analysed", [`${docs.length} document(s) uploaded.`], [{ title: "Documents", head: ["File", "Type", "Status", "Pages", "Periods detected", "Units", "Figures"], rows: docs.map((d) => [d.fileName, d.kind, d.status, String(d.pageCount ?? "—"), (d.detectedPeriods ?? []).join(", "), (d.detectedUnits ?? []).map((u) => UNIT_LABEL[u]).join(", "), String(d.factCount ?? 0)]) }]);
  add("Data-quality assessment", [`Data-quality score ${a.dq.score}/100.`, ...a.dq.scoreExplanation], [{ title: "Issues", head: ["Level", "Category", "Issue", "Detail"], rows: a.dq.issues.slice(0, 40).map((i) => [i.level, i.category, i.title, i.detail]) }]);
  add("Executive summary", [...a.conclusion, ...(ai("summary") ? [`AI-generated summary (${ai("summary")!.model}, ${new Date(ai("summary")!.createdAt).toLocaleDateString("en-IN")}):`, ai("summary")!.content] : [])], [{ title: "Scores", head: ["Score", "Value", "Confidence", "Note"], rows: Object.values(a.scores).map((x) => [x.label, x.score === null ? "Insufficient data" : x.score.toFixed(0), x.confidence, x.higherIsBetter ? "" : "Higher = more risk"]) }]);
  add("Revenue analysis", [`3-year revenue CAGR: ${fmtNum(a.growth.revenue.cagr3.value, "pct")}${a.growth.revenue.cagr3.value === null ? ` (${a.growth.revenue.cagr3.reason})` : ""}; 4-year: ${fmtNum(a.growth.revenue.cagr4.value, "pct")}; growth volatility: ${fmtNum(a.growth.revenue.volatility, "pct")}.`], [mtable(a, "Growth", ["revenue", "revenueGrowth", "ebitdaGrowth", "patGrowth", "epsGrowth"])]);
  add("Profitability analysis", ["EBITDA is calculated (revenue − operating expenses excl. finance costs and D&A); it excludes other income and exceptional items. Adjusted PAT removes disclosed exceptional items only."], [mtable(a, "Profitability", ["grossMargin", "ebitda", "ebitdaMargin", "ebitMargin", "pbtMargin", "pat", "patMargin", "adjustedPat", "effectiveTaxRate", "otherIncomeToPbt", "interestCoverage"])]);
  add("Balance-sheet analysis", [], [mtable(a, "Balance sheet", ["totalDebt", "netDebt", "debtToEquity", "netDebtToEbitda", "currentRatio", "quickRatio", "tangibleNetWorth", "goodwillToAssets", "capitalEmployed"])]);
  add("Cash-flow analysis", ["FCF = operating cash flow − gross capex. Capex and dividends are positive outflow amounts."], [mtable(a, "Cash flow", ["cfo", "capex", "fcf", "ocfToPat", "fcfToPat", "ocfToEbitda", "capexToDepreciation", "dividendsToFcf", "netBorrowing"])]);
  add("Working-capital analysis", ["Days use average balances; inventory and payable days on COGS."], [mtable(a, "Working capital", ["receivableDays", "inventoryDays", "payableDays", "ccc", "nwcToRevenue", "changeInOperatingWc"])]);
  add("Capital efficiency", [`WACC assumption: ${p.settings.valuation.wacc}%; cost of equity: ${p.settings.valuation.costOfEquity}%.`], [mtable(a, "Returns", ["roe", "roce", "roic", "roa", "eva", "assetTurnover", "dupontNpm", "dupontAt", "dupontEm"])]);
  add("Earnings quality", [a.beneish.interpretation, ...a.altman.map((x) => `${x.name}: ${x.interpretation}`)], [{ title: "Forensic flags", head: ["Severity", "Type", "Flag", "Observation", "Verify"], rows: a.flags.map((f) => [f.severity, f.kind === "confirmed-disclosure" ? "Disclosure" : "Potential warning", f.title, f.observation, f.verify]) }]);
  const segNames = [...new Set(a.segments.map((x) => x.segment))];
  const segPeriods = [...new Set(a.segments.filter((x) => x.periodId.startsWith("FY")).map((x) => x.periodId))].sort();
  add("Segment analysis", segNames.length ? [] : ["No segment data extracted."], segNames.length ? [{ title: "Segment revenue (₹ cr)", head: ["Segment", ...segPeriods], rows: segNames.map((nm) => [nm, ...segPeriods.map((pp) => fmtNum(a.segments.find((x) => x.segment === nm && x.periodId === pp && x.metric === "revenue")?.dp.value ?? null))]) }] : []);
  const qs = a.quarters.slice(-16);
  add("Quarterly performance", [a.season.note, a.missingQs.length ? `Missing quarters: ${a.missingQs.join(", ")}.` : "No missing quarters in the 16-quarter window."], qs.length ? [{ title: "Quarterly figures (₹ cr)", head: ["Quarter", "Revenue", "EBITDA margin", "PAT", "Revenue YoY"], rows: qs.map((q) => [q, fmtNum(a.quarterly.revenue?.byPeriod[q]?.value ?? null), fmtNum(a.quarterly.ebitdaMargin?.byPeriod[q]?.value ?? null, "pct"), fmtNum(a.quarterly.pat?.byPeriod[q]?.value ?? null), fmtNum(a.quarterly.revenueYoY?.byPeriod[q]?.value ?? null, "pct")]) }] : []);
  add("Management outlook", p.excerpts.filter((e) => e.category === "outlook" || e.category === "guidance").slice(0, 8).map((e) => `“${e.text}” (${e.docName}, p.${e.page})`).concat(ai("management") ? [`AI assessment: ${ai("management")!.content}`] : []));
  add("Strategy execution assessment", [], [{ title: "Strategy tracker", head: ["Statement", "Source", "Status", "Evidence"], rows: p.strategy.filter((x) => x.confirmed).map((x) => [x.statement.slice(0, 200), x.docName ? `${x.docName} p.${x.page}` : "User", x.status, x.evidence || "—"]) }, { title: "Guidance vs actual", head: ["Metric", "Target FY", "Target", "Actual", "Status"], rows: a.guidance.map((g) => [g.item.metric, `FY${g.item.targetFy}`, `${g.item.direction === "at-least" ? "≥" : "≤"} ${g.item.target}`, g.eval.actual === null ? "—" : g.eval.actual.toFixed(1), g.eval.status]) }]);
  add("Capital allocation", a.capitalAllocation.observations, [{ title: "Cumulative", head: ["Item", "₹ crore"], rows: a.capitalAllocation.totals.map((t) => [t.label, fmtNum(t.value)]) }]);
  add("Risk analysis", [], [{ title: "Risk register", head: ["Risk", "Severity", "Likelihood", "Evidence"], rows: a.risks.filter((r) => r.severity !== "none").map((r) => [r.name, r.severity, r.likelihood, r.evidence]) }]);
  add("Valuation methodology", [v.dcfNote, "Market capitalisation = entered price × shares outstanding. EV = equity value + borrowings + lease liabilities (if enabled) + non-controlling interest + other debt-like claims − cash-like balances − non-operating assets.", ...v.bridgeNotes]);
  const scn = p.settings.valuation.scenarios;
  add("Valuation assumptions", [`WACC ${p.settings.valuation.wacc}%, terminal growth ${p.settings.valuation.terminalGrowth}%, forecast ${p.settings.valuation.forecastYears} years, ${p.settings.valuation.midYear ? "mid-year" : "end-year"} discounting. Shares: ${a.shares.basic?.toLocaleString("en-IN") ?? "n/a"} (${a.shares.source}).`], [{ title: "Scenario assumptions (%)", head: ["Scenario", "Growth Y1", "Growth final", "EBIT margin Y1", "EBIT margin final", "Tax", "D&A", "Capex", "WC % Δrev"], rows: (["bear", "base", "bull"] as const).map((k) => [k, ...[scn[k].revenueGrowthStart, scn[k].revenueGrowthEnd, scn[k].ebitMarginStart, scn[k].ebitMarginEnd, scn[k].taxRate, scn[k].daPctRevenue, scn[k].capexPctRevenue, scn[k].nwcPctIncrementalRevenue].map((x) => x.toFixed(1))]) }]);
  add("DCF and sensitivity analysis", [v.reverse ? `Reverse DCF: implied constant revenue growth ${v.reverse.impliedGrowth?.toFixed(1) ?? "n/a"}%, implied EBIT margin ${v.reverse.impliedMargin?.toFixed(1) ?? "n/a"}%.` : "Reverse DCF not available."], [
    { title: `DCF (${p.settings.valuation.activeScenario})`, head: ["Year", "Revenue", "EBIT", "NOPAT", "FCFF", "PV"], rows: v.dcf[p.settings.valuation.activeScenario].result.rows.map((r) => [`Y${r.year}`, r.revenue.toFixed(0), r.ebit.toFixed(0), r.nopat.toFixed(0), r.fcff.toFixed(0), r.pv.toFixed(0)]) },
    ...(v.sensitivity ? [{ title: "Fair value per share: WACC (rows) × terminal growth (columns)", head: ["WACC", ...v.sensitivityAxes.gs.map((g) => `${g}%`)], rows: v.sensitivity.map((row, i) => [`${v.sensitivityAxes.waccs[i]}%`, ...row.map((c) => (c.value === null ? "n/a" : `₹${c.value.toFixed(0)}`))]) }] : []),
  ]);
  add("Other applicable valuation methods", [], [{ title: "Relative valuation", head: ["Multiple", "Value", "Status / note"], rows: v.multiples.map((m) => [m.name, m.status === "ok" ? fmtNum(m.value, m.unit, 2) : "—", m.status === "ok" ? m.note : `${m.status}: ${m.note}`]) }, { title: "Per-share values", head: ["Method", "Value/share", "Weight", "Note"], rows: v.methods.map((m) => [m.label, m.value === null ? "—" : `₹${m.value.toFixed(0)}`, String(p.settings.valuation.methodWeights[m.key] ?? 0), m.applicable ? m.reason ?? "" : "Not applicable"]) }]);
  add("Bear, base and bull scenarios", [], [{ title: "DCF value per share", head: ["Scenario", "Value/share", "vs price"], rows: (["bear", "base", "bull"] as const).map((k) => [k, v.dcf[k].perShare ? `₹${v.dcf[k].perShare!.perShare.toFixed(0)}` : "—", v.dcf[k].perShare?.upside != null ? `${v.dcf[k].perShare!.upside!.toFixed(0)}%` : "—"]) }, { title: "Projected PAT (₹ cr)", head: ["Scenario", ...a.projections.base.rows.map((r) => r.label)], rows: (["bear", "base", "bull"] as const).map((k) => [k, ...a.projections[k].rows.map((r) => r.pat.toFixed(0))]) }]);
  add("Key positives", [], [], a.findings.filter((f) => f.kind === "positive").map((f) => `${f.title}: ${f.detail}`));
  add("Key concerns", [], [], a.findings.filter((f) => f.kind === "concern").map((f) => `${f.title}: ${f.detail}`));
  add("Unanswered questions", [], [], a.findings.filter((f) => f.kind === "question").map((f) => f.title));
  add("Final analytical assessment", [...a.conclusion, `Valuation classification at ₹${p.price ?? "—"}: ${v.verdict} (weighted fair value ${v.weighted === null ? "n/a" : `₹${v.weighted.toFixed(0)}`}, range ${v.range.low === null ? "n/a" : `₹${v.range.low.toFixed(0)}–₹${v.range.high!.toFixed(0)}`}).`]);
  const srcRows: string[][] = [];
  for (const k of ["revenue", "pat", "cfo", "totalDebt", "totalEquity", "totalAssets"]) for (const fy of a.fys) { const dp = a.view.get(fy, k); if (dp?.source && dp.status !== "derived") srcRows.push([LINE_ITEMS.find((d) => d.key === k)?.label ?? k, fy, dp.value === null ? "—" : dp.value.toFixed(2), dp.status, `${dp.source.docName}${dp.source.page ? ` p.${dp.source.page}` : ""}`]); }
  add("Source references", ["Key figures and their source pages (full traceability in the Data Review page / Excel export)."], [{ title: "Sources", head: ["Item", "Period", "Value", "Status", "Source"], rows: srcRows }]);
  add("Limitations and disclaimers", [
    "Figures are extracted automatically from PDFs and may contain errors; values marked derived, user-corrected or low-confidence should be verified against the source documents.",
    "Scores use heuristic bands disclosed in the application, not peer statistics. Forensic models (Beneish, Altman) are statistical screens, not evidence of manipulation or distress.",
    "Valuation outputs depend entirely on user assumptions (WACC, growth, margins, multiples). The only market input is the manually entered share price.",
    "AI-generated text, where present, is labelled and limited to interpreting the provided evidence; it may still contain errors.",
    "This report is for analytical purposes and is not investment advice or a recommendation to buy or sell any security.",
  ]);
  return s;
}

export function allMetricsTable(a: Analysis): ReportTable {
  return { title: "All annual metrics", head: ["Metric", "Unit", "Formula", ...a.fys], rows: Object.values(a.annual).map((s) => [s.def.name, s.def.unit, s.def.formula, ...a.fys.map((p) => { const r = s.byPeriod[p]; return r?.status === "ok" && r.value !== null ? String(Math.round(r.value * 10000) / 10000) : r?.status ?? ""; })]) };
}

const pdfSafe = (t: string) => t.replace(/₹/g, "Rs ").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[×]/g, "x").replace(/[−]/g, "-").replace(/[^\x00-\xFF]/g, "");

export async function exportPdf(p: Project, sections: ReportSection[]) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 50;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 27, 51);
  doc.text(pdfSafe(`${p.name} — Financial analysis report`), 40, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 90, 110);
  doc.text(pdfSafe(`Financial Intelligence Lab · generated ${new Date().toLocaleString("en-IN")} · not investment advice`), 40, y);
  y += 20;
  const ensure = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 50;
    }
  };
  for (const sec of sections) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(29, 78, 216);
    doc.text(pdfSafe(`${sec.n}. ${sec.title}`), 40, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(15, 27, 51);
    for (const para of [...sec.paragraphs, ...(sec.bullets ?? []).map((b) => `• ${b}`)]) {
      const lines = doc.splitTextToSize(pdfSafe(para), W - 80) as string[];
      for (const ln of lines) {
        ensure(12);
        doc.text(ln, 40, y);
        y += 11;
      }
      y += 3;
    }
    for (const t of sec.tables) {
      if (!t.rows.length) continue;
      ensure(30);
      doc.setFont("helvetica", "bold");
      doc.text(pdfSafe(t.title), 40, y);
      y += 4;
      autoTable(doc, { startY: y + 4, head: [t.head.map(pdfSafe)], body: t.rows.map((r) => r.map((c) => pdfSafe(String(c)))), styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [29, 78, 216] }, margin: { left: 40, right: 40 } });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
    }
    y += 6;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Page ${i} of ${pages}`, W - 80, doc.internal.pageSize.getHeight() - 20);
  }
  return doc.output("blob");
}

export async function exportExcel(p: Project, a: Analysis, sections: ReportSection[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Financial Intelligence Lab";
  const addTable = (name: string, t: ReportTable) => {
    const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
    ws.addRow([t.title]).font = { bold: true, size: 12 };
    const h = ws.addRow(t.head);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } }));
    t.rows.forEach((r) => ws.addRow(r.map((c) => { const n = Number(c); return c !== "" && Number.isFinite(n) && /^-?[\d.]+$/.test(c) ? n : c; })));
    ws.columns.forEach((col, i) => (col.width = i === 0 ? 38 : 16));
  };
  // Extracted data with sources
  const facts = wb.addWorksheet("Extracted data");
  facts.addRow(["Basis", "Period", "Item", "Key", "Value", "Unit", "Status", "Confidence", "Source document", "Page", "Printed value", "Note"]).font = { bold: true };
  for (const [pid, items] of Object.entries(a.view.periods)) for (const [k, dp] of Object.entries(items)) if (dp) facts.addRow([a.basis, pid, LINE_ITEMS.find((d) => d.key === k)?.label ?? k, k, dp.value, LINE_ITEMS.find((d) => d.key === k)?.unit ?? "", dp.status, dp.confidence, dp.source?.docName ?? "", dp.source?.page ?? "", dp.source?.rawValue ?? "", dp.note ?? ""]);
  facts.columns.forEach((c) => (c.width = 18));
  addTable("All metrics", allMetricsTable(a));
  for (const sec of sections) sec.tables.forEach((t, i) => t.rows.length && addTable(`${sec.n}-${i + 1} ${t.title}`, t));
  // Metric formulas for auditability
  const f = wb.addWorksheet("Metric definitions");
  f.addRow(["Key", "Name", "Category", "Unit", "Formula", "Description"]).font = { bold: true };
  Object.values(ANNUAL_METRICS_BY_KEY).forEach((d) => f.addRow([d.key, d.name, d.category, d.unit, d.formula, d.description]));
  f.columns.forEach((c, i) => (c.width = i === 4 ? 70 : 22));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
