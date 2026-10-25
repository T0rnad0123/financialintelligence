// Core domain types for Financial Intelligence Lab.
// Values are stored in INR crore unless the line item's unit says otherwise
// (per-share items in ₹, share counts as absolute numbers, ratios in %).

export type Basis = "consolidated" | "standalone";

export type SectorKey =
  | "general"
  | "manufacturing"
  | "fmcg"
  | "it"
  | "bank"
  | "nbfc"
  | "insurance"
  | "power"
  | "infrastructure"
  | "pharma"
  | "auto"
  | "energy"
  | "metals"
  | "telecom";

/** How a value came to exist. Never mix these silently. */
export type ValueStatus = "reported" | "user-corrected" | "derived" | "estimated" | "missing";
export type Confidence = "high" | "medium" | "low";

export interface SourceRef {
  docId: string;
  docName: string;
  page?: number;
  /** The exact line of text the value was read from. */
  rawText?: string;
  /** The value exactly as printed, e.g. "(1,234.56)". */
  rawValue?: string;
  /** Unit as printed / detected, e.g. "₹ crore", "₹ lakh". */
  rawUnit?: string;
  method: "parser" | "ai" | "ocr" | "manual";
}

export interface Candidate {
  value: number;
  source: SourceRef;
  /** True when the period is the document's own reporting period (not a comparative). */
  isPrimaryPeriod: boolean;
  docKind: DocKind;
  docUploadedAt: number;
}

export interface DataPoint {
  value: number | null;
  status: ValueStatus;
  confidence: Confidence;
  source?: SourceRef;
  note?: string;
  /** All competing values found across documents (for conflict review). */
  candidates?: Candidate[];
  /** Rule that selected the current value, for traceability. */
  selectionRule?: string;
}

export type PeriodKind = "FY" | "Q";

export interface PeriodRef {
  id: string; // "FY2024" or "Q1FY2025"
  kind: PeriodKind;
  fy: number; // ending calendar year of the financial year
  q?: 1 | 2 | 3 | 4;
  endDate: string; // ISO yyyy-mm-dd
  label: string; // "FY2023-24" / "Q1 FY2024-25"
}

export type ItemKey = string;
export type PeriodFacts = Partial<Record<ItemKey, DataPoint>>;
export type FactStore = Record<Basis, Record<string, PeriodFacts>>;

export type SegmentMetric = "revenue" | "result" | "assets" | "liabilities" | "capex";
export interface SegmentFact {
  basis: Basis;
  periodId: string;
  segment: string;
  metric: SegmentMetric;
  dp: DataPoint;
}

export type DocKind = "annual" | "quarterly";
export type DocStatus = "idle" | "uploading" | "processing" | "success" | "failed" | "partial";

export type StatementType =
  | "balance-sheet"
  | "profit-loss"
  | "cash-flow"
  | "quarterly-results"
  | "equity-changes"
  | "segment"
  | "auditor-report"
  | "mdna"
  | "board-report"
  | "chairman"
  | "corporate-governance"
  | "related-party"
  | "contingent"
  | "accounting-policies"
  | "risk"
  | "other";

export interface PageInfo {
  n: number; // 1-based page number
  text: string;
  charCount: number;
  types: StatementType[];
  basis?: Basis;
  unit?: UnitKey;
  ocr?: boolean;
}

export type UnitKey = "rupees" | "thousand" | "lakh" | "million" | "crore" | "billion";

export interface DocWarning {
  level: "error" | "warning" | "info";
  message: string;
  page?: number;
}

export interface DocMeta {
  id: string;
  projectId: string;
  kind: DocKind;
  slot?: string; // "FY1".."FY4" for annual reports
  /** User-declared FY (ending year) for annual-report slots. */
  declaredFy?: number;
  /** Optional user hint for quarterly docs whose period headers can't be parsed. */
  periodHint?: { q: 1 | 2 | 3 | 4; fy: number };
  /** Optional user override of the reporting unit. */
  unitOverride?: UnitKey;
  /** Optional user override of reporting basis when not detectable. */
  basisOverride?: Basis;
  fileName: string;
  size: number;
  hash: string;
  uploadedAt: number;
  status: DocStatus;
  progress: number; // 0-100
  stage?: string;
  error?: string;
  pageCount?: number;
  scanned?: boolean;
  ocrApplied?: boolean;
  detectedUnits?: UnitKey[];
  detectedBases?: Basis[];
  detectedPeriods?: string[];
  statementPages?: Partial<Record<StatementType, number[]>>;
  warnings: DocWarning[];
  factCount?: number;
  blobStored?: boolean;
  auditFindings?: AuditFinding[];
  primaryPeriod?: string;
}

export interface AuditFinding {
  key: string;
  title: string;
  severity: "critical" | "high" | "medium" | "informational";
  docId: string;
  docName: string;
  page: number;
  text: string;
  fy?: number;
}

export interface ExtractedFact {
  basis: Basis;
  periodId: string;
  item: ItemKey;
  value: number;
  source: SourceRef;
  isPrimaryPeriod: boolean;
  confidence: Confidence;
}

export type ExcerptCategory =
  | "outlook"
  | "strategy"
  | "capex"
  | "expansion"
  | "risk"
  | "auditor"
  | "related-party"
  | "contingent"
  | "accounting-policy"
  | "restatement"
  | "dividend"
  | "debt"
  | "order-book"
  | "rnd"
  | "regulatory"
  | "segment"
  | "governance"
  | "guidance"
  | "other";

