import { beforeAll, describe, expect, it } from "vitest";
import { annual, balance, cashflow, quarter } from "../scripts/synthetic-data.mjs";
import { runFixture } from "./helpers/pdf";
import type { ProcessResult } from "@/lib/extraction/processor";

// Ground truth comes from the same generator that produced the synthetic PDFs.
const get = (r: ProcessResult, period: string, item: string) => r.facts.find((f) => f.periodId === period && f.item === item);

describe("annual report extraction (synthetic, ₹ crore)", () => {
  let r: ProcessResult;
  beforeAll(async () => { r = await runFixture("SYNTHETIC_AnnualReport_FY2023-24.pdf", "annual", { declaredFy: 2024 }); });
  it("classifies statements and narrative sections", () => {
    expect(r.meta.status).toBe("success");
    expect(Object.keys(r.meta.statementPages!)).toEqual(expect.arrayContaining(["balance-sheet", "profit-loss", "cash-flow", "auditor-report", "mdna", "chairman"]));
    expect(r.meta.detectedUnits).toEqual(["crore"]);
    expect(r.meta.detectedBases).toEqual(["consolidated"]);
    expect(r.meta.primaryPeriod).toBe("FY2024");
  });
  it("extracts P&L for current and comparative year", () => {
    for (const fy of [2024, 2023]) {
      const a = annual(fy);
      for (const k of ["revenue", "otherIncome", "totalIncome", "materialsCost", "employeeCost", "financeCost", "depreciation", "totalExpenses", "pbt", "currentTax", "deferredTax", "totalTax", "pat"]) {
        expect(get(r, `FY${fy}`, k)?.value, `${k} FY${fy}`).toBeCloseTo(a[k], 2);
      }
      expect(get(r, `FY${fy}`, "epsBasic")?.value).toBeCloseTo(a.eps, 2);
    }
  });
  it("extracts the balance sheet with section-aware borrowings and summed leases", () => {
    const b = balance(2024);
    for (const k of ["ppe", "cwip", "goodwill", "inventories", "tradeReceivables", "cash", "otherBankBalances", "totalCurrentAssets", "totalAssets", "totalEquity", "longTermBorrowings", "shortTermBorrowings", "tradePayables", "totalCurrentLiabilities"]) {
      expect(get(r, "FY2024", k)?.value, k).toBeCloseTo(b[k], 2);
    }
    expect(get(r, "FY2024", "leaseLiabilities")?.value).toBeCloseTo(b.leaseNc + b.leaseC, 2);
    expect(get(r, "FY2024", "nonCurrentInvestments")?.value).toBeCloseTo(b.nonCurrentInvestments, 2);
  });
  it("extracts the cash flow statement with outflows stored positive", () => {
    const c = cashflow(2024);
    expect(get(r, "FY2024", "cfo")?.value).toBeCloseTo(c.cfo, 2);
    expect(get(r, "FY2024", "cfi")?.value).toBeCloseTo(c.cfi, 2);
    expect(get(r, "FY2024", "cff")?.value).toBeCloseTo(c.cff, 2);
    expect(get(r, "FY2024", "capex")?.value).toBeCloseTo(c.capex, 2);
    expect(get(r, "FY2024", "dividendsPaid")?.value).toBeCloseTo(c.dividendsPaid, 2);
    expect(get(r, "FY2024", "cash")?.source.page).toBe(4); // from balance sheet, not the cash flow closing line
  });
  it("keeps source page and printed value for every figure", () => {
    for (const f of r.facts) { expect(f.source.page).toBeGreaterThan(0); expect(f.source.rawValue).toBeTruthy(); }
  });
  it("captures management statements and auditor wording", () => {
    expect(r.excerpts.some((e) => e.category === "expansion" || e.category === "capex")).toBe(true);
    expect(r.strategyCandidates.length).toBeGreaterThan(0);
    expect(r.auditFindings.map((a) => a.key)).toContain("kam");
  });
});

describe("unit normalisation (₹ lakh report)", () => {
  it("converts lakh to crore and detects emphasis of matter", async () => {
    const r = await runFixture("SYNTHETIC_AnnualReport_FY2021-22.pdf", "annual", { declaredFy: 2022 });
    expect(r.meta.detectedUnits).toEqual(["lakh"]);
    expect(get(r, "FY2022", "revenue")?.value).toBeCloseTo(annual(2022).revenue, 2);
    expect(get(r, "FY2022", "revenue")?.source.rawUnit).toBe("₹ lakh");
    expect(get(r, "FY2022", "epsBasic")?.value).toBeCloseTo(annual(2022).eps, 2); // per-share not converted
    expect(r.auditFindings.map((a) => a.key)).toContain("eom");
  });
});

