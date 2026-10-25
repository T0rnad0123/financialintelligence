import { describe, expect, it } from "vitest";
import { classify, dividendDiscount, enterpriseValue, equityFromEv, marginOfSafety, marketCapCrore, perShareFromEv, residualIncome, reverseDcf, runDcf, sensitivityGrid, solve, validateDcf, type DcfParams, defaultValuationSettings, runValuation } from "@/lib/engine/valuation";
import { viewOf, SIMPLE } from "./helpers/facts";

const BASE: DcfParams = { baseRevenue: 100, years: 3, revenueGrowthStart: 10, revenueGrowthEnd: 10, ebitMarginStart: 20, ebitMarginEnd: 20, taxRate: 25, daPctRevenue: 5, capexPctRevenue: 5, nwcPctIncrementalRevenue: 0, wacc: 10, terminalGrowth: 2, midYear: false };
const BRIDGE = { debt: 30, leases: 0, minorityInterest: 0, otherDebtLike: 0, cash: 16.25, nonOperatingAssets: 0 };

describe("market cap & EV", () => {
  it("market cap in crore", () => expect(marketCapCrore(1500, 100_000_000).value).toBeCloseTo(15000));
  it("rejects invalid price / shares", () => {
    expect(marketCapCrore(null, 1e8).value).toBeNull();
    expect(marketCapCrore(-5, 1e8).value).toBeNull();
    expect(marketCapCrore(100, 0).value).toBeNull();
    expect(marketCapCrore(100, null).reason).toMatch(/Share count/);
  });
  it("EV bridge round-trips", () => {
    const b = { debt: 500, leases: 50, minorityInterest: 20, otherDebtLike: 10, cash: 200, nonOperatingAssets: 30 };
    const ev = enterpriseValue({ equityValue: 1000, ...b });
    expect(ev).toBe(1350);
    expect(equityFromEv(ev, b)).toBe(1000);
  });
});

describe("DCF (hand-computed)", () => {
  const r = runDcf(BASE);
  it("FCFF and PV per year", () => {
    expect(r.rows.map((x) => x.fcff)).toEqual([expect.closeTo(16.5, 6), expect.closeTo(18.15, 6), expect.closeTo(19.965, 6)]);
    r.rows.forEach((x) => expect(x.pv).toBeCloseTo(15, 6));
  });
  it("terminal value and EV", () => {
    expect(r.terminalValue).toBeCloseTo(254.55375, 6);
    expect(r.pvTerminal).toBeCloseTo(191.25, 6);
    expect(r.enterpriseValue).toBeCloseTo(236.25, 6);
  });
  it("fair value per share and upside", () => {
    const ps = perShareFromEv(r.enterpriseValue, BRIDGE, 10_000_000, 200); // equity 222.5 cr, 1 crore shares
    expect(ps.equity).toBeCloseTo(222.5, 6);
    expect(ps.perShare).toBeCloseTo(222.5, 6);
    expect(ps.upside).toBeCloseTo(11.25, 6);
  });
  it("terminal growth >= WACC is rejected", () => {
    expect(validateDcf({ ...BASE, terminalGrowth: 10 }).ok).toBe(false);
    expect(validateDcf({ ...BASE, terminalGrowth: 12 }).errors[0]).toMatch(/below WACC/);
    expect(runDcf({ ...BASE, terminalGrowth: 10 }).rows).toHaveLength(0);
  });
  it("flags extreme assumptions", () => {
    expect(validateDcf({ ...BASE, wacc: 30 }).warnings.join(" ")).toMatch(/very high/);
    expect(validateDcf({ ...BASE, revenueGrowthStart: 45 }).warnings.length).toBeGreaterThan(0);
    expect(validateDcf({ ...BASE, baseRevenue: NaN }).ok).toBe(false);
  });
  it("mid-year discounting increases value", () => expect(runDcf({ ...BASE, midYear: true }).enterpriseValue).toBeGreaterThan(r.enterpriseValue));
});

