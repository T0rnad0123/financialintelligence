// Catalogue of normalised line items and the label patterns used to detect
// them in Indian (Ind AS / Schedule III / SEBI LODR) financial statements.
// Patterns are matched against a normalised label: lower-case, numbering
// such as "I.", "(a)", "1." removed, whitespace collapsed.

export type Statement = "pl" | "bs" | "cf" | "share" | "bank" | "sector";
export type ItemUnit = "crore" | "perShare" | "count" | "pct" | "number";

export interface LineItemDef {
  key: string;
  label: string;
  statement: Statement;
  unit: ItemUnit;
  /** Flow items (P&L / cash flow) can be summed across quarters; stock items cannot. */
  flow: boolean;
  patterns: RegExp[];
  exclude?: RegExp[];
  /** Store the absolute value (e.g. capex outflow stored as a positive number). */
  absolute?: boolean;
  description?: string;
  core?: boolean;
}

const L = (
  key: string,
  label: string,
  statement: Statement,
  patterns: RegExp[],
  opts: Partial<LineItemDef> = {},
): LineItemDef => ({
  key,
  label,
  statement,
  unit: opts.unit ?? "crore",
  flow: opts.flow ?? (statement === "pl" || statement === "cf"),
  patterns,
  ...opts,
});

// Order matters: more specific patterns first. A line is mapped to the first item that matches.
export const LINE_ITEMS: LineItemDef[] = [
  // ---------------- Profit & loss ----------------
  L("revenue", "Revenue from operations", "pl", [
    /^(total )?revenue from operations( \(net\))?( \(gross\))?$/,
    /^(total )?revenue from operations\b(?!.*other)/,
    /^income from operations\b/,
    /^(net )?sales\/income from operations/,
    /^net sales\b/,
  ], { exclude: [/other operating/, /growth/, /%/], core: true }),
  L("otherIncome", "Other income", "pl", [/^other income\b/], { exclude: [/comprehensive/], core: true }),
  L("totalIncome", "Total income", "pl", [/^total income\b/, /^total revenue\b/], { exclude: [/comprehensive/] }),
  L("materialsCost", "Cost of materials consumed", "pl", [/^cost of (raw )?materials? consumed/, /^raw materials? consumed/]),
  L("purchasesStockInTrade", "Purchases of stock-in-trade", "pl", [/^purchases? of (stock|traded goods)/, /^purchase of stock-in-trade/]),
  L("changesInInventories", "Changes in inventories", "pl", [/^(\(increase\)\/decrease|changes|change) in inventor/, /^(increase|decrease)\/?\(?(increase|decrease)?\)? in inventor/]),
  L("powerFuel", "Power and fuel", "pl", [/^power (and|&) fuel/]),
  L("employeeCost", "Employee benefits expense", "pl", [/^employee(s)? benefits? expenses?/, /^employee (cost|expenses?)/, /^staff (cost|expenses?)/]),
  L("financeCost", "Finance costs", "pl", [/^finance costs?\b/, /^interest (and finance charges|expenses?)$/, /^borrowing costs?/], { core: true }),
  L("depreciation", "Depreciation and amortisation", "pl", [/^depreciation/, /^amortisation and depreciation/], { exclude: [/accumulated/], core: true }),
  L("otherExpenses", "Other expenses", "pl", [/^other expenses?\b/]),
  L("sgaExpense", "Selling, general & administrative expenses", "pl", [/^selling,? general (and|&) administrat/]),
  L("rndExpense", "Research & development expense", "pl", [/^research (and|&) development expen/]),
  L("totalExpenses", "Total expenses", "pl", [/^total expenses?\b/, /^total expenditure\b/], { core: true }),
  L("pbtBeforeExceptional", "Profit before exceptional items and tax", "pl", [
    /^profit\/?\(?(loss)?\)? before (exceptional|extraordinary) items/,
    /^(profit|loss).{0,20}before exceptional/,
  ]),
  L("exceptionalItems", "Exceptional items", "pl", [/^exceptional items?\b/, /^exceptional (gain|loss|income)/]),
  L("pbt", "Profit before tax", "pl", [
    /^(net )?profit\/?\(?(loss)?\)? before tax/,
    /^(profit|loss) before tax/,
    /^profit\/\(loss\) before tax/,
  ], { exclude: [/exceptional/], core: true }),
  L("currentTax", "Current tax", "pl", [/^current tax\b/]),
  L("deferredTax", "Deferred tax", "pl", [/^deferred tax\b/], { exclude: [/assets?|liabilit/] }),
  L("totalTax", "Total tax expense", "pl", [/^(total )?tax expenses?\b/, /^income tax expense/, /^total tax\b/, /^provision for tax/]),
  L("patOwners", "PAT attributable to owners", "pl", [
    /^(equity )?(share)?holders of the (parent|company)$/,
    /^owners of the (parent|company|holding company)/,
    /^profit.{0,30}attributable to (owners|equity holders|shareholders) of the (parent|company)/,
  ], { exclude: [/comprehensive/] }),
  L("minorityInterestPl", "Non-controlling interest (P&L)", "pl", [/^non[- ]controlling interests?$/, /^minority interests?$/]),
  L("pat", "Profit after tax", "pl", [
    /^(net )?profit\/?\(?(loss)?\)? for the (year|period|quarter)/,
    /^(net )?profit\/?\(?(loss)?\)? after tax/,
    /^net profit\/?\(?(loss)?\)?( from ordinary activities)? after tax/,
    /^profit\/\(loss\) for the (year|period)/,
    /^(net )?profit for the (year|period)/,
    /^(net )?(profit|loss) for the (year|period)/,
  ], { exclude: [/discontinued/, /before/, /comprehensive/, /attributable/], core: true }),
  L("epsBasic", "EPS – basic", "share", [/^(\(?[a-z]\)?\s*)?basic\b/, /^basic (eps|earnings per share)/, /^earnings per (equity )?share.{0,20}basic/], { unit: "perShare", flow: true, exclude: [/weighted/] }),
  L("epsDiluted", "EPS – diluted", "share", [/^(\(?[a-z]\)?\s*)?diluted\b/, /^diluted (eps|earnings per share)/, /^earnings per (equity )?share.{0,20}diluted/], { unit: "perShare", flow: true, exclude: [/weighted/] }),
  L("dps", "Dividend per share", "share", [/^dividend per (equity )?share/, /^(final|interim) dividend per share/], { unit: "perShare", flow: true }),
  L("paidUpCapital", "Paid-up equity share capital", "share", [/^paid[- ]up equity share capital/, /^equity share capital\b/, /^share capital$/], { flow: false }),
  L("faceValue", "Face value per share", "share", [/^face value/], { unit: "perShare", flow: false }),
  L("weightedShares", "Weighted average shares (EPS)", "share", [/^weighted average number of (equity )?shares/], { unit: "count", flow: false }),

  // ---------------- Balance sheet ----------------
  L("ppe", "Property, plant and equipment", "bs", [/^property,? plant (and|&) equipment$/, /^property,? plant (and|&) equipments?\b(?!.*(purchase|sale|acquisition|disposal))/, /^tangible assets$/, /^fixed assets$/], { flow: false, exclude: [/purchase|sale|acquisition|disposal|proceeds|capital work/] }),
  L("cwip", "Capital work-in-progress", "bs", [/^capital work[- ]in[- ]progress/], { flow: false }),
  L("goodwill", "Goodwill", "bs", [/^goodwill( on consolidation)?$/], { flow: false }),
  L("intangibles", "Other intangible assets", "bs", [/^other intangible assets$/, /^intangible assets$/], { flow: false }),
  L("rouAssets", "Right-of-use assets", "bs", [/^right[- ]of[- ]use assets?/], { flow: false }),
  L("nonCurrentInvestments", "Non-current investments", "bs", [/^non[- ]current investments$/], { flow: false }),
  L("totalNonCurrentAssets", "Total non-current assets", "bs", [/^total non[- ]current assets/], { flow: false }),
  L("inventories", "Inventories", "bs", [/^inventories$/, /^inventories\b(?!.*(change|increase|decrease))/], { flow: false, exclude: [/change|increase|decrease/] }),
  L("currentInvestments", "Current investments", "bs", [/^current investments$/], { flow: false }),
  L("tradeReceivables", "Trade receivables", "bs", [/^trade receivables?$/, /^trade receivables\b(?!.*(increase|decrease|change))/, /^sundry debtors/], { flow: false, exclude: [/increase|decrease|change|movement/] }),
  L("cash", "Cash and cash equivalents", "bs", [/^cash and cash equivalents$/, /^cash (and|&) bank balances?$/, /^cash and cash equivalents\b(?!.*(end|beginning|opening|closing|increase|decrease))/], { flow: false, exclude: [/end of|beginning|opening|closing|increase|decrease|net change/] }),
  L("otherBankBalances", "Other bank balances", "bs", [/^(other )?bank balances other than/, /^other bank balances$/], { flow: false }),
  L("totalCurrentAssets", "Total current assets", "bs", [/^total current assets/], { flow: false, core: true }),
  L("totalAssets", "Total assets", "bs", [/^total assets$/, /^total assets\b/], { flow: false, core: true }),
  L("otherEquity", "Other equity", "bs", [/^other equity$/, /^reserves (and|&) surplus$/], { flow: false }),
  L("totalEquity", "Equity attributable to owners", "bs", [
    /^equity attributable to (the )?(owners|equity holders|shareholders)/,
    /^total equity attributable/,
    /^total equity$/,
    /^total shareholders'? funds?$/,
    /^shareholders'? funds?$/,
    /^net worth$/,
  ], { flow: false, core: true }),
  L("nonControllingInterestBs", "Non-controlling interest (balance sheet)", "bs", [/^non[- ]controlling interests?$/, /^minority interests?$/], { flow: false }),
  L("longTermBorrowings", "Long-term borrowings", "bs", [/^(long[- ]term |non[- ]current )?borrowings$/, /^long[- ]term borrowings/], { flow: false }),
  L("shortTermBorrowings", "Short-term borrowings", "bs", [/^short[- ]term borrowings/, /^current borrowings/], { flow: false }),
  L("leaseLiabilities", "Lease liabilities", "bs", [/^lease liabilit(y|ies)$/], { flow: false }),
  L("tradePayables", "Trade payables", "bs", [/^trade payables?$/, /^total trade payables/, /^trade payables\b(?!.*(increase|decrease|change))/, /^sundry creditors/], { flow: false, exclude: [/increase|decrease|change|micro|other than/] }),
  L("totalCurrentLiabilities", "Total current liabilities", "bs", [/^total current liabilities/], { flow: false, core: true }),
  L("totalNonCurrentLiabilities", "Total non-current liabilities", "bs", [/^total non[- ]current liabilities/], { flow: false }),
  L("totalLiabilities", "Total liabilities", "bs", [/^total liabilities$/], { flow: false }),
  L("totalEquityAndLiabilities", "Total equity and liabilities", "bs", [/^total equity and liabilities/, /^total liabilities and equity/, /^total capital and liabilities/], { flow: false }),
  L("retainedEarnings", "Retained earnings", "bs", [/^retained earnings$/, /^surplus in (the )?statement of profit/], { flow: false }),
  L("contingentLiabilities", "Contingent liabilities (total)", "bs", [/^total contingent liabilities/], { flow: false }),

  // ---------------- Cash flow ----------------
  L("cfo", "Cash flow from operating activities", "cf", [
    /^net cash (flow )?(generated |used )?(from|in|used in|\(used in\)|generated from|from\/\(used in\)|generated from\/\(used in\)).{0,25}operating activities/,
    /^net cash (inflow|outflow|flow).{0,30}operating activities/,
    /^cash (generated|flow) from operating activities$/,
  ], { core: true }),
  L("cfi", "Cash flow from investing activities", "cf", [/^net cash (flow )?.{0,40}investing activities/], { core: true }),
  L("cff", "Cash flow from financing activities", "cf", [/^net cash (flow )?.{0,40}financing activities/], { core: true }),
  L("capex", "Capital expenditure (gross outflow)", "cf", [
    /^(payments?|purchases?|acquisitions?) (for|of) (property,? plant|fixed assets|tangible|ppe|capital expenditure)/,
    /^(purchase|acquisition) of property,? plant (and|&) equipment/,
    /^capital expenditure on/,
    /^purchase of (property, plant and equipment|fixed assets)( and (other )?intangible assets)?( including capital work[- ]in[- ]progress)?/,
  ], { absolute: true, core: true, description: "Purchase of property, plant & equipment and intangibles, stored as a positive outflow." }),
  L("capexIntangibles", "Purchase of intangible assets", "cf", [/^(purchase|acquisition) of (other )?intangible assets/], { absolute: true }),
  L("ppeSaleProceeds", "Proceeds from sale of PPE", "cf", [/^proceeds from (sale|disposal) of (property|fixed assets|ppe)/], { absolute: true }),
  L("dividendsPaid", "Dividends paid", "cf", [/^dividends? paid/, /^payment of dividends?/], { absolute: true }),
  L("interestPaid", "Interest paid", "cf", [/^interest paid/, /^finance costs? paid/], { absolute: true }),
  L("borrowingsProceeds", "Proceeds from borrowings", "cf", [/^proceeds from (long[- ]term |short[- ]term |non[- ]current )?borrowings/], { absolute: true }),
  L("borrowingsRepayment", "Repayment of borrowings", "cf", [/^repayments? of (long[- ]term |short[- ]term |non[- ]current )?borrowings/], { absolute: true }),
  L("buyback", "Buy-back of equity shares", "cf", [/^buy[- ]?back of (equity )?shares/], { absolute: true }),
  L("acquisitions", "Acquisition of subsidiaries / businesses", "cf", [/^(acquisition|purchase) of (subsidiar|business|stake)/, /^investment in subsidiar/], { absolute: true }),
  L("netChangeInCash", "Net change in cash", "cf", [/^net (increase|decrease|change).{0,30}cash and cash equivalents/]),

  // ---------------- Banking / NBFC / insurance ----------------
  L("interestEarned", "Interest earned", "bank", [/^interest earned\b/, /^interest income\b/], { flow: true }),
  L("interestExpended", "Interest expended", "bank", [/^interest expended\b/], { flow: true }),
  L("operatingExpensesBank", "Operating expenses (bank)", "bank", [/^operating expenses\b/], { flow: true }),
  L("provisions", "Provisions & contingencies", "bank", [/^provisions \(other than tax\)/, /^provisions (and|&) contingencies/, /^impairment on financial instruments/], { flow: true }),
  L("deposits", "Deposits", "bank", [/^deposits$/], { flow: false }),
  L("advances", "Advances / loans", "bank", [/^advances$/, /^loans$/], { flow: false }),
  L("grossNpa", "Gross NPA (amount)", "bank", [/^gross npas?\b(?!.*%)/, /^gross non[- ]performing assets?\b(?!.*%)/], { flow: false, exclude: [/%|percent|ratio/] }),
  L("netNpa", "Net NPA (amount)", "bank", [/^net npas?\b(?!.*%)/, /^net non[- ]performing assets?\b(?!.*%)/], { flow: false, exclude: [/%|percent|ratio/] }),
  L("grossNpaPct", "Gross NPA %", "bank", [/^%? ?(of )?gross npas?/, /^gross npa (ratio|%)/], { unit: "pct", flow: false }),
  L("netNpaPct", "Net NPA %", "bank", [/^%? ?(of )?net npas?/, /^net npa (ratio|%)/], { unit: "pct", flow: false }),
  L("car", "Capital adequacy ratio %", "bank", [/^capital adequacy ratio/, /^crar\b/, /^capital to risk/], { unit: "pct", flow: false }),
  L("casaPct", "CASA ratio %", "bank", [/^casa (ratio|%)/], { unit: "pct", flow: false }),
  L("nimReported", "Net interest margin % (reported)", "bank", [/^net interest margin/], { unit: "pct", flow: false }),
  L("pcrReported", "Provision coverage ratio % (reported)", "bank", [/^provision coverage ratio/], { unit: "pct", flow: false }),
  L("aum", "Assets under management", "sector", [/^assets under management\b/, /^aum\b/], { flow: false }),
  L("grossPremium", "Gross written premium", "sector", [/^gross (written )?premium/], { flow: true }),
  L("netPremium", "Net premium earned", "sector", [/^net premium earned/], { flow: true }),
  L("claimsRatio", "Claims ratio %", "sector", [/^(net )?(incurred )?claims? ratio/], { unit: "pct", flow: false }),
  L("combinedRatio", "Combined ratio %", "sector", [/^combined ratio/], { unit: "pct", flow: false }),
  L("solvencyRatio", "Solvency ratio (x)", "sector", [/^solvency ratio/], { unit: "number", flow: false }),
  L("orderBook", "Order book", "sector", [/^order (book|backlog)\b/], { flow: false }),
  L("contractAssets", "Contract assets", "sector", [/^contract assets$/], { flow: false }),
  L("regulatoryAssets", "Regulatory deferral account balances", "sector", [/^regulatory deferral account (debit )?balances/], { flow: false }),
  L("plf", "Plant load factor %", "sector", [/^plant load factor/, /^plf\b/], { unit: "pct", flow: false }),
  L("employees", "Number of employees", "sector", [/^(total )?(number of )?employees$/, /^headcount$/], { unit: "count", flow: false }),
];

