// Deterministic parser for financial statement pages (Indian formats).
import type { Basis, Confidence, DocKind, ExtractedFact, StatementType, UnitKey } from "../types";
import { ITEM_MAP, matchLineItem, normalizeLabel, type LineItemDef, type Statement } from "../lineItems";
import { buildLines, splitLabelNumbers, xCenterOfRange, xStartOfRange, type Line, type TextItem } from "./layout";
import {
  detectUnit,
  findDates,
  fyOf,
  parseNumber,
  quarterOf,
  toCrore,
  UNIT_LABEL,
} from "./parseUtils";

export interface PageClassification {
  types: StatementType[];
  basis?: Basis;
  unit?: UnitKey | null;
  title: string;
}

const TITLE_RULES: { type: StatementType; re: RegExp }[] = [
  { type: "quarterly-results", re: /(statement of )?(un-?audited|audited)?\s*(standalone |consolidated )?(financial )?results for the (quarter|three months|period|half|nine months|year)|financial results for the quarter/i },
  { type: "balance-sheet", re: /balance sheet as (at|on)|(standalone|consolidated) balance sheet|statement of assets and liabilities/i },
  { type: "profit-loss", re: /statement of profit (and|&) loss|profit (and|&) loss (account|statement)/i },
  { type: "cash-flow", re: /cash flow statement|statement of cash flows?/i },
  { type: "equity-changes", re: /statement of changes in equity/i },
  { type: "auditor-report", re: /independent auditor'?s'? report|report of the (statutory )?auditors?/i },
  { type: "mdna", re: /management('s)? discussion (and|&) analysis/i },
  { type: "board-report", re: /(board'?s|directors'?) report/i },
  { type: "chairman", re: /chairman'?s (message|statement|letter|speech)|message from the (chairman|managing director|ceo)|(managing director|md|ceo)'?s? (message|letter|desk)|letter to (the )?shareholders/i },
  { type: "corporate-governance", re: /report on corporate governance|corporate governance report/i },
  { type: "related-party", re: /related party (transactions|disclosures)/i },
  { type: "contingent", re: /contingent liabilities/i },
  { type: "accounting-policies", re: /(significant|material) accounting policies/i },
  { type: "segment", re: /segment (information|reporting|wise|revenue)|operating segments/i },
  { type: "risk", re: /risk management|risks? (and|&) concerns|risk factors/i },
];

/** Classify a page by looking at title-area lines (first ~12 lines) and the full text. */
export function classifyPage(lines: Line[], fullText: string): PageClassification {
  const top = lines.slice(0, 14).map((l) => l.text).join(" \n ");
  const types: StatementType[] = [];
  for (const r of TITLE_RULES) {
    if (r.re.test(top)) types.push(r.type);
  }
  // Weaker detection for notes/narratives anywhere on the page
  if (!types.includes("related-party") && /related party transactions/i.test(fullText) && /relationship/i.test(fullText)) types.push("related-party");
  if (!types.includes("contingent") && /contingent liabilit/i.test(fullText) && /not acknowledged as debts?|guarantees/i.test(fullText)) types.push("contingent");
  if (!types.includes("segment") && /segment (revenue|results)/i.test(fullText)) types.push("segment");
  // Statement pages should not be classified as narrative notes that merely mention them
  if (types.includes("balance-sheet") && /notes? to (the )?(standalone |consolidated )?financial statements/i.test(lines.slice(0, 4).map((l) => l.text).join(" ")) && !/balance sheet as (at|on)/i.test(top)) {
    types.splice(types.indexOf("balance-sheet"), 1);
  }
  let basis: Basis | undefined;
  const hasCons = /consolidated/i.test(top);
  const hasStand = /standalone|stand-alone/i.test(top);
  if (hasCons && !hasStand) basis = "consolidated";
  else if (hasStand && !hasCons) basis = "standalone";
  const unit = detectUnit(lines.slice(0, 25).map((l) => l.text).join(" ")) ?? detectUnit(fullText);
  const title = lines.slice(0, 3).map((l) => l.text).join(" | ").slice(0, 160);
  return { types: [...new Set(types)], basis, unit, title };
}

export const NUMERIC_STATEMENT_TYPES: StatementType[] = ["balance-sheet", "profit-loss", "cash-flow", "quarterly-results", "segment"];

type ColKind = "Q" | "FY" | "YTD" | "ASAT" | "unknown";

export interface Column {
  x: number;
  periodId: string | null;
  kind: ColKind;
  dateText: string;
}

const PHRASES: { kind: ColKind; re: RegExp }[] = [
  { kind: "Q", re: /(quarter|three months|3 months)\s*(ended|ending)?/gi },
  { kind: "YTD", re: /(half[- ]year|six months|6 months|nine months|9 months|year to date|ytd)\s*(ended|ending)?/gi },
  { kind: "FY", re: /(year|twelve months|12 months)\s*(ended|ending)|financial year|previous year|current year/gi },
  { kind: "ASAT", re: /\bas (at|on)\b/gi },
];

interface PhraseHit {
  kind: ColKind;
  lineIdx: number;
  x0: number;
  xc: number;
  xEnd: number; // start of next phrase on same line (or +inf)
}

export interface ParseContext {
  docId: string;
  docName: string;
  docKind: DocKind;
  fyEndMonth: number;
  declaredFy?: number;
  periodHint?: { q: 1 | 2 | 3 | 4; fy: number };
  unit: UnitKey | null;
  basis: Basis;
  pageNumber: number;
  method: "parser" | "ocr";
}

export interface PageParseResult {
  facts: ExtractedFact[];
  columns: Column[];
  warnings: string[];
  segments: { segment: string; metric: "revenue" | "result" | "assets" | "liabilities" | "capex"; periodId: string; value: number; rawText: string; rawValue: string }[];
  matchedLines: number;
}

function allowedStatements(types: StatementType[]): Set<Statement> {
  const s = new Set<Statement>();
  if (types.includes("profit-loss") || types.includes("quarterly-results")) {
    s.add("pl");
    s.add("share");
    s.add("bank");
    s.add("sector");
  }
  if (types.includes("balance-sheet") || types.includes("quarterly-results")) {
    s.add("bs");
    s.add("bank");
    s.add("sector");
    s.add("share");
  }
  if (types.includes("cash-flow") || types.includes("quarterly-results")) s.add("cf");
  return s;
}

/** Detect period columns from the header area (lines above the first item line). */
export function detectColumns(lines: Line[], headerEnd: number, ctx: ParseContext): { columns: Column[]; noteX: number | null } {
  const dateHits: { x: number; lineIdx: number; year: number; month: number; text: string; form: "date" | "fy" }[] = [];
  const phrases: PhraseHit[] = [];
  let noteX: number | null = null;
  for (let li = 0; li < headerEnd; li++) {
    const line = lines[li];
    if (line.text.length > 400) continue;
    const isTitle = /(statement of|results for|balance sheet|profit (and|&) loss|cash flows?|financial results|annual report)/i.test(line.text);
    for (const d of findDates(line.text)) {
      // dates inside titles / sentences are not column headers
      if (isTitle) continue;
      const wordsBefore = line.text.slice(0, d.index).trim().split(/\s+/).filter(Boolean).length;
      if (wordsBefore >= 8 && findDates(line.text).length === 1) continue;
      const x = xCenterOfRange(line, d.index, d.length);
      if (Number.isFinite(x)) dateHits.push({ x, lineIdx: li, year: d.year, month: d.month, text: line.text.substr(d.index, d.length), form: d.form });
    }
    const lineHits: { kind: ColKind; x0: number; xc: number }[] = [];
    for (const p of PHRASES) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(line.text))) {
        const x0 = xStartOfRange(line, m.index);
        const xc = xCenterOfRange(line, m.index, m[0].length);
        if (Number.isFinite(x0)) lineHits.push({ kind: p.kind, x0, xc: Number.isFinite(xc) ? xc : x0 });
      }
    }
    lineHits.sort((a, b) => a.x0 - b.x0);
    lineHits.forEach((h, i) => phrases.push({ kind: h.kind, lineIdx: li, x0: h.x0, xc: h.xc, xEnd: i + 1 < lineHits.length ? lineHits[i + 1].x0 : Infinity }));
    const nm = line.text.match(/\bnotes?( no\.?)?\b/i);
    if (nm && noteX === null) {
      const x = xCenterOfRange(line, nm.index ?? 0, nm[0].length);
      if (Number.isFinite(x)) noteX = x;
    }
  }
  // collapse date hits that share a column (same x within 12pt) keeping the lowest line
  dateHits.sort((a, b) => a.x - b.x || b.lineIdx - a.lineIdx);
  const cols: typeof dateHits = [];
  for (const d of dateHits) {
    const c = cols.find((k) => Math.abs(k.x - d.x) < 12);
    if (!c) cols.push(d);
  }
  cols.sort((a, b) => a.x - b.x);

  const columns: Column[] = cols.map((d) => {
    // nearest phrase: same line to the left, else lines above with span covering x
    let kind: ColKind = "unknown";
    let best: PhraseHit | undefined;
    // 1) phrase on the same line, immediately to the left of the date ("Year ended 31.03.2024")
    for (const p of phrases) {
      if (p.lineIdx !== d.lineIdx || p.x0 > d.x || d.x >= p.xEnd + 5) continue;
      if (!best || p.x0 > best.x0) best = p;
    }
    // 2) otherwise the nearest header line above: phrase whose centre is closest (handles centred group headers)
    if (!best) {
      const above = phrases.filter((p) => p.lineIdx < d.lineIdx);
      const nearestLine = above.reduce((mx, p) => Math.max(mx, p.lineIdx), -1);
      for (const p of above.filter((q) => q.lineIdx === nearestLine)) {
        if (!best || Math.abs(p.xc - d.x) < Math.abs(best.xc - d.x)) best = p;
      }
    }
    if (best) kind = best.kind;
    if (d.form === "fy") kind = "FY";
    return { x: d.x, periodId: null, kind, dateText: d.text, _y: d.year, _m: d.month } as Column & { _y: number; _m: number };
  });

  // Resolve period ids
  const seen = new Map<string, number>();
  columns.forEach((c) => {
    const cc = c as Column & { _y: number; _m: number };
    const key = `${cc._y}-${cc._m}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    let kind = c.kind;
    const isFyEnd = cc._m === ctx.fyEndMonth;
    if (kind === "unknown") {
      if (ctx.docKind === "annual") kind = isFyEnd ? "FY" : "unknown";
      else if (!isFyEnd) kind = count === 1 ? "Q" : "YTD";
      else {
        // quarterly doc, March date: first occurrence is the quarter, second the year
        const total = cols.filter((k) => k.year === cc._y && k.month === cc._m).length;
        kind = total >= 2 ? (count === 1 ? "Q" : "FY") : "unknown";
      }
    }
    if (kind === "ASAT") kind = isFyEnd ? "FY" : "Q";
    c.kind = kind;
    if (kind === "Q") c.periodId = `Q${quarterOf(cc._m, ctx.fyEndMonth)}FY${fyOf(cc._y, cc._m, ctx.fyEndMonth)}`;
    else if (kind === "FY") c.periodId = isFyEnd ? `FY${fyOf(cc._y, cc._m, ctx.fyEndMonth)}` : null;
    else c.periodId = null;
  });
  return { columns, noteX };
}

const BS_SECTION_RE: { re: RegExp; section: string }[] = [
  { re: /^non[- ]current assets/i, section: "nca" },
  { re: /^current assets/i, section: "ca" },
  { re: /^non[- ]current liabilities/i, section: "ncl" },
  { re: /^current liabilities/i, section: "cl" },
  { re: /^equity( and liabilities)?$/i, section: "eq" },
];

function sectionAwareItem(norm: string, section: string | null): LineItemDef | null {
  if (/^(financial liabilities - |\(i\) )?borrowings$/.test(norm)) {
    if (section === "cl") return ITEM_MAP.shortTermBorrowings;
    if (section === "ncl") return ITEM_MAP.longTermBorrowings;
  }
  if (/^(financial assets - )?investments$/.test(norm) && section === "ca") return ITEM_MAP.currentInvestments;
  if (/^(financial assets - )?investments$/.test(norm) && section === "nca") return ITEM_MAP.nonCurrentInvestments;
  return null;
}

/** Items that must be summed when they appear in more than one section (e.g. lease liabilities NC + C). */
const SUM_ACROSS_SECTIONS = new Set(["leaseLiabilities"]);

const SEGMENT_HEADERS: { re: RegExp; metric: "revenue" | "result" | "assets" | "liabilities" | "capex" }[] = [
  { re: /^segment (revenue|income)/i, metric: "revenue" },
  { re: /^segment results?/i, metric: "result" },
  { re: /^segment assets/i, metric: "assets" },
  { re: /^segment liabilities/i, metric: "liabilities" },
  { re: /^(segment )?capital expenditure/i, metric: "capex" },
];

/** Parse one page of a document into normalised facts. */
export function parseStatementPage(lines: Line[], cls: PageClassification, ctx: ParseContext): PageParseResult {
  const res: PageParseResult = { facts: [], columns: [], warnings: [], segments: [], matchedLines: 0 };
  const allowed = allowedStatements(cls.types);
  if (allowed.size === 0 && !cls.types.includes("segment")) return res;

  // header ends at first line that has a recognised label + numbers
  let headerEnd = Math.min(lines.length, 40);
  for (let i = 0; i < lines.length; i++) {
    const sp = splitLabelNumbers(lines[i]);
    if (sp.numbers.length && matchLineItem(sp.label)) {
      headerEnd = i;
      break;
    }
  }
  const { columns, noteX } = detectColumns(lines, headerEnd, ctx);
  res.columns = columns;
  let usable = columns.filter((c) => c.periodId);
  let fallbackMode: "none" | "annual2" | "hint" = "none";
  if (usable.length === 0) {
    if (ctx.docKind === "annual" && ctx.declaredFy) fallbackMode = "annual2";
    else if (ctx.docKind === "quarterly" && ctx.periodHint) fallbackMode = "hint";
    else {
      res.warnings.push("Reporting periods could not be identified from the column headers on this page.");
      return res;
    }
  }
  if (!ctx.unit) {
    res.warnings.push("Reporting unit (crore / lakh / million) not detected on this page; values were not imported. Set the unit for this document and reprocess.");
    return res;
  }
  const unit = ctx.unit;
  const colGap = usable.length > 1 ? Math.min(...usable.slice(1).map((c, i) => c.x - usable[i].x)) : 80;
  const tol = Math.max(18, colGap * 0.55);
  const seen = new Map<string, ExtractedFact>();
  let section: string | null = null;
  for (let li = 0; li < headerEnd; li++) {
    const n0 = normalizeLabel(lines[li].text);
    for (const s0 of BS_SECTION_RE) if (s0.re.test(n0)) section = s0.section;
  }
  let prevLabelOnly = "";
  let segmentMetric: (typeof SEGMENT_HEADERS)[number]["metric"] | null = null;

  for (let li = headerEnd; li < lines.length; li++) {
    const line = lines[li];
    const sp = splitLabelNumbers(line);
    const norm = normalizeLabel(sp.label);
    for (const s of BS_SECTION_RE) if (s.re.test(norm)) section = s.section;
    const segHdr = SEGMENT_HEADERS.find((h) => h.re.test(norm));
    if (segHdr) segmentMetric = segHdr.metric;
    else if (segmentMetric && /^(capital employed|notes?:?$|statement of assets)/i.test(norm)) segmentMetric = null;
    if (sp.numbers.length === 0) {
      prevLabelOnly = sp.label;
      continue;
    }
    let def = sectionAwareItem(norm, section) ?? matchLineItem(sp.label);
    let labelUsed = sp.label;
    if (!def && prevLabelOnly && sp.label.length < 60) {
      const joined = `${prevLabelOnly} ${sp.label}`;
      const d2 = matchLineItem(joined);
      if (d2) {
        def = d2;
        labelUsed = joined;
      }
    }
    prevLabelOnly = "";

    // Map numeric tokens to columns
    let tokens = sp.numbers;
    if (noteX !== null) tokens = tokens.filter((w) => Math.abs((w.x0 + w.x1) / 2 - noteX!) > 14);
    const assigned: { periodId: string; raw: string; kind: ColKind }[] = [];
    if (fallbackMode === "none") {
      for (const w of tokens) {
        const xc = (w.x0 + w.x1) / 2;
        let best: Column | null = null;
        let bd = Infinity;
        for (const c of columns) {
          // right-aligned numbers: compare both centre and right edge
          const d = Math.min(Math.abs(c.x - xc), Math.abs(c.x - w.x1) + 4);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best && bd <= tol && best.periodId && !assigned.some((a) => a.periodId === best!.periodId)) {
          assigned.push({ periodId: best.periodId, raw: w.text, kind: best.kind });
        }
      }
    } else if (fallbackMode === "annual2") {
      let t = tokens.map((w) => w.text);
      if (t.length >= 3 && /^\d{1,2}(\.\d{1,2})?$/.test(t[0])) t = t.slice(1); // note number
      if (t.length >= 2) {
        assigned.push({ periodId: `FY${ctx.declaredFy}`, raw: t[t.length - 2], kind: "FY" });
        assigned.push({ periodId: `FY${(ctx.declaredFy ?? 0) - 1}`, raw: t[t.length - 1], kind: "FY" });
      } else if (t.length === 1) {
        assigned.push({ periodId: `FY${ctx.declaredFy}`, raw: t[0], kind: "FY" });
      }
    } else if (fallbackMode === "hint" && ctx.periodHint) {
      const t = tokens.map((w) => w.text).filter((x) => !/^\d{1,2}$/.test(x));
      if (t.length) assigned.push({ periodId: `Q${ctx.periodHint.q}FY${ctx.periodHint.fy}`, raw: t[0], kind: "Q" });
    }

    // Segment rows
    if (segmentMetric && !def && sp.label.trim().length > 1 && !/^(total|less|add|unallocable|inter[- ]?segment|net|income|expenses?|revenue from operations)/i.test(norm)) {
      const name = sp.label.replace(/^\s*(\(?[a-z0-9ivx]{1,4}[.)]\s*)+/i, "").trim();
      if (name.length >= 2 && name.length <= 80) {
        for (const a of assigned) {
          const pn = parseNumber(a.raw);
          if (!pn) continue;
          res.segments.push({ segment: name, metric: segmentMetric, periodId: a.periodId, value: toCrore(pn.value, unit), rawText: line.text, rawValue: a.raw });
        }
      }
      continue;
    }
    if (!def || !allowed.has(def.statement)) continue;
    res.matchedLines++;

    for (const a of assigned) {
      const pn = parseNumber(a.raw);
      if (!pn) continue;
      let value = pn.value;
      if (def.unit === "crore") value = toCrore(value, unit);
      if (def.absolute) value = Math.abs(value);
      // Balance-sheet (stock) items in quarterly docs: only "as at" columns make sense
      const conf: Confidence = fallbackMode === "none" ? (a.kind === "unknown" ? "low" : "high") : "medium";
      const fact: ExtractedFact = {
        basis: ctx.basis,
        periodId: a.periodId,
        item: def.key,
        value,
        confidence: conf,
        isPrimaryPeriod: false,
        source: {
          docId: ctx.docId,
          docName: ctx.docName,
          page: ctx.pageNumber,
          rawText: line.text.slice(0, 240),
          rawValue: a.raw,
          rawUnit: def.unit === "crore" ? UNIT_LABEL[unit] : def.unit === "perShare" ? "₹ per share" : def.unit === "pct" ? "%" : "count",
          method: ctx.method,
        },
      };
      const key = `${def.key}|${a.periodId}`;
      const prev = seen.get(key);
      if (prev) {
        if (SUM_ACROSS_SECTIONS.has(def.key)) {
          prev.value += value;
          prev.source.rawText = `${prev.source.rawText} + ${line.text.slice(0, 120)}`;
          prev.source.rawValue = `${prev.source.rawValue} + ${a.raw}`;
        }
        continue; // first occurrence wins
      }
      seen.set(key, fact);
      res.facts.push(fact);
    }
    // face value embedded in label: "Paid-up equity share capital (Face value ₹ 10 each)"
    if (def.key === "paidUpCapital") {
      const fv = labelUsed.match(/(?:face value|\bfv)\s*(?:of)?\s*(?:₹|rs\.?|inr|re\.?)?\s*([\d.]+)/i);
      if (fv) {
        for (const a of assigned) {
          const k = `faceValue|${a.periodId}`;
          if (seen.has(k)) continue;
          const f: ExtractedFact = {
            basis: ctx.basis,
            periodId: a.periodId,
            item: "faceValue",
            value: Number(fv[1]),
            confidence: "high",
            isPrimaryPeriod: false,
            source: { docId: ctx.docId, docName: ctx.docName, page: ctx.pageNumber, rawText: line.text.slice(0, 240), rawValue: fv[1], rawUnit: "₹ per share", method: ctx.method },
          };
          seen.set(k, f);
          res.facts.push(f);
        }
      }
    }
  }
  if (res.matchedLines === 0 && cls.types.some((t) => t !== "segment")) {
    res.warnings.push("Statement heading found but no recognisable line items were extracted from this page.");
  }
  return res;
}

/** Convenience: run the full page pipeline from raw text items. */
export function parsePageItems(items: TextItem[], ctx: Omit<ParseContext, "unit" | "basis"> & { unit: UnitKey | null; basis: Basis }) {
  const lines = buildLines(items);
  const text = lines.map((l) => l.text).join("\n");
  const cls = classifyPage(lines, text);
  const result = parseStatementPage(lines, cls, { ...ctx, unit: cls.unit ?? ctx.unit, basis: cls.basis ?? ctx.basis });
  return { lines, text, cls, result };
}
