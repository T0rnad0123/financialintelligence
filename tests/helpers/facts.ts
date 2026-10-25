import type { DataPoint, PeriodFacts } from "@/lib/types";
import { deriveFacts } from "@/lib/engine/derive";
import { makeView } from "@/lib/engine/core";

export const dp = (value: number | null): DataPoint => ({ value, status: "reported", confidence: "high", source: { docId: "t", docName: "test.pdf", page: 1, method: "parser" } });

export function facts(obj: Record<string, Record<string, number | null>>): Record<string, PeriodFacts> {
  const out: Record<string, PeriodFacts> = {};
  for (const [p, items] of Object.entries(obj)) {
    out[p] = {};
    for (const [k, v] of Object.entries(items)) out[p][k] = dp(v);
  }
  return out;
}

export const viewOf = (obj: Record<string, Record<string, number | null>>, basis: "consolidated" | "standalone" = "standalone") => makeView(deriveFacts(facts(obj), { basis }));

/** A small, hand-checkable company used across tests. */
export const SIMPLE = {
  FY2023: { revenue: 800, totalExpenses: 700, financeCost: 20, depreciation: 25, otherIncome: 10, pbtBeforeExceptional: 110, pbt: 110, totalTax: 28, pat: 82, materialsCost: 400, purchasesStockInTrade: 0, changesInInventories: 0, tradeReceivables: 80, inventories: 70, tradePayables: 50, totalEquity: 500, totalAssets: 900, totalEquityAndLiabilities: 900, longTermBorrowings: 150, shortTermBorrowings: 50, leaseLiabilities: 0, cash: 30, otherBankBalances: 10, currentInvestments: 0, cfo: 100, capex: 50, totalCurrentAssets: 350, totalCurrentLiabilities: 220, ppe: 400, goodwill: 0, intangibles: 0 },
  FY2024: { revenue: 1000, totalExpenses: 850, financeCost: 20, depreciation: 30, otherIncome: 10, pbtBeforeExceptional: 160, pbt: 160, totalTax: 40, pat: 120, materialsCost: 500, purchasesStockInTrade: 0, changesInInventories: 0, tradeReceivables: 120, inventories: 80, tradePayables: 60, totalEquity: 600, totalAssets: 1000, totalEquityAndLiabilities: 1000, longTermBorrowings: 150, shortTermBorrowings: 50, leaseLiabilities: 0, cash: 40, otherBankBalances: 10, currentInvestments: 0, cfo: 150, capex: 60, totalCurrentAssets: 400, totalCurrentLiabilities: 250, ppe: 420, goodwill: 0, intangibles: 0, dividendsPaid: 20 },
};
