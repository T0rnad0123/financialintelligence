// Quarterly analysis: TTM, seasonality, reconciliation of quarters vs annual figures.
import type { FactView, Operand } from "./core";
import { mean, stdev } from "./core";
import { ttmWindow } from "./derive";
import { ebitdaOp } from "./metrics";
import { ITEM_MAP } from "../lineItems";

export interface TtmPoint {
  periodId: string; // last quarter of the window
  window: string[];
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  eps: number | null;
  financeCost: number | null;
  includesDerived: boolean;
  missing: string[];
}

function sumWindow(view: FactView, window: string[], f: (p: string) => Operand | number | null): { value: number | null; derived: boolean; missing: string[] } {
  let total = 0;
  let derived = false;
  const missing: string[] = [];
  for (const q of window) {
    const r = f(q);
    const v = typeof r === "number" || r === null ? r : r.value;
    if (v === null || v === undefined) {
      missing.push(q);
      continue;
    }
    if (typeof r === "object" && r !== null && r.parts.some((p) => p.status === "derived")) derived = true;
    total += v;
  }
  return { value: missing.length ? null : total, derived, missing };
}

export function computeTtm(view: FactView, quarters: string[]): TtmPoint[] {
  const set = new Set(quarters);
  const out: TtmPoint[] = [];
  for (const q of quarters) {
    const w = ttmWindow(q);
    if (!w.every((x) => set.has(x) || view.periods[x])) continue;
    const get = (k: string) => (p: string) => {
      const dp = view.get(p, k);
      return dp?.value == null ? null : { label: k, value: dp.value, parts: [{ label: k, periodId: p, value: dp.value, status: dp.status }], missing: [], notes: [], lowConfidence: false } as Operand;
    };
    const rev = sumWindow(view, w, get("revenue"));
    const eb = sumWindow(view, w, (p) => ebitdaOp(view, p));
    const pat = sumWindow(view, w, get("pat"));
    const eps = sumWindow(view, w, get("epsDiluted"));
    const fin = sumWindow(view, w, get("financeCost"));
    out.push({
      periodId: q,
      window: w,
      revenue: rev.value,
      ebitda: eb.value,
      pat: pat.value,
      eps: eps.value,
      financeCost: fin.value,
      includesDerived: rev.derived || eb.derived || pat.derived,
      missing: [...new Set([...rev.missing, ...pat.missing])],
    });
  }
  return out;
}

export interface ReconRow {
  fy: string;
  item: string;
  label: string;
  annual: number | null;
  sumOfQuarters: number | null;
  difference: number | null;
  differencePct: number | null;
  quartersPresent: number;
  q4Derived: boolean;
  explanation: string;
}

const RECON_ITEMS = ["revenue", "otherIncome", "totalExpenses", "financeCost", "depreciation", "pbt", "pat"];

/** Compare annual figures with the sum of the four reported quarters. */
export function reconcileQuarters(view: FactView, fys: string[]): ReconRow[] {
  const rows: ReconRow[] = [];
  for (const fyId of fys) {
    const fy = Number(fyId.slice(2));
    const qs = [1, 2, 3, 4].map((q) => `Q${q}FY${fy}`);
    for (const k of RECON_ITEMS) {
      const annual = view.get(fyId, k)?.value ?? null;
      const vals = qs.map((q) => view.get(q, k));
      const present = vals.filter((x) => x?.value != null).length;
      const q4Derived = vals[3]?.status === "derived";
      if (present === 0 && annual === null) continue;
      const sum = present === 4 ? vals.reduce((s, x) => s + (x!.value as number), 0) : null;
      const diff = annual !== null && sum !== null ? annual - sum : null;
      const pct = diff !== null && annual ? (diff / Math.abs(annual)) * 100 : null;
      let explanation = "";
      if (present < 4) explanation = `Only ${present} of 4 quarters available — cannot reconcile.`;
      else if (annual === null) explanation = "Annual figure not available.";
      else if (q4Derived) explanation = "Q4 was derived as annual − 9M, so the reconciliation holds by construction.";
      else if (Math.abs(diff!) <= Math.max(0.5, Math.abs(annual) * 0.002)) explanation = "Reconciles (difference within rounding).";
      else
        explanation =
          "Difference may reflect audit adjustments booked in the annual accounts, regrouping/reclassification of quarterly comparatives, a different reporting basis (standalone vs consolidated) between documents, acquisitions/discontinued operations, or extraction errors — verify against the annual report.";
      rows.push({ fy: fyId, item: k, label: ITEM_MAP[k]?.label ?? k, annual, sumOfQuarters: sum, difference: diff, differencePct: pct, quartersPresent: present, q4Derived, explanation });
    }
  }
  return rows;
}

export interface Seasonality {
  shares: { q: number; avgShare: number | null; observations: number }[];
  significant: boolean;
  note: string;
}

/** Average share of annual revenue earned in each quarter. */
export function seasonality(view: FactView, fys: string[]): Seasonality {
  const byQ: number[][] = [[], [], [], []];
  for (const fyId of fys) {
    const fy = Number(fyId.slice(2));
    const vals = [1, 2, 3, 4].map((q) => view.get(`Q${q}FY${fy}`, "revenue")?.value ?? null);
    if (vals.some((v) => v === null)) continue;
    const total = (vals as number[]).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    vals.forEach((v, i) => byQ[i].push(((v as number) / total) * 100));
  }
  const shares = byQ.map((arr, i) => ({ q: i + 1, avgShare: mean(arr), observations: arr.length }));
  const valid = shares.filter((s) => s.avgShare !== null).map((s) => s.avgShare as number);
  const spread = valid.length === 4 ? Math.max(...valid) - Math.min(...valid) : null;
  const significant = spread !== null && spread > 4;
  return {
    shares,
    significant,
    note:
      spread === null
        ? "Needs at least one complete financial year of quarterly revenue to assess seasonality."
        : significant
          ? `Revenue share varies by ${spread.toFixed(1)} percentage points across quarters — compare quarters year-over-year rather than sequentially.`
          : `Quarterly revenue shares are fairly even (spread ${spread.toFixed(1)} pp); sequential comparisons are less distorted by seasonality.`,
  };
}

export function earningsVolatility(view: FactView, quarters: string[]): { patYoYStdev: number | null; observations: number } {
  const g: number[] = [];
  for (const q of quarters) {
    const m = q.match(/^Q(\d)FY(\d{4})$/);
    if (!m) continue;
    const prev = `Q${m[1]}FY${Number(m[2]) - 1}`;
    const a = view.get(q, "pat")?.value;
    const b = view.get(prev, "pat")?.value;
    if (a != null && b != null && b > 0) g.push((a / b - 1) * 100);
  }
  return { patYoYStdev: stdev(g), observations: g.length };
}

/** Quarters expected in the last 16-quarter window but missing. */
export function missingQuarters(quarters: string[]): string[] {
  if (!quarters.length) return [];
  const last = quarters[quarters.length - 1];
  const m = last.match(/^Q(\d)FY(\d{4})$/);
  if (!m) return [];
  let q = Number(m[1]);
  let fy = Number(m[2]);
  const expected: string[] = [];
  for (let i = 0; i < 16; i++) {
    expected.unshift(`Q${q}FY${fy}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      fy -= 1;
    }
  }
  const have = new Set(quarters);
  const first = quarters[0];
  const startIdx = expected.indexOf(first);
  return expected.filter((x, i) => !have.has(x) && (startIdx === -1 || i >= 0)).slice(0, 16);
}
