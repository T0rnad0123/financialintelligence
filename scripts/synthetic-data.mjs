// SYNTHETIC financial data for a fictional company used for testing only.
// "Simulated Steel & Power Ltd" does not exist. All figures are invented.
// Values in Rs. crore unless noted.

const r2 = (x) => Math.round(x * 100) / 100;

export const COMPANY = "Simulated Steel & Power Ltd";
export const SHARES = 100_000_000; // 10 crore shares of Rs 10 each => share capital Rs 100 crore
export const FACE_VALUE = 10;

const REV = { 2020: 10000, 2021: 11500, 2022: 13800, 2023: 15000, 2024: 16200 };
const DEP = { 2020: 500, 2021: 540, 2022: 600, 2023: 680, 2024: 760 };
const FIN = { 2020: 300, 2021: 290, 2022: 320, 2023: 360, 2024: 340 };
const OI = { 2020: 80, 2021: 90, 2022: 120, 2023: 100, 2024: 150 };
const EXC = { 2020: 0, 2021: 0, 2022: -50, 2023: 0, 2024: 0 };
const MAT = { 2020: 0.55, 2021: 0.56, 2022: 0.57, 2023: 0.555, 2024: 0.55 };
const DPS = { 2020: 3, 2021: 3.5, 2022: 4, 2023: 4, 2024: 5 };
const CAPEX = { 2020: 700, 2021: 900, 2022: 1400, 2023: 1600, 2024: 1100 };
const LTB = { 2020: 2600, 2021: 2500, 2022: 3000, 2023: 3300, 2024: 2900 };
const STB = { 2020: 600, 2021: 550, 2022: 700, 2023: 800, 2024: 650 };
const CASH = { 2020: 400, 2021: 520, 2022: 380, 2023: 450, 2024: 700 };

export function annual(fy) {
  const revenue = REV[fy];
  const materialsCost = r2(revenue * MAT[fy]);
  const employeeCost = r2(revenue * 0.08);
  const powerFuel = r2(revenue * 0.06);
  const otherExpenses = r2(revenue * 0.12);
  const depreciation = DEP[fy];
  const financeCost = FIN[fy];
  const otherIncome = OI[fy];
  const totalIncome = r2(revenue + otherIncome);
  const totalExpenses = r2(materialsCost + employeeCost + powerFuel + otherExpenses + depreciation + financeCost);
  const pbtBeforeExceptional = r2(totalIncome - totalExpenses);
  const exceptionalItems = EXC[fy];
  const pbt = r2(pbtBeforeExceptional + exceptionalItems);
  const currentTax = r2(pbt * 0.22);
  const deferredTax = r2(pbt * 0.032);
  const totalTax = r2(currentTax + deferredTax);
  const pat = r2(pbt - totalTax);
  const eps = r2((pat * 1e7) / SHARES);
  return { fy, revenue, otherIncome, totalIncome, materialsCost, employeeCost, powerFuel, otherExpenses, depreciation, financeCost, totalExpenses, pbtBeforeExceptional, exceptionalItems, pbt, currentTax, deferredTax, totalTax, pat, eps, dps: DPS[fy] };
}

const OPENING_OTHER_EQUITY_2019 = 5200;
const PPE_2019 = 6500;

export function balance(fy) {
  // roll-forward equity and PPE from 2019
  let otherEquity = OPENING_OTHER_EQUITY_2019;
  let ppe = PPE_2019;
  for (let y = 2020; y <= fy; y++) {
    const a = annual(y);
    const prevDps = y === 2020 ? 2.5 : DPS[y - 1];
    otherEquity = r2(otherEquity + a.pat - (prevDps * SHARES) / 1e7);
    ppe = r2(ppe + CAPEX[y] * 0.85 - DEP[y]);
  }
  const a = annual(fy);
  const cwip = r2(CAPEX[fy] * 0.4);
  const goodwill = 200;
  const intangibles = 150;
  const nonCurrentInvestments = 300;
  const otherNonCurrentAssets = 250;
  const totalNonCurrentAssets = r2(ppe + cwip + goodwill + intangibles + nonCurrentInvestments + otherNonCurrentAssets);
  const inventories = r2((a.materialsCost * 60) / 365);
  const tradeReceivables = r2((a.revenue * (40 + (fy - 2020) * 2)) / 365);
  const cash = CASH[fy];
  const otherBankBalances = 50;
  const shareCapital = 100;
  const totalEquity = r2(shareCapital + otherEquity);
  const longTermBorrowings = LTB[fy];
  const leaseNc = 80;
  const otherNcl = 220;
  const totalNonCurrentLiabilities = r2(longTermBorrowings + leaseNc + otherNcl);
  const shortTermBorrowings = STB[fy];
  const leaseC = 20;
  const tradePayables = r2((a.materialsCost * 55) / 365);
  const otherCl = 600;
  const totalCurrentLiabilities = r2(shortTermBorrowings + leaseC + tradePayables + otherCl);
  const totalEquityAndLiabilities = r2(totalEquity + totalNonCurrentLiabilities + totalCurrentLiabilities);
  // plug: other current assets
  const otherCurrentAssets = r2(totalEquityAndLiabilities - totalNonCurrentAssets - inventories - tradeReceivables - cash - otherBankBalances);
  const totalCurrentAssets = r2(inventories + tradeReceivables + cash + otherBankBalances + otherCurrentAssets);
  const totalAssets = r2(totalNonCurrentAssets + totalCurrentAssets);
  return {
    fy, ppe, cwip, goodwill, intangibles, nonCurrentInvestments, otherNonCurrentAssets, totalNonCurrentAssets,
    inventories, tradeReceivables, cash, otherBankBalances, otherCurrentAssets, totalCurrentAssets, totalAssets,
    shareCapital, otherEquity, totalEquity, longTermBorrowings, leaseNc, otherNcl, totalNonCurrentLiabilities,
    shortTermBorrowings, leaseC, tradePayables, otherCl, totalCurrentLiabilities, totalEquityAndLiabilities,
  };
}

