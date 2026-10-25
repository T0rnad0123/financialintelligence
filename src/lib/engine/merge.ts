// Merges facts extracted from many documents into one traceable fact store.
// Rule (documented in the UI):
//  1. A user-corrected value always wins.
//  2. Otherwise prefer the figure from the document whose own reporting period it is
//     (annual report > quarterly result), because comparatives may be regrouped later.
//  3. Otherwise prefer the most recently uploaded document that reports it as a comparative.
//  4. Ties: higher extraction confidence.
// All competing values are kept as `candidates` so conflicts stay visible.
import type { Basis, Candidate, DataPoint, DocMeta, ExtractedFact, FactStore, SegmentFact } from "../types";

export const CONFLICT_REL_TOL = 0.005; // 0.5%
export const CONFLICT_ABS_TOL = 0.05; // ₹0.05 crore

export function emptyFactStore(): FactStore {
  return { consolidated: {}, standalone: {} };
}

function rank(c: Candidate, conf: string): number {
  let r = 0;
  if (c.isPrimaryPeriod && c.docKind === "annual") r += 4000;
  else if (c.isPrimaryPeriod) r += 3000;
  else if (c.docKind === "annual") r += 2000;
  else r += 1000;
  r += conf === "high" ? 30 : conf === "medium" ? 20 : 10;
  return r;
}

export function valuesConflict(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff > CONFLICT_ABS_TOL && diff > Math.abs(a) * CONFLICT_REL_TOL;
}

export interface MergeInput {
  doc: DocMeta;
  facts: ExtractedFact[];
}

export function mergeFacts(inputs: MergeInput[], previous: FactStore | undefined): FactStore {
  const out = emptyFactStore();
  const groups = new Map<string, { basis: Basis; periodId: string; item: string; cands: { c: Candidate; conf: string }[] }>();
  for (const { doc, facts } of inputs) {
    if (doc.status !== "success" && doc.status !== "partial") continue;
    for (const f of facts) {
      const key = `${f.basis}|${f.periodId}|${f.item}`;
      let g = groups.get(key);
      if (!g) {
        g = { basis: f.basis, periodId: f.periodId, item: f.item, cands: [] };
        groups.set(key, g);
      }
      g.cands.push({
        c: { value: f.value, source: f.source, isPrimaryPeriod: f.isPrimaryPeriod, docKind: doc.kind, docUploadedAt: doc.uploadedAt },
        conf: f.confidence,
      });
    }
  }
  for (const g of groups.values()) {
    g.cands.sort((a, b) => rank(b.c, b.conf) - rank(a.c, a.conf) || b.c.docUploadedAt - a.c.docUploadedAt);
    const top = g.cands[0];
    const conflicting = g.cands.filter((x) => valuesConflict(x.c.value, top.c.value));
    const dp: DataPoint = {
      value: top.c.value,
      status: "reported",
      confidence: conflicting.length ? (top.conf === "high" ? "medium" : "low") : (top.conf as DataPoint["confidence"]),
      source: top.c.source,
      candidates: g.cands.map((x) => x.c),
      selectionRule: top.c.isPrimaryPeriod
        ? `Own-period figure from ${top.c.docKind === "annual" ? "annual report" : "quarterly result"}`
        : `Comparative figure from the most recent ${top.c.docKind === "annual" ? "annual report" : "quarterly result"}`,
      note: conflicting.length ? `${conflicting.length} other document value(s) differ — review in Data Quality.` : undefined,
    };
    out[g.basis][g.periodId] ??= {};
    out[g.basis][g.periodId][g.item] = dp;
  }
  // Re-apply user corrections and manual entries
  if (previous) {
    for (const basis of ["consolidated", "standalone"] as Basis[]) {
      for (const [pid, items] of Object.entries(previous[basis] ?? {})) {
        for (const [item, dp] of Object.entries(items ?? {})) {
          if (!dp || dp.status !== "user-corrected") continue;
          out[basis][pid] ??= {};
          const existing = out[basis][pid][item];
          out[basis][pid][item] = { ...dp, candidates: existing?.candidates ?? dp.candidates };
        }
      }
    }
  }
  return out;
}

export function mergeSegments(
  inputs: { doc: DocMeta; segments: { basis: Basis; periodId: string; segment: string; metric: SegmentFact["metric"]; value: number; page: number; rawText: string; rawValue: string }[] }[],
): SegmentFact[] {
  const map = new Map<string, { sf: SegmentFact; primary: boolean; at: number }>();
  for (const { doc, segments } of inputs) {
    if (doc.status !== "success" && doc.status !== "partial") continue;
    for (const s of segments) {
      const name = s.segment.replace(/\s+/g, " ").trim();
      const key = `${s.basis}|${s.periodId}|${name.toLowerCase()}|${s.metric}`;
      const primary = s.periodId === doc.primaryPeriod;
      const prev = map.get(key);
      if (prev && (prev.primary && !primary || (prev.primary === primary && prev.at >= doc.uploadedAt))) continue;
      map.set(key, {
        primary,
        at: doc.uploadedAt,
        sf: {
          basis: s.basis,
          periodId: s.periodId,
          segment: name,
          metric: s.metric,
          dp: { value: s.value, status: "reported", confidence: "medium", source: { docId: doc.id, docName: doc.fileName, page: s.page, rawText: s.rawText, rawValue: s.rawValue, method: "parser" } },
        },
      });
    }
  }
  return [...map.values()].map((v) => v.sf);
}

/** Set (or clear) a user correction for a single fact. */
export function applyCorrection(store: FactStore, basis: Basis, periodId: string, item: string, value: number | null, note: string): FactStore {
  const next: FactStore = { consolidated: { ...store.consolidated }, standalone: { ...store.standalone } };
  next[basis][periodId] = { ...(next[basis][periodId] ?? {}) };
  const prev = next[basis][periodId][item];
  next[basis][periodId][item] = {
    value,
    status: "user-corrected",
    confidence: "high",
    source: { docId: "manual", docName: "User input", method: "manual", rawValue: value === null ? "" : String(value) },
    note: note || (prev?.value != null ? `Corrected by user (extracted value was ${prev.value}).` : "Entered by user."),
    candidates: prev?.candidates,
  };
  return next;
}

/** Remove a user correction so the extracted value is used again on the next merge. */
export function revertCorrection(store: FactStore, basis: Basis, periodId: string, item: string): FactStore {
  const next: FactStore = { consolidated: { ...store.consolidated }, standalone: { ...store.standalone } };
  const items = { ...(next[basis][periodId] ?? {}) };
  const dp = items[item];
  if (dp?.candidates?.length) {
    const c = dp.candidates[0];
    items[item] = { value: c.value, status: "reported", confidence: "medium", source: c.source, candidates: dp.candidates, selectionRule: "Restored extracted value (re-merge to apply full selection rule)" };
  } else delete items[item];
  next[basis][periodId] = items;
  return next;
}