export const ITEM_MAP: Record<string, LineItemDef> = Object.fromEntries(LINE_ITEMS.map((d) => [d.key, d]));

export function itemLabel(key: string): string {
  return ITEM_MAP[key]?.label ?? key;
}

/** Normalise a statement label for pattern matching. */
export function normalizeLabel(raw: string): string {
  let s = raw
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // strip leading numbering like "I.", "IV)", "(a)", "1.", "2(a)", "a.", "(i)"
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/^\(?(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xiv|xv)[.)]\s+/, "")
      .replace(/^\((i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xiv|xv)\)\s*/, "")
      .replace(/^\(?[a-z]\)\s*/, "")
      .replace(/^\(\d{1,2}\)\s*/, "")
      .replace(/^[a-z]\.\s+/, "")
      .replace(/^\d{1,2}(\.\d{1,2})?[.)]?\s+/, "")
      .replace(/^\d{1,2}\s*\([a-z]\)\s*/, "")
      .replace(/^[-–•*]\s*/, "")
      .trim();
    if (s === before) break;
  }
  // strip trailing note references and formula hints like "(a+b+c)" / "(I-II)" / ":" / "note 3"
  s = s
    .replace(/\s*\((?:[a-z0-9ivx]+\s*[+\-]\s*)+[a-z0-9ivx]+\)\s*$/i, "")
    .replace(/\s*\[?(refer )?note(s)? (no\.? )?[\d.()a-z, ]+\]?$/i, "")
    .replace(/[:*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export function matchLineItem(label: string): LineItemDef | null {
  const n = normalizeLabel(label);
  if (n.length < 3) return null;
  for (const def of LINE_ITEMS) {
    if (def.exclude?.some((r) => r.test(n))) continue;
    if (def.patterns.some((r) => r.test(n))) return def;
  }
  return null;
}
