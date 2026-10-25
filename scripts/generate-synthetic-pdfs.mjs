// Generates SYNTHETIC annual reports and quarterly results PDFs for a fictional
// company ("Simulated Steel & Power Ltd") into fixtures/synthetic/.
// Every page carries a "SYNTHETIC TEST DATA" banner. Used by tests and for
// trying the app without real reports.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { annual, balance, cashflow, quarter, ytd, COMPANY, FACE_VALUE } from "./synthetic-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "synthetic");
mkdirSync(outDir, { recursive: true });

const fmt = (v, mult = 1) => {
  if (v === 0) return "-";
  const x = v * mult;
  const s = Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `(${s})` : s;
};
const fyl = (fy) => `${fy - 1}-${String(fy).slice(2)}`;

class Writer {
  constructor(doc, fonts) {
    this.doc = doc;
    this.f = fonts;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([595, 842]);
    this.y = 800;
    this.page.drawText("SYNTHETIC TEST DATA - FICTIONAL COMPANY - NOT REAL FINANCIAL INFORMATION", { x: 40, y: 822, size: 7, font: this.f.bold, color: rgb(0.7, 0.1, 0.1) });
  }
  text(s, { x = 40, size = 9, bold = false } = {}) {
    this.page.drawText(s, { x, y: this.y, size, font: bold ? this.f.bold : this.f.reg });
  }
  right(s, xRight, { size = 8.5, bold = false } = {}) {
    const font = bold ? this.f.bold : this.f.reg;
    const w = font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: xRight - w, y: this.y, size, font });
  }
  center(s, xc, { size = 8.5, bold = false } = {}) {
    const font = bold ? this.f.bold : this.f.reg;
    const w = font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: xc - w / 2, y: this.y, size, font });
  }
  nl(d = 13) {
    this.y -= d;
    if (this.y < 50) this.newPage();
  }
  para(s, size = 9) {
    const words = s.split(" ");
    let line = "";
    for (const w of words) {
      if (this.f.reg.widthOfTextAtSize(`${line} ${w}`, size) > 510) {
        this.text(line.trim(), { size });
        this.nl(12);
        line = "";
      }
      line += ` ${w}`;
    }
    if (line.trim()) {
      this.text(line.trim(), { size });
      this.nl(12);
    }
    this.nl(4);
  }
}

