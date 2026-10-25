import { describe, expect, it } from "vitest";
import { cagr, growthRate, ratio, item, average, makeView } from "@/lib/engine/core";
import { ANNUAL_METRICS_BY_KEY, type EngineSettings } from "@/lib/engine/metrics";
import { viewOf, SIMPLE, facts } from "./helpers/facts";

const S: EngineSettings = { includeLeasesInDebt: false, includeCurrentInvestmentsInCash: false, wacc: 10, sector: "manufacturing" };
const v = viewOf(SIMPLE);
const m = (k: string, p = "FY2024", s = S) => ANNUAL_METRICS_BY_KEY[k].compute(v, p, s);

describe("core helpers", () => {
  it("growth", () => { expect(growthRate(125, 100).value).toBeCloseTo(25); expect(growthRate(5, 0).value).toBeNull(); expect(growthRate(5, -2).value).toBeNull(); expect(growthRate(null, 2).value).toBeNull(); });
  it("CAGR", () => { expect(cagr(133.1, 100, 3).value).toBeCloseTo(10, 6); expect(cagr(100, -5, 3).value).toBeNull(); expect(cagr(100, 50, 0).value).toBeNull(); });
  it("ratio never divides by zero", () => {
    const zero = makeView(facts({ FY2024: { a: 5, b: 0 } }));
    const r = ratio(item(zero, "FY2024", "a"), item(zero, "FY2024", "b"), { key: "x", name: "x", unit: "x", formula: "", periodId: "FY2024" });
    expect(r.value).toBeNull(); expect(r.status).toBe("not-meaningful");
  });
  it("missing data is never zero", () => {
    const r = ratio(item(v, "FY2024", "doesNotExist"), item(v, "FY2024", "revenue"), { key: "x", name: "x", unit: "pct", formula: "", periodId: "FY2024" });
    expect(r.value).toBeNull(); expect(r.status).toBe("insufficient-data"); expect(r.reason).toContain("Missing");
  });
  it("average falls back to closing with a disclosed note", () => {
    const a = average("x", item(v, "FY2023", "totalAssets"), item(v, "FY2022", "totalAssets"));
    expect(a.value).toBe(900); expect(a.notes.join(" ")).toContain("closing balance");
  });
});

describe("hand-checked metrics (FY2024)", () => {
  it("EBITDA and margins", () => {
    expect(m("ebitda").value).toBeCloseTo(200); // 1000 − (850 − 20 − 30)
    expect(m("ebitdaMargin").value).toBeCloseTo(20);
    expect(m("ebit").value).toBeCloseTo(170);
    expect(m("patMargin").value).toBeCloseTo(12);
    expect(m("grossMargin").value).toBeCloseTo(50);
    expect(m("effectiveTaxRate").value).toBeCloseTo(25);
  });
  it("growth", () => { expect(m("revenueGrowth").value).toBeCloseTo(25); expect(m("revenueGrowth", "FY2023").status).toBe("insufficient-data"); });
  it("returns on average balances", () => {
    expect(m("roe").value).toBeCloseTo((120 / 550) * 100, 6);
    expect(m("roa").value).toBeCloseTo((120 / 950) * 100, 6);
    expect(m("roce").value).toBeCloseTo((180 / ((800 + 700) / 2)) * 100, 6); // PBIT 160+20; CE = equity + debt
    expect(m("assetTurnover").value).toBeCloseTo(1000 / 950, 6);
  });
  it("working capital days", () => {
    expect(m("receivableDays").value).toBeCloseTo(36.5);
    expect(m("inventoryDays").value).toBeCloseTo(54.75);
    expect(m("payableDays").value).toBeCloseTo(40.15);
    expect(m("ccc").value).toBeCloseTo(36.5 + 54.75 - 40.15);
  });
  it("cash flow & leverage", () => {
    expect(m("fcf").value).toBeCloseTo(90);
    expect(m("ocfToPat").value).toBeCloseTo(1.25);
    expect(m("totalDebt").value).toBeCloseTo(200);
    expect(m("netDebt").value).toBeCloseTo(150);
    expect(m("netDebtToEbitda").value).toBeCloseTo(0.75);
    expect(m("debtToEquity").value).toBeCloseTo(200 / 600);
    expect(m("interestCoverage").value).toBeCloseTo(9);
    expect(m("currentRatio").value).toBeCloseTo(1.6);
    expect(m("quickRatio").value).toBeCloseTo((400 - 80) / 250);
  });
  it("DuPont identity holds", () => {
    const prod = (m("dupontNpm").value! / 100) * m("dupontAt").value! * m("dupontEm").value!;
    expect(prod * 100).toBeCloseTo(m("roe").value!, 6);
  });
  it("EVA uses WACC assumption and is N/A without it", () => {
    expect(m("eva").value).not.toBeNull();
    expect(m("eva", "FY2024", { ...S, wacc: null }).status).toBe("not-applicable");
  });
});

