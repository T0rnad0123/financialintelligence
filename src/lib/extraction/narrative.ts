// Keyword-based extraction of qualitative evidence (management outlook, risks,
// auditor remarks, related parties...) with page references. Deterministic –
// no AI involved. Text from PDFs is treated as untrusted data.
import type { AuditFinding, DocKind, Excerpt, ExcerptCategory, StatementType, StrategyItem } from "../types";

interface CatRule {
  category: ExcerptCategory;
  re: RegExp;
  weight: number;
  pageTypes?: StatementType[];
}

const RULES: CatRule[] = [
  { category: "outlook", re: /\b(outlook|going forward|way forward|we expect|we anticipate|future prospects|in the coming (years?|quarters?)|guidance|over the next (\w+ )?(years?|quarters?))\b/i, weight: 3 },
  { category: "strategy", re: /\b(strategy|strategic (priority|priorities|focus|objective)|our focus (will|is)|we (plan|intend|aim|propose) to|vision \d{4}|road ?map)\b/i, weight: 2 },
  { category: "capex", re: /\b(capital expenditure|capex|investment of ₹|outlay of|brownfield|greenfield)\b/i, weight: 3 },
  { category: "expansion", re: /\b(capacity (expansion|addition|enhancement)|expand(ing)? (our )?capacity|commission(ed|ing)? (of )?(the )?new|new (plant|facility|unit|line)|mtpa|\d+\s?mw\b|debottleneck)/i, weight: 3 },
  { category: "risk", re: /\b(risks?|threats?|challenges|headwinds|uncertaint(y|ies)|volatility in|adverse impact)\b/i, weight: 1, pageTypes: ["mdna", "risk", "board-report"] },
  { category: "auditor", re: /\b(qualified opinion|basis for qualified opinion|adverse opinion|disclaimer of opinion|emphasis of matter|material uncertainty related to going concern|key audit matters?|material weakness|modified opinion)\b/i, weight: 5 },
  { category: "related-party", re: /\b(related part(y|ies)|key managerial personnel|promoter group|holding company|fellow subsidiar)/i, weight: 2, pageTypes: ["related-party", "board-report", "corporate-governance"] },
  { category: "contingent", re: /\b(contingent liabilit(y|ies)|claims against the company not acknowledged|disputed (tax|demands?)|guarantees? (given|issued))/i, weight: 3 },
  { category: "accounting-policy", re: /\b(change in (the )?accounting polic(y|ies)|changed (its|the) accounting|adoption of (ind as|new standard)|voluntary change)\b/i, weight: 4 },
  { category: "restatement", re: /\b(restated|restatement|re-?stated|prior period (errors?|items?)|reclassified|regrouped)\b/i, weight: 2 },
  { category: "dividend", re: /\b(dividend (policy|of|per share|payout|declared|recommended)|final dividend|interim dividend|buy-?back)\b/i, weight: 2 },
  { category: "debt", re: /\b(debt (reduction|repayment|free|profile|maturity)|deleverag|refinanc|credit rating|net debt|prepay(ment|ed) of (loans|debt)|borrowings (reduced|increased))\b/i, weight: 3 },
  { category: "order-book", re: /\b(order (book|backlog|inflow)|orders? (worth|valued at|received))\b/i, weight: 3 },
  { category: "rnd", re: /\b(research (and|&) development|r&d (spend|expenditure|investment)|anda|dmf|usfda|new product (launch|pipeline)|patent)/i, weight: 2 },
  { category: "regulatory", re: /\b(regulator(y)?|tariff order|cerc|serc|sebi|rbi|usfda (observation|warning letter|form 483)|form 483|warning letter|import alert|show cause notice|penalty)\b/i, weight: 2 },
  { category: "governance", re: /\b(independent directors?|whistle ?blower|resignation of (the )?(auditor|director|cfo)|auditor (resigned|resignation)|pledge(d)? (of )?shares)\b/i, weight: 2 },
  { category: "guidance", re: /\b(target(ing)?|guidance|aim to (achieve|reach)|expect(s|ed)? to (achieve|reach|grow|deliver)|by (fy|20)\s?'?\d{2,4})\b.*(\d+(\.\d+)?\s?%|₹\s?[\d,]+|\d+\s?(crore|mtpa|mw|gw|stores|plants))/i, weight: 4 },
];

const NARRATIVE_TYPES: StatementType[] = ["mdna", "chairman", "board-report", "auditor-report", "risk", "related-party", "contingent", "accounting-policies", "corporate-governance", "segment", "other"];

/** Split page text into sentences (keeps reasonably sized ones). */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ");
  const parts = flat.split(/(?<=[.!?;])\s+(?=[A-Z₹(“"])/);
  return parts.map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 700 && /[a-z]{3}/i.test(s));
}

function digitRatio(s: string) {
  const d = (s.match(/\d/g) || []).length;
  return d / Math.max(1, s.length);
}

export function extractExcerpts(
  pages: { n: number; text: string; types: StatementType[] }[],
  doc: { id: string; name: string; kind: DocKind; fy?: number },
  maxPerCategory = 25,
): Excerpt[] {
  const buckets = new Map<ExcerptCategory, Excerpt[]>();
  let counter = 0;
  for (const p of pages) {
    const narrative = p.types.length === 0 || p.types.some((t) => NARRATIVE_TYPES.includes(t));
    for (const s of splitSentences(p.text)) {
      if (digitRatio(s) > 0.35) continue; // table rows, not prose
      for (const r of RULES) {
        if (!r.re.test(s)) continue;
        if (r.pageTypes && !p.types.some((t) => r.pageTypes!.includes(t)) && r.category !== "auditor") {
          if (!narrative) continue;
        }
        let score = r.weight;
        if (p.types.includes("mdna") || p.types.includes("chairman")) score += 1;
        if (/\d/.test(s)) score += 1;
        if (/₹|crore|%/.test(s)) score += 1;
        const ex: Excerpt = {
          id: `${doc.id.slice(0, 6)}-${p.n}-${counter++}`,
          docId: doc.id,
          docName: doc.name,
          docKind: doc.kind,
          fy: doc.fy,
          page: p.n,
          category: r.category,
          text: s,
          score,
        };
        const arr = buckets.get(r.category) ?? [];
        arr.push(ex);
        buckets.set(r.category, arr);
      }
    }
  }
  const out: Excerpt[] = [];
  for (const [, arr] of buckets) {
    // de-duplicate identical sentences, keep highest scoring
    const uniq = new Map<string, Excerpt>();
    for (const e of arr) {
      const k = e.text.toLowerCase().slice(0, 120);
      if (!uniq.has(k) || uniq.get(k)!.score < e.score) uniq.set(k, e);
    }
    out.push(...[...uniq.values()].sort((a, b) => b.score - a.score).slice(0, maxPerCategory));
  }
  return out;
}

const AUDIT_PATTERNS: { key: string; re: RegExp; severity: "critical" | "high" | "medium" | "informational"; title: string }[] = [
  { key: "adverse", re: /\badverse opinion\b/i, severity: "critical", title: "Adverse audit opinion" },
  { key: "disclaimer", re: /\bdisclaimer of opinion\b/i, severity: "critical", title: "Auditor disclaimer of opinion" },
  { key: "qualified", re: /\b(basis for qualified opinion|qualified opinion)\b/i, severity: "high", title: "Qualified audit opinion" },
  { key: "goingConcern", re: /\bmaterial uncertainty related to going concern\b/i, severity: "critical", title: "Material uncertainty related to going concern" },
  { key: "eom", re: /\bemphasis of matter\b/i, severity: "medium", title: "Emphasis-of-matter paragraph" },
  { key: "ifc", re: /\b(material weakness|adverse opinion on (the )?internal financial controls?|internal financial controls?.{0,80}(were not|was not) operating effectively)/i, severity: "high", title: "Internal financial control weakness" },
  { key: "kam", re: /\bkey audit matters?\b/i, severity: "informational", title: "Key audit matters reported" },
  { key: "caroDefault", re: /\b(default(ed)? in (the )?repayment of (loans|borrowings|dues))\b/i, severity: "high", title: "Default in repayment of borrowings mentioned" },
  { key: "fraud", re: /\b(fraud (by|on) the company (has been )?(noticed|reported))\b/i, severity: "high", title: "Fraud reporting mentioned in audit report" },
  { key: "restated", re: /\b(restated|restatement of (prior|previous))\b/i, severity: "medium", title: "Restatement of prior figures" },
  { key: "policyChange", re: /\bchange in accounting polic(y|ies)\b/i, severity: "medium", title: "Change in accounting policy" },
  { key: "auditorResign", re: /\b(resignation of (the )?statutory auditors?|statutory auditors? (has|have) resigned)\b/i, severity: "high", title: "Statutory auditor resignation" },
];


/**
 * Find auditor-related disclosures. Negated phrases ("we have not ...", "no key audit matters",
 * "does not contain any qualification") are excluded.
 */
export function findAuditFindings(pages: { n: number; text: string; types: StatementType[] }[], doc: { id: string; name: string; fy?: number }): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const p of pages) {
    const sentences = splitSentences(p.text);
    for (const ap of AUDIT_PATTERNS) {
      if (ap.key !== "restated" && ap.key !== "policyChange" && ap.key !== "auditorResign" && !p.types.includes("auditor-report") && !/auditor/i.test(p.text.slice(0, 600))) continue;
      const s = sentences.find((x) => ap.re.test(x) && !negated(x, ap.re));
      if (s && !out.some((o) => o.key === ap.key && o.docId === doc.id)) {
        out.push({ key: ap.key, title: ap.title, severity: ap.severity, docId: doc.id, docName: doc.name, page: p.n, text: s.slice(0, 500), fy: doc.fy });
      }
    }
  }
  return out;
}

function negated(sentence: string, re: RegExp): boolean {
  const m = sentence.match(re);
  if (!m || m.index === undefined) return false;
  const before = sentence.slice(Math.max(0, m.index - 80), m.index).toLowerCase();
  const after = sentence.slice(m.index, m.index + 120).toLowerCase();
  return /\b(no|not|nil|without|neither|nor|none)\b/.test(before) || /\b(not applicable|nil|none)\b/.test(after) || /does not contain any/.test(before);
}

const FWD_RE = /\b(will|plans? to|planning to|intends? to|aims? to|expects? to|targets?|is expected to|are expected to|propose[sd]? to|envisage[sd]?|on track to|by (fy|20)\s?'?\d{2,4})\b/i;
const QUANT_RE = /(₹\s?[\d,.]+|\d+(\.\d+)?\s?(%|crore|cr\b|mtpa|mw|gw|lakh|million|billion|stores|plants|units|tonnes|kms?))/i;

function categorise(s: string): string {
  if (/capex|capital expenditure|investment|outlay/i.test(s)) return "Capital expenditure";
  if (/capacity|plant|mtpa|mw|commission|facility/i.test(s)) return "Capacity expansion";
  if (/debt|deleverag|borrowing|repay/i.test(s)) return "Debt reduction";
  if (/margin|cost (reduction|optimi[sz]ation)|efficien/i.test(s)) return "Margins / cost";
  if (/launch|product|portfolio|anda|brand/i.test(s)) return "Products";
  if (/export|international|geograph|overseas|market entry/i.test(s)) return "Geographic expansion";
  if (/acqui|merger|divest|demerg/i.test(s)) return "M&A / restructuring";
  if (/digital|technology|automation|ai\b/i.test(s)) return "Digital / technology";
  if (/dividend|buy-?back|payout/i.test(s)) return "Shareholder returns";
  if (/esg|emission|renewable|net zero|carbon|sustainab/i.test(s)) return "ESG / regulatory";
  if (/revenue|growth|volume|sales/i.test(s)) return "Growth";
  return "Other";
}

/** Auto-detect candidate strategic statements (forward-looking + quantified). Users confirm them. */
export function detectStrategyCandidates(
  pages: { n: number; text: string; types: StatementType[] }[],
  doc: { id: string; name: string; fy?: number },
  max = 40,
): StrategyItem[] {
  const out: StrategyItem[] = [];
  for (const p of pages) {
    const relevant = p.types.some((t) => ["mdna", "chairman", "board-report"].includes(t)) || p.types.length === 0;
    if (!relevant) continue;
    for (const s of splitSentences(p.text)) {
      if (digitRatio(s) > 0.3) continue;
      if (!FWD_RE.test(s)) continue;
      const quant = QUANT_RE.test(s);
      if (!quant && !/(strategy|priorit|expand|launch|reduce|commission)/i.test(s)) continue;
      const horizon = (s.match(/\b(by|in|during|over)\s+(fy\s?'?\d{2,4}|20\d{2}(-\d{2})?|the next \w+ (years?|quarters?))/i) || [])[0] ?? "Not stated";
      const investment = (s.match(/₹\s?[\d,.]+\s?(crore|cr|lakh|million|billion|bn)?/i) || [])[0] ?? "Not disclosed";
      out.push({
        id: `st-${doc.id.slice(0, 6)}-${p.n}-${out.length}`,
        statement: s.slice(0, 600),
        docId: doc.id,
        docName: doc.name,
        page: p.n,
        fy: doc.fy,
        objective: "",
        category: categorise(s),
        expectedEffect: "",
        investment,
        executionRisks: "",
        horizon,
        measurable: quant,
        progressReported: false,
        status: "insufficient-evidence",
        evidence: "",
        origin: "auto-detected",
        confirmed: false,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}
