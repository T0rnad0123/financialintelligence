// Builds the "effective" fact set used by the calculation engine. Every value
// created here is marked status "derived" with a note explaining the rule, so
// reported, corrected and derived figures are never confused.
import type { DataPoint, PeriodFacts } from "../types";
import { ITEM_MAP } from "../lineItems";
import { parsePeriodId, sortPeriodIds } from "../extraction/parseUtils";

const d = (value: number, note: string, confidence: DataPoint["confidence"] = "medium"): DataPoint => ({
  value,
  status: "derived",
  confidence,
  note,
  source: { docId: "derived", docName: "Calculated", method: "manual" },
});

const has = (pf: PeriodFacts | undefined, k: string) => pf?.[k]?.value !== null && pf?.[k]?.value !== undefined;
const val = (pf: PeriodFacts, k: string) => pf[k]!.value as number;

/** Balance-sheet lines commonly omitted when nil. Treated as nil only when that period's balance sheet was captured. */
const BS_NIL_IF_ABSENT = ["shortTermBorrowings", "longTermBorrowings", "leaseLiabilities", "goodwill", "intangibles", "currentInvestments", "nonCurrentInvestments", "otherBankBalances", "inventories", "cwip", "nonControllingInterestBs"];
/** P&L lines commonly omitted when nil, treated as nil only when the P&L was captured. */
const PL_NIL_IF_ABSENT = ["exceptionalItems", "materialsCost", "purchasesStockInTrade", "changesInInventories"];

export function deriveFacts(periods: Record<string, PeriodFacts>, opts: { basis: "consolidated" | "standalone" }): Record<string, PeriodFacts> {
  const out: Record<string, PeriodFacts> = {};
  for (const [pid, pf] of Object.entries(periods)) out[pid] = { ...pf };
  const ids = sortPeriodIds(Object.keys(out));

  for (const pid of ids) {
    const pf = out[pid];
    // Tax total
    if (!has(pf, "totalTax") && has(pf, "currentTax") && has(pf, "deferredTax")) {
      pf.totalTax = d(val(pf, "currentTax") + val(pf, "deferredTax"), "Total tax = current tax + deferred tax.");
    }
    if (!has(pf, "totalTax") && has(pf, "pbt") && has(pf, "pat") && !has(pf, "currentTax")) {
      pf.totalTax = d(val(pf, "pbt") - val(pf, "pat"), "Total tax = PBT − PAT (no tax line captured; may include discontinued items).", "low");
    }
    const plCaptured = has(pf, "revenue") && (has(pf, "pbt") || has(pf, "pat"));
    if (plCaptured) {
      for (const k of PL_NIL_IF_ABSENT) {
        if (!pf[k]) pf[k] = d(0, `${ITEM_MAP[k]?.label ?? k} not presented in the P&L for this period — treated as nil.`, "medium");
      }
    }
    // Exceptional impact (signed effect on PBT) is derived from the two profit lines to avoid sign ambiguity
    if (!has(pf, "pbtBeforeExceptional") && has(pf, "pbt") && has(pf, "exceptionalItems") && val(pf, "exceptionalItems") === 0) {
      pf.pbtBeforeExceptional = d(val(pf, "pbt"), "No exceptional items — profit before exceptional items equals PBT.", "high");
    }
    if (has(pf, "pbt") && has(pf, "pbtBeforeExceptional")) {
      pf.exceptionalEffect = d(val(pf, "pbt") - val(pf, "pbtBeforeExceptional"), "Exceptional impact on PBT = PBT − profit before exceptional items (positive = gain).", "high");
    }
    // PAT attributable to owners
    if (!has(pf, "patOwners") && has(pf, "pat")) {
      if (opts.basis === "standalone") pf.patOwners = d(val(pf, "pat"), "Standalone accounts: PAT attributable to owners equals PAT.", "high");
      else if (has(pf, "minorityInterestPl")) pf.patOwners = d(val(pf, "pat") - val(pf, "minorityInterestPl"), "PAT attributable to owners = PAT − non-controlling interest.");
      else pf.patOwners = d(val(pf, "pat"), "Owners' share of PAT not captured — total PAT used (non-controlling interest assumed immaterial; verify).", "low");
    }
    // Balance sheet
    const bsCaptured = has(pf, "totalAssets") || has(pf, "totalEquityAndLiabilities");
    if (!has(pf, "totalAssets") && has(pf, "totalEquityAndLiabilities")) pf.totalAssets = d(val(pf, "totalEquityAndLiabilities"), "Total assets = total equity and liabilities.", "high");
    if (!has(pf, "totalEquity") && has(pf, "paidUpCapital") && has(pf, "otherEquity") && bsCaptured) {
      pf.totalEquity = d(val(pf, "paidUpCapital") + val(pf, "otherEquity"), "Equity = share capital + other equity.");
    }
    if (bsCaptured) {
      for (const k of BS_NIL_IF_ABSENT) {
        if (!pf[k]) pf[k] = d(0, `${ITEM_MAP[k]?.label ?? k} not presented in the balance sheet for this period — treated as nil.`, "medium");
      }
      if (has(pf, "longTermBorrowings") && has(pf, "shortTermBorrowings")) {
        pf.totalDebt = d(val(pf, "longTermBorrowings") + val(pf, "shortTermBorrowings"), "Total borrowings = non-current + current borrowings (current maturities are included in current borrowings under Ind AS Schedule III).", "high");
      }
      if (!has(pf, "totalLiabilities") && has(pf, "totalCurrentLiabilities") && has(pf, "totalNonCurrentLiabilities")) {
        pf.totalLiabilities = d(val(pf, "totalCurrentLiabilities") + val(pf, "totalNonCurrentLiabilities"), "Total liabilities = current + non-current liabilities.", "high");
      }
      if (!has(pf, "totalLiabilities") && has(pf, "totalAssets") && has(pf, "totalEquity")) {
        const nci = has(pf, "nonControllingInterestBs") ? val(pf, "nonControllingInterestBs") : 0;
        pf.totalLiabilities = d(val(pf, "totalAssets") - val(pf, "totalEquity") - nci, "Total liabilities = total assets − equity − non-controlling interest.");
      }
    }
    // Capex including intangibles when separately reported
    if (has(pf, "capex") && has(pf, "capexIntangibles") && !pf.capexTotal) {
      pf.capexTotal = d(val(pf, "capex") + val(pf, "capexIntangibles"), "Capex = purchase of PPE + purchase of intangibles.", "high");
    } else if (has(pf, "capex")) {
      pf.capexTotal = { ...pf.capex!, note: pf.capex!.note };
    }
    // Shares outstanding from paid-up capital and face value (count)
    if (has(pf, "paidUpCapital") && has(pf, "faceValue") && val(pf, "faceValue") > 0) {
      pf.sharesDerived = d((val(pf, "paidUpCapital") * 1e7) / val(pf, "faceValue"), "Shares = paid-up equity capital (₹ crore × 10⁷) ÷ face value. Ignores partly-paid shares and treasury shares.");
    }
  }

  // Quarterly: derive missing Q4 = FY − (Q1+Q2+Q3) for flow items
  const fys = ids.filter((p) => p.startsWith("FY")).map((p) => parsePeriodId(p)!.fy);
  for (const fy of fys) {
    const q4 = `Q4FY${fy}`;
    const qs = [`Q1FY${fy}`, `Q2FY${fy}`, `Q3FY${fy}`].map((q) => out[q]);
    if (qs.some((q) => !q)) continue;
    const fyFacts = out[`FY${fy}`];
    for (const [k, dp] of Object.entries(fyFacts)) {
      const def = ITEM_MAP[k];
      if (!def || !def.flow || def.unit === "perShare" || def.unit === "pct") continue;
      if (dp?.status === "derived") continue;
      if (out[q4]?.[k]) continue;
      if (dp?.value == null || qs.some((q) => q![k]?.value == null || q![k]!.status === "derived")) continue;
      const v = dp.value - qs.reduce((s, q) => s + (q![k]!.value as number), 0);
      out[q4] ??= {};
      out[q4][k] = d(v, `Q4 derived as FY${fy} annual figure − (Q1+Q2+Q3). Annual audit adjustments fall into this derived quarter.`, "medium");
    }
  }
  return out;
}