describe("edge cases", () => {
  it("negative PAT: OCF/PAT and P/E-like ratios not meaningful", () => {
    const vv = viewOf({ FY2024: { ...SIMPLE.FY2024, pat: -50, pbt: -40, totalTax: 10 } });
    const r = ANNUAL_METRICS_BY_KEY.ocfToPat.compute(vv, "FY2024", S);
    expect(r.status).toBe("not-meaningful"); expect(r.value).toBeNull();
    expect(ANNUAL_METRICS_BY_KEY.effectiveTaxRate.compute(vv, "FY2024", S).status).toBe("not-meaningful");
  });
  it("negative EBITDA: net debt/EBITDA not meaningful", () => {
    const vv = viewOf({ FY2024: { ...SIMPLE.FY2024, totalExpenses: 1100 } });
    expect(ANNUAL_METRICS_BY_KEY.ebitda.compute(vv, "FY2024", S).value).toBeCloseTo(-50);
    expect(ANNUAL_METRICS_BY_KEY.netDebtToEbitda.compute(vv, "FY2024", S).status).toBe("not-meaningful");
  });
  it("zero debt and zero cash work without errors", () => {
    const vv = viewOf({ FY2024: { ...SIMPLE.FY2024, longTermBorrowings: 0, shortTermBorrowings: 0, cash: 0, otherBankBalances: 0, financeCost: 0 } });
    expect(ANNUAL_METRICS_BY_KEY.netDebt.compute(vv, "FY2024", S).value).toBe(0);
    expect(ANNUAL_METRICS_BY_KEY.debtToEquity.compute(vv, "FY2024", S).value).toBe(0);
    expect(ANNUAL_METRICS_BY_KEY.interestCoverage.compute(vv, "FY2024", S).status).toBe("not-applicable");
    expect(ANNUAL_METRICS_BY_KEY.cashRatio.compute(vv, "FY2024", S).value).toBe(0);
  });
  it("negative free cash flow", () => {
    const vv = viewOf({ FY2024: { ...SIMPLE.FY2024, capex: 400 } });
    expect(ANNUAL_METRICS_BY_KEY.fcf.compute(vv, "FY2024", S).value).toBeCloseTo(-250);
    expect(ANNUAL_METRICS_BY_KEY.dividendsToFcf.compute(vv, "FY2024", S).status).toBe("not-meaningful");
  });
  it("missing financial year leaves growth undefined, not zero", () => {
    const vv = viewOf({ FY2022: SIMPLE.FY2023, FY2024: SIMPLE.FY2024 });
    expect(ANNUAL_METRICS_BY_KEY.revenueGrowth.compute(vv, "FY2024", S).value).toBeNull();
  });
  it("banks: industrial metrics are not applicable, bank metrics computed", () => {
    const vv = viewOf({ FY2024: { interestEarned: 1000, interestExpended: 600, otherIncome: 100, operatingExpensesBank: 250, advances: 8000, deposits: 10000, totalAssets: 12000, pat: 150, revenue: 1100 } });
    const B: EngineSettings = { ...S, sector: "bank" };
    expect(ANNUAL_METRICS_BY_KEY.ebitda.compute(vv, "FY2024", B).status).toBe("not-applicable");
    expect(ANNUAL_METRICS_BY_KEY.nii.compute(vv, "FY2024", B).value).toBe(400);
    expect(ANNUAL_METRICS_BY_KEY.costToIncome.compute(vv, "FY2024", B).value).toBeCloseTo(50);
    expect(ANNUAL_METRICS_BY_KEY.creditDeposit.compute(vv, "FY2024", B).value).toBeCloseTo(80);
  });
});
