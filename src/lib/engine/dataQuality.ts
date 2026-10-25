// Data-quality engine: accounting identities, cross-document conflicts,
// unit sanity, coverage, and a transparent score.
import type { Basis, DocMeta, FactStore } from "../types";
import type { FactView } from "./core";
import { itemLabel, LINE_ITEMS } from "../lineItems";
import { valuesConflict } from "./merge";
import type { ReconRow } from "./quarterly";

export type DqLevel = "error" | "warning" | "info";

export interface DqIssue {
  id: string;
  level: DqLevel;
  category: "identity" | "conflict" | "coverage" | "units" | "periods" | "basis" | "documents" | "plausibility" | "shares" | "reconciliation";
  title: string;
  detail: string;
  periodId?: string;
  values?: { label: string; value: number | null; source?: string }[];
  causes?: string;
  conflictKey?: { basis: Basis; periodId: string; item: string };
}

export interface DqResult {
  issues: DqIssue[];
  score: number;
  scoreExplanation: string[];
  coverage: { periodId: string; present: number; required: number; pct: number }[];
  statusCounts: { reportedHigh: number; reportedOther: number; corrected: number; derived: number; estimated: number; missingCore: number };
  conflicts: { label: string; item: string; basis: Basis; periodId: string; selected: number | null; values: { value: number; docName: string; page?: number; primary: boolean }[] }[];
}

const CORE_ITEMS = LINE_ITEMS.filter((d) => d.core).map((d) => d.key);
const tol = (a: number) => Math.max(1, Math.abs(a) * 0.005);

