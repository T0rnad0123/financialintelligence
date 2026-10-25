import { describe, expect, it } from "vitest";
import { detectUnit, findDates, fyOf, parseNumber, parsePeriodId, quarterOf, quarterPeriod, sortPeriodIds, toCrore, isNumericToken } from "@/lib/extraction/parseUtils";

describe("Indian number parsing", () => {
  it("parses lakh-style grouping", () => expect(parseNumber("1,23,456.78")!.value).toBeCloseTo(123456.78));
  it("parses parentheses as negative", () => expect(parseNumber("(1,234.50)")!.value).toBe(-1234.5));
  it("parses leading minus", () => expect(parseNumber("-45.2")!.value).toBe(-45.2));
  it("treats a dash as reported nil (not missing)", () => { const r = parseNumber("-")!; expect(r.value).toBe(0); expect(r.nil).toBe(true); });
  it("rejects text", () => expect(parseNumber("abc")).toBeNull());
  it("recognises numeric tokens", () => { expect(isNumericToken("12,345.00")).toBe(true); expect(isNumericToken("Revenue")).toBe(false); });
});

describe("unit detection and conversion", () => {
  it.each([
    ["(₹ in crore)", "crore"], ["(Rs. in lakhs)", "lakh"], ["All amounts in INR million", "million"], ["Amount in ₹ Lakhs", "lakh"], ["(Rs in Crores)", "crore"], ["₹ in thousands", "thousand"],
  ])("%s -> %s", (t, u) => expect(detectUnit(t)).toBe(u));
  it("returns null when no unit", () => expect(detectUnit("Balance sheet as at 31 March 2024")).toBeNull());
  it("converts to crore", () => {
    expect(toCrore(100, "lakh")).toBeCloseTo(1);
    expect(toCrore(10, "million")).toBeCloseTo(1);
    expect(toCrore(1, "billion")).toBeCloseTo(100);
    expect(toCrore(1e7, "rupees")).toBeCloseTo(1);
    expect(toCrore(10000, "thousand")).toBeCloseTo(1);
  });
});

describe("dates and Indian financial periods", () => {
  it("finds several date formats", () => {
    const d = findDates("31.03.2024 | 31st March, 2023 | March 31, 2022 | 30-Jun-24");
    expect(d.map((x) => `${x.year}-${x.month}`)).toEqual(["2024-3", "2023-3", "2022-3", "2024-6"]);
  });
  it("finds FY labels", () => expect(findDates("FY 2023-24")[0]).toMatchObject({ year: 2024, form: "fy" }));
  it("maps April–March quarters", () => {
    expect(quarterOf(6)).toBe(1); expect(quarterOf(9)).toBe(2); expect(quarterOf(12)).toBe(3); expect(quarterOf(3)).toBe(4);
    expect(fyOf(2023, 6)).toBe(2024); expect(fyOf(2024, 3)).toBe(2024);
  });
  it("labels periods Indian style", () => {
    expect(quarterPeriod(1, 2025).label).toBe("Q1 FY2024-25");
    expect(quarterPeriod(1, 2025).endDate).toBe("2024-06-30");
    expect(parsePeriodId("FY2024")!.label).toBe("FY2023-24");
  });
  it("sorts periods chronologically with FY after Q4", () => expect(sortPeriodIds(["FY2024", "Q4FY2024", "Q1FY2024", "FY2023"])).toEqual(["FY2023", "Q1FY2024", "Q4FY2024", "FY2024"]));
});