describe("sensitivity & reverse DCF", () => {
  it("grid is monotonic in WACC and marks invalid cells", () => {
    const g = sensitivityGrid(BASE, BRIDGE, 1e7, 200, [8, 10, 12], [1, 2, 13]);
    expect(g[0][1].value!).toBeGreaterThan(g[1][1].value!);
    expect(g[1][1].value!).toBeGreaterThan(g[2][1].value!);
    expect(g[1][2].value).toBeNull();
    expect(g[1][1].value).toBeCloseTo(222.5, 6);
  });
  it("solver finds roots", () => expect(solve((x) => x * x, 9, 0, 10)).toBeCloseTo(3, 4));
  it("reverse DCF recovers the growth used to set the price", () => {
    const r = reverseDcf(BASE, BRIDGE, 1e7, 222.5);
    expect(r.impliedGrowth).toBeCloseTo(10, 2);
    expect(r.impliedMargin).toBeCloseTo(20, 2);
  });
});

describe("DDM, residual income, margin of safety", () => {
  it("two-stage DDM with equal growth equals Gordon", () => expect(dividendDiscount(10, 5, 5, 5, 10, 40).value).toBeCloseTo(210, 6));
  it("DDM rejects g >= ke and zero dividends", () => {
    expect(dividendDiscount(10, 5, 5, 10, 10, 40).check.ok).toBe(false);
    expect(dividendDiscount(0, 5, 5, 3, 10, 40).check.ok).toBe(false);
  });
  it("residual income", () => {
    expect(residualIncome(100, 15, 100, 10, 1, 0).value).toBeCloseTo(150, 6);
    expect(residualIncome(100, 10, 50, 10, 5, 2).value).toBeCloseTo(100, 6); // ROE = ke → value = book
    expect(residualIncome(100, null, 50, 10, 5, 2).check.ok).toBe(false);
  });
  it("margin of safety & classification", () => {
    expect(marginOfSafety(200, 150)).toBeCloseTo(25);
    expect(classify(200, 150, 20, 20)).toBe("Potentially undervalued");
    expect(classify(200, 250, 20, 20)).toBe("Potentially overvalued");
    expect(classify(200, 190, 20, 20)).toBe("Approximately fairly valued");
    expect(classify(null, 190, 20, 20)).toBe("Insufficient data for a reliable conclusion");
  });
});

describe("full valuation assembly", () => {
  const view = viewOf({ ...SIMPLE, FY2024: { ...SIMPLE.FY2024, epsDiluted: 12 } });
  const base = { view, fys: ["FY2023", "FY2024"], ttm: null, sector: "manufacturing" as const, price: 120, sharesBasic: 100_000_000, sharesDiluted: null, settings: defaultValuationSettings(), roeHistory: [20], payoutHistory: [16], epsCagr3: null };
  it("computes multiples from the entered price only", () => {
    const v = runValuation(base);
    expect(v.marketCap).toBeCloseTo(1200);
    expect(v.multiples.find((m) => m.key === "pe")!.value).toBeCloseTo(10);
    expect(v.multiples.find((m) => m.key === "pb")!.value).toBeCloseTo(2);
    expect(v.ev).toBeCloseTo(1200 + 200 + 0 - 50); // leases 0, cash+bank 50
    expect(v.multiples.find((m) => m.key === "evEbitda")!.value).toBeCloseTo(1350 / 200);
    expect(v.multiples.find((m) => m.key === "peg")!.status).toBe("insufficient-data");
  });
  it("negative EPS makes P/E not meaningful", () => {
    const v = runValuation({ ...base, view: viewOf({ ...SIMPLE, FY2024: { ...SIMPLE.FY2024, epsDiluted: -3 } }) });
    expect(v.multiples.find((m) => m.key === "pe")!.status).toBe("not-meaningful");
  });
  it("missing price produces no market-based outputs", () => {
    const v = runValuation({ ...base, price: null });
    expect(v.marketCap).toBeNull(); expect(v.verdict).toBe("Insufficient data for a reliable conclusion");
  });
  it("banks: EV multiples and FCFF DCF not applicable", () => {
    const v = runValuation({ ...base, sector: "bank" });
    expect(v.multiples.find((m) => m.key === "evEbitda")!.status).toBe("not-applicable");
    expect(v.dcfApplicable).toBe(false);
    expect(v.methods.find((m) => m.key === "dcf")!.applicable).toBe(false);
  });
  it("weighted conclusion only uses weighted methods", () => {
    const s = { ...defaultValuationSettings(), methodWeights: { dcf: 0, earnings: 0, residualIncome: 0, ddm: 0, asset: 1 } };
    const v = runValuation({ ...base, settings: s });
    expect(v.weighted).toBeCloseTo(60); // book value 600 cr / 10 cr shares
  });
});