describe("quarterly results extraction", () => {
  it("Q3 layout: quarter, prior quarter, year-ago quarter, 9M (ignored), prior FY", async () => {
    const r = await runFixture("SYNTHETIC_Q3_FY2023-24_Results.pdf", "quarterly");
    expect(r.meta.detectedPeriods).toEqual(["Q3FY2023", "FY2023", "Q2FY2024", "Q3FY2024"]);
    expect(get(r, "Q3FY2024", "revenue")?.value).toBeCloseTo(quarter(2024, 3).revenue, 2);
    expect(get(r, "Q2FY2024", "pat")?.value).toBeCloseTo(quarter(2024, 2).pat, 2);
    expect(get(r, "Q3FY2023", "revenue")?.value).toBeCloseTo(quarter(2023, 3).revenue, 2);
    expect(get(r, "Q3FY2024", "faceValue")?.value).toBe(10);
    expect(r.meta.primaryPeriod).toBe("Q3FY2024");
    expect(r.segments.some((s) => s.segment === "Steel" && s.metric === "revenue" && s.periodId === "Q3FY2024")).toBe(true);
  });
  it("Q4 layout: distinguishes the March quarter from the March year", async () => {
    const r = await runFixture("SYNTHETIC_Q4_FY2023-24_Results.pdf", "quarterly");
    expect(get(r, "Q4FY2024", "revenue")?.value).toBeCloseTo(quarter(2024, 4).revenue, 2);
    expect(get(r, "FY2024", "revenue")?.value).toBeCloseTo(annual(2024).revenue, 2);
  });
  it("multi-quarter PDF yields all quarters", async () => {
    const r = await runFixture("SYNTHETIC_QuarterlyResults_FY2020-21_and_FY2021-22_(8_quarters).pdf", "quarterly");
    for (const q of ["Q1FY2021", "Q2FY2021", "Q3FY2021", "Q4FY2021", "Q1FY2022", "Q2FY2022", "Q3FY2022", "Q4FY2022"]) expect(r.meta.detectedPeriods).toContain(q);
    expect(get(r, "Q3FY2022", "exceptionalItems")?.value).toBeCloseTo(-50, 2);
  });
  it("scanned PDF fails with a precise message, never fabricated figures", async () => {
    const r = await runFixture("SYNTHETIC_scanned_no_text_layer.pdf", "quarterly");
    expect(r.meta.status).toBe("failed"); expect(r.meta.scanned).toBe(true); expect(r.facts).toHaveLength(0);
    expect(r.meta.error).toMatch(/scanned/i);
  });
  it("unknown unit is not silently assumed", async () => {
    const { parseStatementPage, classifyPage } = await import("@/lib/extraction/statementParser");
    const { buildLines } = await import("@/lib/extraction/layout");
    const items = [
      { str: "Statement of Profit and Loss for the year ended 31 March 2024", x: 40, y: 800, w: 300, h: 10 },
      { str: "Particulars", x: 40, y: 780, w: 50, h: 9 }, { str: "31.03.2024", x: 380, y: 780, w: 40, h: 9 }, { str: "31.03.2023", x: 470, y: 780, w: 40, h: 9 },
      { str: "Revenue from operations", x: 40, y: 760, w: 120, h: 9 }, { str: "1,000.00", x: 385, y: 760, w: 35, h: 9 }, { str: "900.00", x: 478, y: 760, w: 30, h: 9 },
    ];
    const lines = buildLines(items);
    const res = parseStatementPage(lines, classifyPage(lines, ""), { docId: "d", docName: "d", docKind: "annual", fyEndMonth: 3, unit: null, basis: "standalone", pageNumber: 1, method: "parser" });
    expect(res.facts).toHaveLength(0);
    expect(res.warnings.join(" ")).toMatch(/unit/i);
    const ok = parseStatementPage(lines, classifyPage(lines, ""), { docId: "d", docName: "d", docKind: "annual", fyEndMonth: 3, unit: "crore", basis: "standalone", pageNumber: 1, method: "parser" });
    expect(ok.facts.map((f) => `${f.periodId}=${f.value}`).sort()).toEqual(["FY2023=900", "FY2024=1000"]);
  });
  it("a document-level unit override takes precedence", async () => {
    const r = await runFixture("SYNTHETIC_Q1_FY2023-24_Results.pdf", "quarterly", { unitOverride: "lakh" });
    expect(get(r, "Q1FY2024", "revenue")?.value).toBeCloseTo(quarter(2024, 1).revenue / 100, 4);
  });
  it("rejects non-PDF bytes", async () => {
    const { processPdf } = await import("@/lib/extraction/processor");
    const { loadPdfjs, meta } = await import("./helpers/pdf");
    await expect(processPdf(new TextEncoder().encode("not a pdf"), meta("x.pdf", "annual"), { pdfjs: await loadPdfjs(), fyEndMonth: 3, defaultBasis: "consolidated" })).rejects.toThrow(/PDF/);
  });
});