/** Available FY and quarter ids with at least one core value, sorted. */
export function availablePeriods(periods: Record<string, PeriodFacts>) {
  const ids = sortPeriodIds(Object.keys(periods));
  const fy = ids.filter((p) => p.startsWith("FY") && Object.values(periods[p] ?? {}).some((x) => x && x.status !== "derived"));
  const q = ids.filter((p) => p.startsWith("Q") && Object.values(periods[p] ?? {}).some((x) => x && x.value !== null));
  return { fy, q };
}

/** Previous financial year id. */
export const prevFy = (pid: string) => `FY${Number(pid.slice(2)) - 1}`;

/** Same quarter of previous FY. */
export function prevYearQuarter(pid: string): string {
  const m = pid.match(/^Q(\d)FY(\d{4})$/);
  return m ? `Q${m[1]}FY${Number(m[2]) - 1}` : pid;
}

/** Immediately preceding quarter. */
export function prevQuarter(pid: string): string {
  const m = pid.match(/^Q(\d)FY(\d{4})$/);
  if (!m) return pid;
  const q = Number(m[1]);
  const fy = Number(m[2]);
  return q === 1 ? `Q4FY${fy - 1}` : `Q${q - 1}FY${fy}`;
}

/** The four consecutive quarters ending with `pid`. */
export function ttmWindow(pid: string): string[] {
  const out = [pid];
  let cur = pid;
  for (let i = 0; i < 3; i++) {
    cur = prevQuarter(cur);
    out.unshift(cur);
  }
  return out;
}