export function cashflow(fy) {
  const a = annual(fy);
  const b = balance(fy);
  const pb = balance(fy - 1);
  const capex = CAPEX[fy];
  const dividendsPaid = r2(((fy === 2020 ? 2.5 : DPS[fy - 1]) * SHARES) / 1e7);
  const netChangeInCash = r2(b.cash - pb.cash);
  const wcChange = r2(b.inventories - pb.inventories + (b.tradeReceivables - pb.tradeReceivables) - (b.tradePayables - pb.tradePayables));
  const cfo = r2(a.pbt + a.depreciation + a.financeCost - a.otherIncome - wcChange - a.currentTax);
  const cfi = r2(-capex + a.otherIncome + 20);
  const cff = r2(netChangeInCash - cfo - cfi);
  const borrowingsProceeds = r2(Math.max(0, b.longTermBorrowings - pb.longTermBorrowings) + 400);
  const borrowingsRepayment = 400;
  return { fy, cfo, cfi, cff, capex, ppeSaleProceeds: 20, dividendsPaid, interestPaid: a.financeCost, borrowingsProceeds, borrowingsRepayment, netChangeInCash, openingCash: pb.cash, closingCash: b.cash };
}

const SEASON = [0.23, 0.24, 0.25, 0.28];

export function quarter(fy, q) {
  const a = annual(fy);
  const w = SEASON[q - 1];
  const keys = ["revenue", "otherIncome", "materialsCost", "employeeCost", "powerFuel", "otherExpenses", "depreciation", "financeCost"];
  const out = { fy, q };
  for (const k of keys) {
    if (q < 4) out[k] = r2(a[k] * (k === "depreciation" || k === "financeCost" || k === "employeeCost" ? 0.25 : w));
    else {
      let s = 0;
      for (let i = 1; i <= 3; i++) s += quarter(fy, i)[k];
      out[k] = r2(a[k] - s);
    }
  }
  out.exceptionalItems = fy === 2022 && q === 3 ? -50 : 0;
  out.totalIncome = r2(out.revenue + out.otherIncome);
  out.totalExpenses = r2(out.materialsCost + out.employeeCost + out.powerFuel + out.otherExpenses + out.depreciation + out.financeCost);
  out.pbtBeforeExceptional = r2(out.totalIncome - out.totalExpenses);
  out.pbt = r2(out.pbtBeforeExceptional + out.exceptionalItems);
  out.currentTax = r2(out.pbt * 0.22);
  out.deferredTax = r2(out.pbt * 0.032);
  out.totalTax = r2(out.currentTax + out.deferredTax);
  out.pat = r2(out.pbt - out.totalTax);
  out.eps = r2((out.pat * 1e7) / SHARES);
  // segments: Steel 80%, Power 20% of revenue
  out.segSteel = r2(out.revenue * 0.8);
  out.segPower = r2(out.revenue - out.segSteel);
  out.segSteelResult = r2(out.segSteel * 0.14);
  out.segPowerResult = r2(out.segPower * 0.22);
  return out;
}

export function ytd(fy, q) {
  const out = {};
  for (let i = 1; i <= q; i++) {
    const x = quarter(fy, i);
    for (const [k, v] of Object.entries(x)) if (typeof v === "number" && k !== "fy" && k !== "q") out[k] = r2((out[k] ?? 0) + v);
  }
  return out;
}