export function dataQuality(view: FactView, basis: Basis, store: FactStore, fys: string[], quarters: string[], docs: DocMeta[], recon: ReconRow[], missingQs: string[], userShares: number | null, financial: boolean): DqResult {
  const issues: DqIssue[] = [];
  const g = (p: string, k: string) => view.get(p, k)?.value ?? null;
  const push = (i: DqIssue) => issues.push(i);

  for (const p of fys) {
    const ta = g(p, "totalAssets");
    const tel = g(p, "totalEquityAndLiabilities");
    if (ta !== null && tel !== null && view.get(p, "totalAssets")?.status !== "derived" && Math.abs(ta - tel) > tol(ta)) {
      push({ id: `bs-balance-${p}`, level: "error", category: "identity", periodId: p, title: `Balance sheet does not balance (${p})`, detail: `Total assets ₹${ta.toFixed(2)} cr vs total equity & liabilities ₹${tel.toFixed(2)} cr.`, values: [{ label: "Total assets", value: ta }, { label: "Total equity & liabilities", value: tel }], causes: "Extraction picked a wrong line or column, or values from different units/bases were mixed." });
    }
    const ca = g(p, "totalCurrentAssets");
    const nca = g(p, "totalNonCurrentAssets");
    if (ta !== null && ca !== null && nca !== null && Math.abs(ca + nca - ta) > tol(ta)) {
      push({ id: `bs-assets-${p}`, level: "warning", category: "identity", periodId: p, title: `Current + non-current assets ≠ total assets (${p})`, detail: `₹${ca.toFixed(2)} + ₹${nca.toFixed(2)} vs ₹${ta.toFixed(2)} cr.`, causes: "Assets held for sale or a mis-extracted subtotal." });
    }
    const rev = g(p, "revenue");
    const oi = g(p, "otherIncome");
    const ti = g(p, "totalIncome");
    if (rev !== null && oi !== null && ti !== null && Math.abs(rev + oi - ti) > tol(ti)) {
      push({ id: `pl-income-${p}`, level: "warning", category: "identity", periodId: p, title: `Revenue + other income ≠ total income (${p})`, detail: `₹${rev.toFixed(2)} + ₹${oi.toFixed(2)} vs ₹${ti.toFixed(2)} cr.` });
    }
    const pbt = g(p, "pbt");
    const tax = g(p, "totalTax");
    const pat = g(p, "pat");
    if (pbt !== null && tax !== null && pat !== null && view.get(p, "totalTax")?.status !== "derived" && Math.abs(pbt - tax - pat) > tol(pbt)) {
      push({ id: `pl-pat-${p}`, level: "warning", category: "identity", periodId: p, title: `PBT − tax ≠ PAT (${p})`, detail: `₹${pbt.toFixed(2)} − ₹${tax.toFixed(2)} vs ₹${pat.toFixed(2)} cr.`, causes: "Share of profit of associates/JVs or discontinued operations presented after tax (common in consolidated accounts)." });
    }
    const cfo = g(p, "cfo");
    const cfi = g(p, "cfi");
    const cff = g(p, "cff");
    const nc = g(p, "netChangeInCash");
    if (cfo !== null && cfi !== null && cff !== null && nc !== null && Math.abs(cfo + cfi + cff - nc) > tol(Math.max(Math.abs(cfo), 1))) {
      push({ id: `cf-sum-${p}`, level: "warning", category: "identity", periodId: p, title: `Cash flow sections do not sum to net change (${p})`, detail: `CFO ${cfo.toFixed(2)} + CFI ${cfi.toFixed(2)} + CFF ${cff.toFixed(2)} ≠ ${nc.toFixed(2)}.`, causes: "Exchange differences on cash, or a mis-extracted line." });
    }
    const prevP = `FY${Number(p.slice(2)) - 1}`;
    const cash = g(p, "cash");
    const cashPrev = g(prevP, "cash");
    if (nc !== null && cash !== null && cashPrev !== null && Math.abs(cash - cashPrev - nc) > tol(Math.max(cash, 1)) * 4) {
      push({ id: `cf-cash-${p}`, level: "info", category: "identity", periodId: p, title: `Balance-sheet cash movement differs from cash-flow net change (${p})`, detail: `BS cash moved ₹${(cash - cashPrev).toFixed(2)} cr; cash flow shows ₹${nc.toFixed(2)} cr.`, causes: "Bank overdrafts netted in the cash flow statement, or cash classified differently." });
    }
    // EPS check (unit detection)
    const sh = g(p, "sharesDerived") ?? userShares;
    const patO = g(p, "patOwners");
    const eps = g(p, "epsBasic") ?? g(p, "epsDiluted");
    if (sh && patO !== null && eps !== null && eps !== 0) {
      const implied = (patO * 1e7) / sh;
      const ratio = implied / eps;
      if (ratio > 50 || ratio < 0.02) {
        push({ id: `units-eps-${p}`, level: "error", category: "units", periodId: p, title: `Possible unit mismatch (${p})`, detail: `PAT ÷ shares implies EPS of ₹${implied.toFixed(2)} but reported EPS is ₹${eps.toFixed(2)} (×${ratio.toFixed(1)}).`, causes: "Reporting unit detected incorrectly (lakh vs crore vs million) or wrong share count." });
      } else if (Math.abs(ratio - 1) > 0.1) {
        push({ id: `shares-eps-${p}`, level: "info", category: "shares", periodId: p, title: `EPS differs from PAT ÷ shares by ${((ratio - 1) * 100).toFixed(0)}% (${p})`, detail: `Implied ₹${implied.toFixed(2)} vs reported ₹${eps.toFixed(2)}.`, causes: "Weighted-average share count differs from year-end count (issuances/buy-backs), treasury shares, or derived share count from paid-up capital." });
      }
    }
    // plausibility
    for (const k of ["revenue", "totalAssets", "inventories", "tradeReceivables", "totalEquity"]) {
      const v = g(p, k);
      if (v !== null && v < 0 && !(k === "totalEquity")) push({ id: `neg-${k}-${p}`, level: "error", category: "plausibility", periodId: p, title: `Negative ${itemLabel(k)} (${p})`, detail: `₹${v.toFixed(2)} cr — implausible for this line.` });
      if (k === "totalEquity" && v !== null && v < 0) push({ id: `neg-eq-${p}`, level: "warning", category: "plausibility", periodId: p, title: `Negative equity (${p})`, detail: `Equity of ₹${v.toFixed(2)} cr — accumulated losses exceed capital; many ratios become not meaningful.` });
    }
    const etr = pbt && tax !== null ? (tax / pbt) * 100 : null;
    if (etr !== null && pbt! > 0 && (etr > 60 || etr < -10)) push({ id: `etr-${p}`, level: "info", category: "plausibility", periodId: p, title: `Unusual effective tax rate (${p})`, detail: `${etr.toFixed(1)}%.` });
    // unit jumps vs previous year
    const r0 = g(prevP, "revenue");
    if (rev !== null && r0 !== null && r0 > 0 && (rev / r0 > 20 || rev / r0 < 0.05)) {
      push({ id: `units-jump-${p}`, level: "error", category: "units", periodId: p, title: `Revenue changed by a factor of ${(rev / r0).toFixed(1)} vs ${prevP}`, detail: "Such jumps usually mean the units of two documents were read differently (e.g. lakh vs crore).", causes: "Unit detection or a merger/demerger." });
    }
  }

  // Missing years / gaps
  if (fys.length) {
    const first = Number(fys[0].slice(2));
    const last = Number(fys[fys.length - 1].slice(2));
    for (let y = first; y <= last; y++) if (!fys.includes(`FY${y}`)) push({ id: `gap-FY${y}`, level: "warning", category: "periods", title: `Missing financial year FY${y}`, detail: "Growth rates and averages spanning this year cannot be computed." });
    if (fys.length < 4) push({ id: "few-years", level: "info", category: "coverage", title: `Only ${fys.length} financial year(s) available`, detail: "3-year CAGR needs four annual data points; average-balance ratios need prior-year balance sheets." });
  } else push({ id: "no-annual", level: "warning", category: "coverage", title: "No annual financial data for this basis", detail: `Upload annual reports or switch basis. Selected basis: ${basis}.` });
  if (missingQs.length && quarters.length) push({ id: "missing-q", level: "info", category: "periods", title: `${missingQs.length} of the last 16 quarters missing`, detail: missingQs.join(", ") });

  // Basis mismatch
  const other: Basis = basis === "consolidated" ? "standalone" : "consolidated";
  const otherFys = Object.keys(store[other] ?? {}).filter((p) => p.startsWith("FY")).length;
  const otherQs = Object.keys(store[other] ?? {}).filter((p) => p.startsWith("Q")).length;
  if (quarters.length === 0 && otherQs > 0) push({ id: "basis-q", level: "warning", category: "basis", title: `Quarterly data exists only on the ${other} basis`, detail: `Switch to ${other} or upload ${basis} quarterly results. Standalone and consolidated figures are never mixed.` });
  if (fys.length === 0 && otherFys > 0) push({ id: "basis-fy", level: "warning", category: "basis", title: `Annual data exists only on the ${other} basis`, detail: `Switch to ${other} to analyse it.` });

  // Reconciliation
  for (const r of recon) {
    if (r.difference !== null && !r.q4Derived && r.differencePct !== null && Math.abs(r.differencePct) > 1) {
      push({ id: `recon-${r.fy}-${r.item}`, level: Math.abs(r.differencePct) > 5 ? "warning" : "info", category: "reconciliation", periodId: r.fy, title: `${r.label}: quarters don't add up to annual (${r.fy})`, detail: `Annual ₹${r.annual?.toFixed(2)} cr vs sum of quarters ₹${r.sumOfQuarters?.toFixed(2)} cr (${r.differencePct.toFixed(1)}%).`, causes: r.explanation });
    }
  }

  // Conflicts
  const conflicts: DqResult["conflicts"] = [];
  for (const [pid, items] of Object.entries(store[basis] ?? {})) {
    for (const [k, dp] of Object.entries(items ?? {})) {
      if (!dp?.candidates || dp.candidates.length < 2) continue;
      const distinct = dp.candidates.filter((c, i, arr) => arr.findIndex((x) => !valuesConflict(x.value, c.value)) === i);
      if (distinct.length < 2) continue;
      conflicts.push({ label: itemLabel(k), item: k, basis, periodId: pid, selected: dp.value, values: dp.candidates.map((c) => ({ value: c.value, docName: c.source.docName, page: c.source.page, primary: c.isPrimaryPeriod })) });
      push({
        id: `conflict-${pid}-${k}`,
        level: "warning",
        category: "conflict",
        periodId: pid,
        title: `Conflicting values for ${itemLabel(k)} (${pid})`,
        detail: dp.candidates.map((c) => `₹${c.value.toFixed(2)} (${c.source.docName}${c.source.page ? ` p.${c.source.page}` : ""}${c.isPrimaryPeriod ? ", own period" : ", comparative"})`).join(" vs "),
        values: dp.candidates.map((c) => ({ label: c.source.docName, value: c.value, source: c.source.page ? `p.${c.source.page}` : undefined })),
        causes: `Selected: ₹${dp.value?.toFixed(2)} (${dp.status === "user-corrected" ? "your choice" : dp.selectionRule}). Differences usually come from restated/regrouped comparatives or an extraction error.`,
        conflictKey: { basis, periodId: pid, item: k },
      });
    }
  }

  // Shares
  const latest = fys[fys.length - 1];
  const derivedShares = latest ? g(latest, "sharesDerived") : null;
  if (userShares && derivedShares && Math.abs(userShares / derivedShares - 1) > 0.02) {
    push({ id: "shares-mismatch", level: "warning", category: "shares", title: "Entered share count differs from paid-up capital ÷ face value", detail: `Entered ${userShares.toLocaleString("en-IN")} vs derived ${Math.round(derivedShares).toLocaleString("en-IN")}.`, causes: "Recent issuance/buy-back, treasury shares, partly-paid shares, or a stock split after the balance-sheet date." });
  }
  if (!userShares && !derivedShares) push({ id: "shares-missing", level: "warning", category: "shares", title: "Share count not available", detail: "Enter shares outstanding on the Valuation page — per-share values and market capitalisation need it." });

  // Documents
  const seen = new Map<string, string>();
  for (const d of docs) {
    if (d.status === "failed") push({ id: `doc-failed-${d.id}`, level: "warning", category: "documents", title: `Document failed: ${d.fileName}`, detail: d.error ?? "Processing failed." });
    if (d.scanned && !d.ocrApplied) push({ id: `doc-scanned-${d.id}`, level: "warning", category: "documents", title: `Scanned PDF without OCR: ${d.fileName}`, detail: "Enable OCR in Settings and reprocess, or enter key figures manually." });
    if (seen.has(d.hash)) push({ id: `doc-dup-${d.id}`, level: "warning", category: "documents", title: `Duplicate document: ${d.fileName}`, detail: `Same content as ${seen.get(d.hash)}.` });
    else seen.set(d.hash, d.fileName);
    for (const w of d.warnings.filter((x) => x.level === "error")) push({ id: `doc-err-${d.id}-${w.message.slice(0, 20)}`, level: "warning", category: "documents", title: `${d.fileName}`, detail: w.message });
  }

  // Coverage
  const required = financial ? ["totalIncome", "pat", "totalAssets", "totalEquity"] : CORE_ITEMS;
  const coverage = fys.map((p) => {
    const present = required.filter((k) => g(p, k) !== null).length;
    return { periodId: p, present, required: required.length, pct: (present / required.length) * 100 };
  });
  for (const c of coverage) if (c.pct < 60) push({ id: `cov-${c.periodId}`, level: "info", category: "coverage", periodId: c.periodId, title: `Low data coverage in ${c.periodId} (${c.pct.toFixed(0)}%)`, detail: `Missing: ${required.filter((k) => g(c.periodId, k) === null).map(itemLabel).join(", ")}.` });

  // Status counts
  const statusCounts = { reportedHigh: 0, reportedOther: 0, corrected: 0, derived: 0, estimated: 0, missingCore: 0 };
  for (const p of [...fys, ...quarters]) {
    const pf = view.periods[p] ?? {};
    for (const dp of Object.values(pf)) {
      if (!dp) continue;
      if (dp.status === "reported") dp.confidence === "high" ? statusCounts.reportedHigh++ : statusCounts.reportedOther++;
      else if (dp.status === "user-corrected") statusCounts.corrected++;
      else if (dp.status === "derived") statusCounts.derived++;
      else if (dp.status === "estimated") statusCounts.estimated++;
    }
  }
  for (const c of coverage) statusCounts.missingCore += c.required - c.present;

  // Score
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const infos = issues.filter((i) => i.level === "info").length;
  const checkScore = Math.max(0, 100 - errors * 12 - warnings * 4 - infos * 1);
  const covScore = coverage.length ? coverage.reduce((s, c) => s + c.pct, 0) / coverage.length : 0;
  const yearsScore = Math.min(100, (fys.length / 4) * 100);
  const qScore = Math.min(100, (quarters.length / 16) * 100);
  const score = Math.round(0.45 * checkScore + 0.3 * covScore + 0.15 * yearsScore + 0.1 * qScore);
  const scoreExplanation = [
    `Consistency checks: ${checkScore.toFixed(0)}/100 (100 − 12 per error [${errors}] − 4 per warning [${warnings}] − 1 per note [${infos}]) × 45%`,
    `Core line-item coverage: ${covScore.toFixed(0)}% × 30%`,
    `Annual history: ${fys.length} of 4 years → ${yearsScore.toFixed(0)} × 15%`,
    `Quarterly history: ${quarters.length} of 16 quarters → ${qScore.toFixed(0)} × 10%`,
  ];
  return { issues, score, scoreExplanation, coverage, statusCounts, conflicts };
}
