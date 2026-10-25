import { describe, expect, it } from "vitest";
import { matchLineItem, normalizeLabel } from "@/lib/lineItems";

describe("line-item recognition", () => {
  it("strips numbering", () => {
    expect(normalizeLabel("IV. (a) Cost of materials consumed")).toBe("cost of materials consumed");
    expect(normalizeLabel("(1) Current tax")).toBe("current tax");
    expect(normalizeLabel("3 Total income (1+2)")).toBe("total income");
  });
  it.each([
    ["I. Revenue from operations", "revenue"], ["Other Income", "otherIncome"], ["Finance costs", "financeCost"], ["Depreciation and amortisation expense", "depreciation"],
    ["Profit before exceptional items and tax", "pbtBeforeExceptional"], ["Profit before tax", "pbt"], ["Net Profit for the period", "pat"], ["Profit/(loss) for the year", "pat"],
    ["Trade receivables", "tradeReceivables"], ["Cash and cash equivalents", "cash"], ["Total equity", "totalEquity"], ["Net cash generated from operating activities", "cfo"],
    ["Purchase of property, plant and equipment", "capex"], ["Dividends paid", "dividendsPaid"], ["(a) Basic (Rs.)", "epsBasic"], ["Interest earned", "interestEarned"],
  ])("%s -> %s", (label, key) => expect(matchLineItem(label)?.key).toBe(key));
  it("does not confuse comprehensive income with other income", () => expect(matchLineItem("Other comprehensive income")?.key).not.toBe("otherIncome"));
  it("does not map closing cash in cash flow to the balance-sheet cash line", () => expect(matchLineItem("Cash and cash equivalents at the end of the year")?.key).not.toBe("cash"));
});