export interface Excerpt {
  id: string;
  docId: string;
  docName: string;
  docKind: DocKind;
  fy?: number;
  page: number;
  category: ExcerptCategory;
  text: string;
  score: number;
}

export type StrategyStatus =
  | "achieved"
  | "on-track"
  | "partially-achieved"
  | "delayed"
  | "not-achieved"
  | "insufficient-evidence";

export interface StrategyItem {
  id: string;
  statement: string;
  docId?: string;
  docName?: string;
  page?: number;
  fy?: number;
  objective: string;
  category: string;
  expectedEffect: string;
  investment: string;
  executionRisks: string;
  horizon: string;
  measurable: boolean;
  progressReported: boolean;
  status: StrategyStatus;
  evidence: string;
  origin: "auto-detected" | "user" | "ai-suggested";
  confirmed: boolean;
}

export type GuidanceMetric =
  | "revenueGrowth"
  | "revenue"
  | "ebitdaMargin"
  | "capex"
  | "totalDebt"
  | "netDebt"
  | "pat"
  | "custom";

export interface GuidanceItem {
  id: string;
  metric: GuidanceMetric;
  customLabel?: string;
  direction: "at-least" | "at-most";
  target: number; // % for growth/margin, ₹ crore for amounts
  targetFy: number;
  statedFy?: number;
  quote: string;
  docName?: string;
  page?: number;
  /** For custom guidance, the actual must be entered by the user. */
  customActual?: number | null;
}

export interface AiOutput {
  id: string;
  task: string;
  createdAt: number;
  provider: string;
  model: string;
  content: string;
  citationsChecked: { valid: string[]; invalid: string[] };
}

export interface ScoreWeights {
  profitability: number;
  growth: number;
  cashFlow: number;
  balanceSheet: number;
  capitalEfficiency: number;
  workingCapital: number;
  earningsQuality: number;
  resilience: number;
}

export interface DcfScenario {
  revenueGrowthStart: number; // %
  revenueGrowthEnd: number; // %
  ebitMarginStart: number; // %
  ebitMarginEnd: number; // %
  taxRate: number; // %
  daPctRevenue: number; // %
  capexPctRevenue: number; // %
  nwcPctIncrementalRevenue: number; // % of change in revenue
}

export interface ValuationSettings {
  earningsBase: "latestFY" | "ttm";
  shareBasis: "basic" | "diluted";
  includeLeasesInDebt: boolean;
  includeCurrentInvestmentsInCash: boolean;
  includeMinorityInterest: boolean;
  otherNonOperatingAssets: number; // ₹ crore, user input
  otherDebtLikeClaims: number; // ₹ crore, user input
  forecastYears: number;
  wacc: number; // %
  terminalGrowth: number; // %
  midYear: boolean;
  scenarios: { bear: DcfScenario; base: DcfScenario; bull: DcfScenario };
  activeScenario: "bear" | "base" | "bull";
  seeded: boolean;
  // WACC builder (all user assumptions)
  riskFree: number;
  beta: number;
  equityRiskPremium: number;
  preTaxCostOfDebt: number;
  costOfEquity: number;
  // Earnings-based
  fairPe: number | null;
  // DDM
  ddmGrowth1: number;
  ddmYears: number;
  ddmTerminalGrowth: number;
  // Residual income
  riRoe: number | null;
  riPayout: number | null;
  riYears: number;
  riTerminalGrowth: number;
  // Asset based
  navAdjustments: { label: string; amount: number }[];
  // Conclusion
  methodWeights: Record<string, number>;
  undervaluedThreshold: number; // % margin of safety
  overvaluedThreshold: number; // % premium
}

export interface ProjectionSettings {
  interestRateOnDebt: number | null; // %
  netBorrowingPctRevenue: number; // % of revenue added to debt each year (negative = repayment)
  payoutRatio: number | null; // %
  useFcfToRepayDebt: boolean;
}

export interface ProjectSettings {
  scoreWeights: ScoreWeights;
  beneishUseOtherExpensesAsSga: boolean;
  altmanUseOtherEquityAsRetainedEarnings: boolean;
  valuation: ValuationSettings;
  projection: ProjectionSettings;
  aiAccessToken?: string;
}

export interface UiState {
  basis: Basis;
  fyFrom?: string;
  fyTo?: string;
  quarterCount: number;
}

export interface Project {
  id: string;
  name: string;
  nseSymbol?: string;
  bseCode?: string;
  sector: SectorKey;
  currency: "INR";
  fyEndMonth: number; // 3 = March
  preferredBasis: Basis;
  price: number | null;
  priceDate?: string;
  sharesOutstanding: number | null; // absolute count, user-entered or confirmed
  sharesSource?: string;
  dilutedShares: number | null;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  facts: FactStore;
  segments: SegmentFact[];
  excerpts: Excerpt[];
  strategy: StrategyItem[];
  guidance: GuidanceItem[];
  aiOutputs: AiOutput[];
  settings: ProjectSettings;
  ui: UiState;
  /** Last time facts were rebuilt from documents. */
  lastMergedAt?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sector: SectorKey;
  nseSymbol?: string;
  updatedAt: number;
  docCount: number;
}