async function fonts(doc) {
  return { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
}

function statementRows(w, rows, cols, mult = 1, noteCol = null) {
  // rows: [label, values[] | null, {bold, note}]
  for (const [label, vals, opt = {}] of rows) {
    w.text(label, { x: 45, size: 8.5, bold: !!opt.bold });
    if (noteCol && opt.note) w.center(String(opt.note), noteCol, { size: 8 });
    if (vals) vals.forEach((v, i) => w.right(typeof v === "string" ? v : fmt(v, opt.noMult ? 1 : mult), cols[i] + 30, { bold: !!opt.bold }));
    w.nl(12.5);
  }
}

async function annualReport(fy, { unitLabel = "Rs. in crore", mult = 1, eom = false } = {}) {
  const doc = await PDFDocument.create();
  const f = await fonts(doc);
  const w = new Writer(doc, f);
  const a = annual(fy), p = annual(fy - 1), b = balance(fy), pb = balance(fy - 1), c = cashflow(fy), pc = cashflow(fy - 1);
  w.text(COMPANY, { size: 18, bold: true }); w.nl(24);
  w.text(`Annual Report ${fyl(fy)} (SYNTHETIC)`, { size: 14 }); w.nl(30);
  w.text("Chairman's Message", { size: 13, bold: true }); w.nl(18);
  w.para(`Dear Shareholders, during FY${fyl(fy)} your Company recorded revenue from operations of Rs. ${a.revenue.toLocaleString("en-IN")} crore, a growth of ${(((a.revenue / p.revenue) - 1) * 100).toFixed(1)}% over the previous year.`);
  w.para(`Going forward, we plan to expand our steel capacity from 3.0 MTPA to 4.5 MTPA by FY${String(fy + 3).slice(2)} with a capital expenditure of Rs. 4,500 crore, funded through internal accruals and debt.`);
  w.para(`We expect to reduce net debt to below Rs. 2,000 crore by FY${String(fy + 2).slice(2)} and we aim to achieve an EBITDA margin of 20% over the next three years.`);
  w.para("We intend to commission a new 120 MW captive power plant which will lower power and fuel costs. The outlook for domestic steel demand remains positive, although volatility in coking coal prices is a key risk.");
  w.newPage();
  w.text("Management Discussion and Analysis", { size: 13, bold: true }); w.nl(18);
  w.para("Industry outlook: Domestic steel consumption is expected to grow, supported by infrastructure spending. Risks and concerns include volatility in raw material prices, regulatory changes in environmental norms and foreign exchange fluctuations on imported coal.");
  w.para(`Our order book for value-added products stood at Rs. 2,150 crore at year end. The Company will continue its debt reduction programme and has a credit rating of AA (Stable).`);
  w.para("The Board has adopted a dividend policy targeting a payout of 20% to 30% of standalone profit after tax.");
  w.newPage();
  w.text("Independent Auditor's Report", { size: 13, bold: true }); w.nl(18);
  w.para("To the Members of Simulated Steel & Power Ltd. Opinion: We have audited the accompanying consolidated financial statements. In our opinion the financial statements give a true and fair view.");
  if (eom) w.para("Emphasis of Matter: We draw attention to Note 38 regarding a disputed entry tax demand of Rs. 210 crore which is pending before the High Court. Our opinion is not modified in respect of this matter.");
  w.para("Key Audit Matters: Key audit matters are those matters that, in our professional judgment, were of most significance, including the assessment of capital work-in-progress.");

  // Balance sheet: single-line "As at <date>" headers + Note column
  w.newPage();
  w.text(COMPANY, { size: 11, bold: true }); w.nl(14);
  w.text(`Consolidated Balance Sheet as at 31st March, ${fy}`, { size: 11, bold: true }); w.nl(14);
  w.right(`(${unitLabel})`, 555, { size: 8 }); w.nl(14);
  const cols = [400, 490];
  w.text("Particulars", { x: 45, size: 8.5, bold: true }); w.center("Note", 330, { bold: true });
  w.center(`As at 31.03.${fy}`, cols[0] + 5, { bold: true }); w.center(`As at 31.03.${fy - 1}`, cols[1] + 5, { bold: true }); w.nl(16);
  statementRows(w, [
    ["ASSETS", null, { bold: true }],
    ["Non-current assets", null, { bold: true }],
    ["(a) Property, plant and equipment", [b.ppe, pb.ppe], { note: 3 }],
    ["(b) Capital work-in-progress", [b.cwip, pb.cwip], { note: 3 }],
    ["(c) Goodwill", [b.goodwill, pb.goodwill], { note: 4 }],
    ["(d) Other intangible assets", [b.intangibles, pb.intangibles], { note: 4 }],
    ["(e) Investments", [b.nonCurrentInvestments, pb.nonCurrentInvestments], { note: 5 }],
    ["(f) Other non-current assets", [b.otherNonCurrentAssets, pb.otherNonCurrentAssets], { note: 6 }],
    ["Total non-current assets", [b.totalNonCurrentAssets, pb.totalNonCurrentAssets], { bold: true }],
    ["Current assets", null, { bold: true }],
    ["(a) Inventories", [b.inventories, pb.inventories], { note: 7 }],
    ["(b) Trade receivables", [b.tradeReceivables, pb.tradeReceivables], { note: 8 }],
    ["(c) Cash and cash equivalents", [b.cash, pb.cash], { note: 9 }],
    ["(d) Bank balances other than (c) above", [b.otherBankBalances, pb.otherBankBalances], { note: 10 }],
    ["(e) Other current assets", [b.otherCurrentAssets, pb.otherCurrentAssets], { note: 11 }],
    ["Total current assets", [b.totalCurrentAssets, pb.totalCurrentAssets], { bold: true }],
    ["Total Assets", [b.totalAssets, pb.totalAssets], { bold: true }],
    ["EQUITY AND LIABILITIES", null, { bold: true }],
    ["Equity", null, { bold: true }],
    ["(a) Equity share capital", [b.shareCapital, pb.shareCapital], { note: 12 }],
    ["(b) Other equity", [b.otherEquity, pb.otherEquity], { note: 13 }],
    ["Total equity", [b.totalEquity, pb.totalEquity], { bold: true }],
    ["Non-current liabilities", null, { bold: true }],
    ["(i) Borrowings", [b.longTermBorrowings, pb.longTermBorrowings], { note: 14 }],
    ["(ii) Lease liabilities", [b.leaseNc, pb.leaseNc], { note: 15 }],
    ["(iii) Other non-current liabilities", [b.otherNcl, pb.otherNcl], { note: 16 }],
    ["Total non-current liabilities", [b.totalNonCurrentLiabilities, pb.totalNonCurrentLiabilities], { bold: true }],
    ["Current liabilities", null, { bold: true }],
    ["(i) Borrowings", [b.shortTermBorrowings, pb.shortTermBorrowings], { note: 17 }],
    ["(ii) Lease liabilities", [b.leaseC, pb.leaseC], { note: 15 }],
    ["(iii) Trade payables", [b.tradePayables, pb.tradePayables], { note: 18 }],
    ["(iv) Other current liabilities", [b.otherCl, pb.otherCl], { note: 19 }],
    ["Total current liabilities", [b.totalCurrentLiabilities, pb.totalCurrentLiabilities], { bold: true }],
    ["Total Equity and Liabilities", [b.totalEquityAndLiabilities, pb.totalEquityAndLiabilities], { bold: true }],
  ], cols, mult, 330);

  // P&L: two-line header ("Year ended" above dates in words)
  w.newPage();
  w.text(`Consolidated Statement of Profit and Loss for the year ended 31st March, ${fy}`, { size: 11, bold: true }); w.nl(14);
  w.right(`(${unitLabel})`, 555, { size: 8 }); w.nl(14);
  w.text("Particulars", { x: 45, size: 8.5, bold: true }); w.center("Note", 330, { bold: true }); w.center("Year ended", cols[0] + 5, { bold: true }); w.center("Year ended", cols[1] + 5, { bold: true }); w.nl(11);
  w.center(`31st March, ${fy}`, cols[0] + 5, { bold: true }); w.center(`31st March, ${fy - 1}`, cols[1] + 5, { bold: true }); w.nl(16);
  statementRows(w, [
    ["I. Revenue from operations", [a.revenue, p.revenue], { note: 20 }],
    ["II. Other income", [a.otherIncome, p.otherIncome], { note: 21 }],
    ["III. Total income (I+II)", [a.totalIncome, p.totalIncome], { bold: true }],
    ["IV. Expenses", null, { bold: true }],
    ["(a) Cost of materials consumed", [a.materialsCost, p.materialsCost], { note: 22 }],
    ["(b) Employee benefits expense", [a.employeeCost, p.employeeCost], { note: 23 }],
    ["(c) Power and fuel", [a.powerFuel, p.powerFuel]],
    ["(d) Finance costs", [a.financeCost, p.financeCost], { note: 24 }],
    ["(e) Depreciation and amortisation expense", [a.depreciation, p.depreciation], { note: 3 }],
    ["(f) Other expenses", [a.otherExpenses, p.otherExpenses], { note: 25 }],
    ["Total expenses (IV)", [a.totalExpenses, p.totalExpenses], { bold: true }],
    ["V. Profit before exceptional items and tax (III-IV)", [a.pbtBeforeExceptional, p.pbtBeforeExceptional]],
    ["VI. Exceptional items", [a.exceptionalItems, p.exceptionalItems], { note: 26 }],
    ["VII. Profit before tax (V+VI)", [a.pbt, p.pbt], { bold: true }],
    ["VIII. Tax expense:", null],
    ["(1) Current tax", [a.currentTax, p.currentTax]],
    ["(2) Deferred tax", [a.deferredTax, p.deferredTax]],
    ["Total tax expense", [a.totalTax, p.totalTax]],
    ["IX. Profit for the year (VII-VIII)", [a.pat, p.pat], { bold: true }],
    ["X. Earnings per equity share (Face value Rs. 10 each)", null],
    ["(1) Basic (Rs.)", [a.eps.toFixed(2), p.eps.toFixed(2)], { note: 27 }],
    ["(2) Diluted (Rs.)", [a.eps.toFixed(2), p.eps.toFixed(2)]],
  ], cols, mult, 330);

  // Cash flow: dates in "March 31, 2024" style with "Year ended" on the same line
  w.newPage();
  w.text(`Consolidated Statement of Cash Flows for the year ended March 31, ${fy}`, { size: 11, bold: true }); w.nl(14);
  w.right(`(${unitLabel})`, 555, { size: 8 }); w.nl(14);
  w.text("Particulars", { x: 45, size: 8.5, bold: true }); w.center(`Year ended March 31, ${fy}`, cols[0], { bold: true, size: 7.5 }); w.center(`Year ended March 31, ${fy - 1}`, cols[1] + 10, { bold: true, size: 7.5 }); w.nl(16);
  statementRows(w, [
    ["A. Cash flow from operating activities", null, { bold: true }],
    ["Profit before tax", [a.pbt, p.pbt]],
    ["Net cash generated from operating activities", [c.cfo, pc.cfo], { bold: true }],
    ["B. Cash flow from investing activities", null, { bold: true }],
    ["Purchase of property, plant and equipment", [-c.capex, -pc.capex]],
    ["Proceeds from sale of property, plant and equipment", [c.ppeSaleProceeds, pc.ppeSaleProceeds]],
    ["Net cash used in investing activities", [c.cfi, pc.cfi], { bold: true }],
    ["C. Cash flow from financing activities", null, { bold: true }],
    ["Proceeds from long-term borrowings", [c.borrowingsProceeds, pc.borrowingsProceeds]],
    ["Repayment of long-term borrowings", [-c.borrowingsRepayment, -pc.borrowingsRepayment]],
    ["Dividends paid", [-c.dividendsPaid, -pc.dividendsPaid]],
    ["Interest paid", [-c.interestPaid, -pc.interestPaid]],
    ["Net cash (used in)/generated from financing activities", [c.cff, pc.cff], { bold: true }],
    ["Net increase/(decrease) in cash and cash equivalents", [c.netChangeInCash, pc.netChangeInCash]],
    ["Cash and cash equivalents at the beginning of the year", [c.openingCash, pc.openingCash]],
    ["Cash and cash equivalents at the end of the year", [c.closingCash, pc.closingCash]],
  ], cols, mult);
  return doc.save();
}

async function quarterlyPage(doc, f, fy, q, { unitLabel = "Rs. in crore", mult = 1 } = {}) {
  const w = new Writer(doc, f);
  const cur = quarter(fy, q);
  const prevQ = q === 1 ? quarter(fy - 1, 4) : quarter(fy, q - 1);
  const yAgo = quarter(fy - 1, q);
  const qEnd = { 1: [6, 30], 2: [9, 30], 3: [12, 31], 4: [3, 31] };
  const dateOf = (yy, qq) => { const [m, d] = qEnd[qq]; const cal = qq === 4 ? yy : yy - 1; return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${cal}`; };
  const pq = q === 1 ? [fy - 1, 4] : [fy, q - 1];
  w.text(COMPANY, { size: 12, bold: true }); w.nl(15);
  const title = q === 4 ? `Statement of Audited Consolidated Financial Results for the Quarter and Year ended ${dateOf(fy, 4)}` : `Statement of Unaudited Consolidated Financial Results for the Quarter ended ${dateOf(fy, q)}`;
  w.text(title, { size: 10, bold: true }); w.nl(14);
  w.right(`(${unitLabel})`, 565, { size: 8 }); w.nl(14);
  let cols, heads, vals;
  const A = { ...ytd(fy, 4), ...annual(fy) }, PA = { ...ytd(fy - 1, 4), ...annual(fy - 1) };
  if (q === 4) {
    cols = [300, 360, 420, 490, 550];
    w.center("Quarter ended", 360, { bold: true }); w.center("Year ended", 520, { bold: true }); w.nl(11);
    heads = [dateOf(fy, 4), dateOf(fy, 3), dateOf(fy - 1, 4), dateOf(fy, 4), dateOf(fy - 1, 4)];
    vals = (k) => [cur[k], prevQ[k], yAgo[k], A[k], PA[k]];
  } else if (q === 1) {
    cols = [300, 370, 440, 530];
    w.center("Quarter ended", 370, { bold: true }); w.center("Year ended", 530, { bold: true }); w.nl(11);
    heads = [dateOf(fy, 1), dateOf(fy - 1, 4), dateOf(fy - 1, 1), dateOf(fy - 1, 4)];
    vals = (k) => [cur[k], prevQ[k], yAgo[k], PA[k]];
  } else {
    cols = [270, 325, 380, 440, 495, 553];
    const ytdC = ytd(fy, q), ytdP = ytd(fy - 1, q);
    w.center("Quarter ended", 325, { bold: true }); w.center(q === 2 ? "Half year ended" : "Nine months ended", 468, { bold: true }); w.center("Year ended", 553, { bold: true }); w.nl(11);
    heads = [dateOf(fy, q), dateOf(...pq), dateOf(fy - 1, q), dateOf(fy, q), dateOf(fy - 1, q), dateOf(fy - 1, 4)];
    vals = (k) => [cur[k], prevQ[k], yAgo[k], ytdC[k], ytdP[k], PA[k]];
  }
  w.text("Particulars", { x: 45, size: 8.5, bold: true });
  heads.forEach((h, i) => w.center(h, cols[i] - 18, { bold: true, size: 7.5 })); w.nl(15);
  const row = (label, k, opt = {}) => [label, vals(k).map((v) => (opt.eps ? v.toFixed(2) : v)), opt];
  const rows = [
    row("1 Revenue from operations", "revenue"),
    row("2 Other income", "otherIncome"),
    row("3 Total income (1+2)", "totalIncome", { bold: true }),
    ["4 Expenses", null],
    row("(a) Cost of materials consumed", "materialsCost"),
    row("(b) Employee benefits expense", "employeeCost"),
    row("(c) Power and fuel", "powerFuel"),
    row("(d) Finance costs", "financeCost"),
    row("(e) Depreciation and amortisation expense", "depreciation"),
    row("(f) Other expenses", "otherExpenses"),
    row("Total expenses", "totalExpenses", { bold: true }),
    row("5 Profit before exceptional items and tax (3-4)", "pbtBeforeExceptional"),
    row("6 Exceptional items", "exceptionalItems"),
    row("7 Profit before tax (5+6)", "pbt", { bold: true }),
    ["8 Tax expense", null],
    row("(a) Current tax", "currentTax"),
    row("(b) Deferred tax", "deferredTax"),
    row("9 Net profit for the period (7-8)", "pat", { bold: true }),
    [`10 Paid-up equity share capital (FV Rs.${FACE_VALUE})`, vals("revenue").map(() => 100), {}],
    ["11 Earnings per share (not annualised)", null],
    row("(a) Basic (Rs.)", "eps", { eps: true, noMult: true }),
    row("(b) Diluted (Rs.)", "eps", { eps: true, noMult: true }),
  ];
  statementRows(w, rows.map(([l, v, o = {}]) => [l, v, o]), cols.map((c) => c - 30), mult);
  w.nl(8);
  w.text("Segment wise Revenue, Results, Assets and Liabilities", { size: 9, bold: true }); w.nl(14);
  statementRows(w, [
    ["1 Segment Revenue", null, { bold: true }],
    row("(a) Steel", "segSteel"),
    row("(b) Power", "segPower"),
    ["2 Segment Results", null, { bold: true }],
    row("(a) Steel", "segSteelResult"),
    row("(b) Power", "segPowerResult"),
  ].map(([l, v, o = {}]) => [l, v, o]), cols.map((c) => c - 30), mult);
}

async function quarterlyDoc(list, opts) {
  const doc = await PDFDocument.create();
  const f = await fonts(doc);
  for (const [fy, q] of list) await quarterlyPage(doc, f, fy, q, opts);
  return doc.save();
}

async function scannedLike() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({ x: 60, y: 200, width: 470, height: 500, color: rgb(0.85, 0.85, 0.85) });
  }
  return doc.save();
}

const files = [];
for (const fy of [2021, 2022, 2023, 2024]) {
  const opts = fy === 2022 ? { unitLabel: "Rs. in lakhs", mult: 100, eom: true } : {};
  files.push([`SYNTHETIC_AnnualReport_FY${fyl(fy)}.pdf`, await annualReport(fy, opts)]);
}
files.push(["SYNTHETIC_QuarterlyResults_FY2020-21_and_FY2021-22_(8_quarters).pdf", await quarterlyDoc([[2021, 1], [2021, 2], [2021, 3], [2021, 4], [2022, 1], [2022, 2], [2022, 3], [2022, 4]])]);
for (const fy of [2023, 2024]) for (const q of [1, 2, 3, 4]) files.push([`SYNTHETIC_Q${q}_FY${fyl(fy)}_Results.pdf`, await quarterlyDoc([[fy, q]])]);
files.push(["SYNTHETIC_scanned_no_text_layer.pdf", await scannedLike()]);
const publicDir = join(root, "public", "samples");
mkdirSync(publicDir, { recursive: true });
const manifest = [];
for (const [name, bytes] of files) {
  writeFileSync(join(outDir, name), bytes);
  writeFileSync(join(publicDir, name), bytes);
  const m = name.match(/AnnualReport_FY(\d{4})-/);
  manifest.push({ file: name, kind: m ? "annual" : "quarterly", declaredFy: m ? Number(m[1]) + 1 : undefined, scanned: name.includes("scanned") });
}
writeFileSync(join(publicDir, "manifest.json"), JSON.stringify({ note: "SYNTHETIC test documents for a fictional company. Not real financial information.", files: manifest }, null, 2));
console.log(`Wrote ${files.length} synthetic PDFs to ${outDir} and public/samples`);
