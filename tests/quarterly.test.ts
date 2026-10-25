import { describe, expect, it } from "vitest";
import { computeTtm, missingQuarters, reconcileQuarters, seasonality } from "@/lib/engine/quarterly";
import { ttmWindow } from "@/lib/engine/derive";
import { viewOf } from "./helpers/facts";

const q = (rev: number, pat: number) => ({ revenue: rev, pat, totalExpenses: rev * 0.8, financeCost: 1, depreciation: 2, otherIncome: 0, pbtBeforeExceptional: rev * 0.2, pbt: rev * 0.2 });

describe("quarterly aggregation", () => {
  it("TTM window crosses financial years", () => expect(ttmWindow("Q2FY2025")).toEqual(["Q3FY2024", "Q4FY2024", "Q1FY2025", "Q2FY2025"]));
  it("TTM sums four consecutive quarters", () => {
    const v = viewOf({ Q1FY2024: q(100, 10), Q2FY2024: q(110, 11), Q3FY2024: q(120, 12), Q4FY2024: q(130, 13), Q1FY2025: q(140, 14) });
    const t = computeTtm(v, ["Q1FY2024", "Q2FY2024", "Q3FY2024", "Q4FY2024", "Q1FY2025"]);
    expect(t.map((x) => x.periodId)).toEqual(["Q4FY2024", "Q1FY2025"]);
    expect(t[0].revenue).toBe(460); expect(t[1].revenue).toBe(500); expect(t[1].pat).toBe(50);
  });
  it("TTM is not computed across a missing quarter", () => {
    const v = viewOf({ Q1FY2024: q(100, 10), Q2FY2024: q(110, 11), Q4FY2024: q(130, 13), Q1FY2025: q(140, 14) });
    const t = computeTtm(v, ["Q1FY2024", "Q2FY2024", "Q4FY2024", "Q1FY2025"]);
    expect(t.every((x) => x.revenue === null)).toBe(true);
  });
  it("derives Q4 from annual minus 9M and labels it", () => {
    const v = viewOf({ Q1FY2024: q(100, 10), Q2FY2024: q(110, 11), Q3FY2024: q(120, 12), FY2024: { revenue: 480, pat: 50 } });
    const dp = v.get("Q4FY2024", "revenue")!;
    expect(dp.value).toBe(150); expect(dp.status).toBe("derived"); expect(dp.note).toMatch(/derived/);
  });
  it("reconciliation flags differences", () => {
    const v = viewOf({ Q1FY2024: q(100, 10), Q2FY2024: q(110, 11), Q3FY2024: q(120, 12), Q4FY2024: q(130, 13), FY2024: { revenue: 470, pat: 46 } });
    const r = reconcileQuarters(v, ["FY2024"]).find((x) => x.item === "revenue")!;
    expect(r.sumOfQuarters).toBe(460); expect(r.difference).toBe(10); expect(r.explanation).toMatch(/audit adjustments/);
  });
  it("seasonality shares sum to 100", () => {
    const v = viewOf({ Q1FY2024: q(100, 10), Q2FY2024: q(100, 11), Q3FY2024: q(100, 12), Q4FY2024: q(200, 13) });
    const s = seasonality(v, ["FY2024"]);
    expect(s.shares.reduce((a, b) => a + (b.avgShare ?? 0), 0)).toBeCloseTo(100); expect(s.significant).toBe(true);
  });
  it("lists missing quarters", () => expect(missingQuarters(["Q1FY2024", "Q3FY2024", "Q4FY2024"])).toContain("Q2FY2024"));
});
