import { describe, expect, it } from "vitest";
import { altman, beneish } from "@/lib/engine/forensics";
import { viewOf, SIMPLE } from "./helpers/facts";

const same = { revenue: 1000, tradeReceivables: 100, materialsCost: 600, purchasesStockInTrade: 0, changesInInventories: 0, totalCurrentAssets: 400, ppe: 300, nonCurrentInvestments: 50, currentInvestments: 50, totalAssets: 1000, depreciation: 30, sgaExpense: 100, totalCurrentLiabilities: 200, longTermBorrowings: 100, pat: 80, cfo: 80 };

describe("Beneish M-Score", () => {
  it("is not computed when SG&A is missing (no invented inputs)", () => {
    const r = beneish(viewOf(SIMPLE), ["FY2023", "FY2024"], "manufacturing", false);
    expect(r.computed).toBe(false); expect(r.missing.join(" ")).toMatch(/SG&A/);
  });
  it("equals the intercept + weights when all indices are 1 and accruals are 0", () => {
    const r = beneish(viewOf({ FY2023: same, FY2024: same }), ["FY2023", "FY2024"], "manufacturing", false);
    expect(r.computed).toBe(true);
    expect(r.value).toBeCloseTo(-4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 - 0.327, 6);
  });
  it("is not applicable to banks", () => expect(beneish(viewOf({ FY2023: same, FY2024: same }), ["FY2023", "FY2024"], "bank", false).applicable).toBe(false));
});

describe("Altman Z", () => {
  it("requires retained earnings unless the disclosed proxy is enabled", () => {
    const v = viewOf(SIMPLE);
    expect(altman(v, ["FY2023", "FY2024"], "manufacturing", 1000, false)[0].computed).toBe(false);
    const withProxy = altman(viewOf({ ...SIMPLE, FY2024: { ...SIMPLE.FY2024, otherEquity: 500, totalLiabilities: 400 } }), ["FY2023", "FY2024"], "manufacturing", 1000, true)[0];
    expect(withProxy.computed).toBe(true);
    // Z'' = 6.56*(150/1000) + 3.26*(500/1000) + 6.72*(170/1000) + 1.05*(600/400)
    expect(withProxy.value).toBeCloseTo(6.56 * 0.15 + 3.26 * 0.5 + 6.72 * 0.17 + 1.05 * 1.5, 6);
  });
  it("is not applicable to financial institutions", () => expect(altman(viewOf(SIMPLE), ["FY2024"], "nbfc", 1000, true).every((m) => !m.computed)).toBe(true));
});
