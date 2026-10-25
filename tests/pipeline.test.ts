import { beforeAll, describe, expect, it } from "vitest";
import { annual, balance } from "../scripts/synthetic-data.mjs";
import { buildSyntheticProject } from "./helpers/pipeline";
import { analyze, type Analysis } from "@/lib/engine/analyze";

describe("end-to-end on synthetic documents", () => {
  let a: Analysis;
  beforeAll(async () => {
    const { project, docs } = await buildSyntheticProject();
    project.price = 1500;
    a = analyze(project, docs);
  }, 120000);
  it("assembles 5 financial years and 20 quarters", () => { expect(a.fys).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024"]); expect(a.quarters).toHaveLength(20); });
  it("calculations match ground truth", () => {
    const A = annual(2024), A0 = annual(2023), B = balance(2024), B0 = balance(2023);
    expect(a.annual.revenueGrowth.byPeriod.FY2024.value).toBeCloseTo((A.revenue / A0.revenue - 1) * 100, 6);
    expect(a.annual.ebitdaMargin.byPeriod.FY2024.value).toBeCloseTo(19, 6);
    expect(a.annual.roe.byPeriod.FY2024.value).toBeCloseTo((A.pat / ((B.totalEquity + B0.totalEquity) / 2)) * 100, 4);
    expect(a.growth.revenue.cagr3.value).toBeCloseTo((Math.pow(16200 / 11500, 1 / 3) - 1) * 100, 6);
  });
  it("quarters reconcile with annual figures", () => a.recon.filter((r) => r.item === "revenue" && r.difference !== null).forEach((r) => expect(Math.abs(r.difference!)).toBeLessThan(0.05)));
  it("derives share count from paid-up capital ÷ face value", () => expect(a.shares.basic).toBeCloseTo(100_000_000));
  it("valuation uses only the entered price", () => { expect(a.valuation.marketCap).toBeCloseTo(15000); expect(a.valuation.multiples.find((m) => m.key === "pe")!.value).toBeCloseTo(1500 / annual(2024).eps, 2); });
  it("no metric value is NaN or infinite; non-ok metrics carry a reason", () => {
    for (const s of Object.values(a.annual)) for (const r of Object.values(s.byPeriod)) {
      if (r.value !== null) expect(Number.isFinite(r.value)).toBe(true);
      else expect(r.reason).toBeTruthy();
    }
  });
  it("data quality is high on consistent synthetic data", () => { expect(a.dq.issues.filter((i) => i.level === "error")).toHaveLength(0); expect(a.dq.score).toBeGreaterThan(85); });
  it("findings carry supporting evidence", () => a.findings.filter((f) => f.kind === "positive").forEach((f) => expect(f.evidence.length).toBeGreaterThan(0)));
  it("projections and scores are produced", () => { expect(a.projections.base.rows).toHaveLength(5); expect(a.scores.financialHealth.score).not.toBeNull(); });
});
