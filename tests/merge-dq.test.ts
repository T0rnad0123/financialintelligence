import { describe, expect, it } from "vitest";
import { applyCorrection, mergeFacts, revertCorrection } from "@/lib/engine/merge";
import { dataQuality } from "@/lib/engine/dataQuality";
import { makeView } from "@/lib/engine/core";
import { deriveFacts } from "@/lib/engine/derive";
import type { DocMeta, ExtractedFact } from "@/lib/types";
import { facts, SIMPLE } from "./helpers/facts";

const doc = (id: string, kind: "annual" | "quarterly", at: number): DocMeta => ({ id, projectId: "p", kind, fileName: `${id}.pdf`, size: 1, hash: id, uploadedAt: at, status: "success", progress: 100, warnings: [] });
const f = (docId: string, periodId: string, value: number, primary: boolean): ExtractedFact => ({ basis: "consolidated", periodId, item: "revenue", value, isPrimaryPeriod: primary, confidence: "high", source: { docId, docName: `${docId}.pdf`, page: 3, method: "parser" } });

describe("merging facts from many documents", () => {
  const ar24 = doc("ar24", "annual", 2), ar25 = doc("ar25", "annual", 3), q4 = doc("q4", "quarterly", 4);
  const store = mergeFacts([
    { doc: ar24, facts: [f("ar24", "FY2024", 1000, true)] },
    { doc: ar25, facts: [f("ar25", "FY2024", 1010, false)] }, // restated comparative
    { doc: q4, facts: [f("q4", "FY2024", 1000, false)] },
  ], undefined);
  const dp = store.consolidated.FY2024.revenue!;
  it("prefers the annual report's own-period figure", () => { expect(dp.value).toBe(1000); expect(dp.selectionRule).toMatch(/Own-period/); });
  it("keeps all candidates and flags the conflict", () => { expect(dp.candidates).toHaveLength(3); expect(dp.note).toMatch(/differ/); expect(dp.confidence).toBe("medium"); });
  it("user correction survives a re-merge and can be reverted", () => {
    const corrected = applyCorrection(store, "consolidated", "FY2024", "revenue", 1010, "use restated");
    const re = mergeFacts([{ doc: ar24, facts: [f("ar24", "FY2024", 1000, true)] }], corrected);
    expect(re.consolidated.FY2024.revenue!.value).toBe(1010);
    expect(re.consolidated.FY2024.revenue!.status).toBe("user-corrected");
    expect(revertCorrection(re, "consolidated", "FY2024", "revenue").consolidated.FY2024.revenue!.status).toBe("reported");
  });
  it("ignores failed documents", () => {
    const s = mergeFacts([{ doc: { ...ar24, status: "failed" }, facts: [f("ar24", "FY2024", 1000, true)] }], undefined);
    expect(s.consolidated.FY2024).toBeUndefined();
  });
});

describe("data-quality checks", () => {
  const run = (o: Record<string, Record<string, number | null>>, shares: number | null = null) => {
    const raw = facts(o);
    const view = makeView(deriveFacts(raw, { basis: "standalone" }));
    return dataQuality(view, "standalone", { consolidated: {}, standalone: raw }, Object.keys(o).filter((p) => p.startsWith("FY")).sort(), [], [], [], [], shares, false);
  };
  it("passes a consistent balance sheet", () => expect(run(SIMPLE).issues.filter((i) => i.level === "error")).toHaveLength(0));
  it("detects an unbalanced balance sheet", () => expect(run({ FY2024: { ...SIMPLE.FY2024, totalEquityAndLiabilities: 1100 } }).issues.some((i) => i.id.startsWith("bs-balance"))).toBe(true));
  it("detects a unit mismatch through EPS", () => {
    const r = run({ FY2024: { ...SIMPLE.FY2024, epsBasic: 12, paidUpCapital: 1, faceValue: 10 } }); // implies 1M shares → EPS 1200 vs 12
    expect(r.issues.some((i) => i.category === "units")).toBe(true);
  });
  it("detects revenue jumps typical of lakh/crore confusion", () => expect(run({ FY2023: SIMPLE.FY2023, FY2024: { ...SIMPLE.FY2024, revenue: 100000 } }).issues.some((i) => i.id.startsWith("units-jump"))).toBe(true));
  it("flags missing years and missing share count", () => {
    const r = run({ FY2022: SIMPLE.FY2023, FY2024: SIMPLE.FY2024 });
    expect(r.issues.some((i) => i.id === "gap-FY2023")).toBe(true);
    expect(r.issues.some((i) => i.id === "shares-missing")).toBe(true);
  });
  it("score stays within 0..100", () => { const r = run(SIMPLE); expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); });
});
