// Pure parsing helpers: Indian number formats, units, dates and periods.
import type { PeriodRef, UnitKey } from "../types";

/** Multiplier converting a value in `unit` to INR crore. */
export const UNIT_TO_CRORE: Record<UnitKey, number> = {
  rupees: 1e-7,
  thousand: 1e-4,
  lakh: 1e-2,
  million: 0.1,
  crore: 1,
  billion: 100,
};

export const UNIT_LABEL: Record<UnitKey, string> = {
  rupees: "₹ (absolute)",
  thousand: "₹ thousand",
  lakh: "₹ lakh",
  million: "₹ million",
  crore: "₹ crore",
  billion: "₹ billion",
};

export function toCrore(value: number, unit: UnitKey): number {
  return value * UNIT_TO_CRORE[unit];
}

const NUM_RE = /^\(?[-−–]?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\)?$|^\(?[-−–]?\d+(?:\.\d+)?\)?$/;
const NIL_RE = /^(?:-|–|—|−|nil|\*|--)$/i;

/** True when the token looks like a financial figure (incl. nil dash). */
export function isNumericToken(tok: string): boolean {
  const t = tok.trim();
  return NUM_RE.test(t) || NIL_RE.test(t);
}

export interface ParsedNumber {
  value: number;
  nil: boolean;
  raw: string;
}

/**
 * Parse Indian / international formatted numbers.
 *  "1,23,456.78" -> 123456.78 ; "(1,234.5)" -> -1234.5 ; "-" -> 0 (nil)
 */
export function parseNumber(tok: string): ParsedNumber | null {
  const raw = tok.trim();
  if (NIL_RE.test(raw)) return { value: 0, nil: true, raw };
  if (!NUM_RE.test(raw)) return null;
  let s = raw.replace(/₹|rs\.?/gi, "").replace(/\s/g, "");
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  } else if (s.startsWith("(") || s.endsWith(")")) {
    s = s.replace(/[()]/g, "");
  }
  if (/^[-−–]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return { value: neg ? -v : v, nil: false, raw };
}

/** Detect the reporting unit in a block of text. Returns null if none found. */
export function detectUnit(text: string): UnitKey | null {
  const t = text.replace(/\s+/g, " ");
  const re =
    /(?:₹|rs\.?|inr|rupees|amount)\s*(?:in\s*)?[(\[]?\s*(?:in\s*)?(crores?|cr\.?|lakhs?|lacs?|millions?|mn|billions?|bn|thousands?|'000)\b|(?:in|figures in|amounts? in|all amounts in)\s*(?:₹|rs\.?|inr)?\s*(crores?|lakhs?|lacs?|millions?|billions?|thousands?)\b|\b(crores?|lakhs?|lacs?|millions?|thousands?)\s*(?:of\s*)?(?:₹|rs\.?|inr|rupees)/i;
  const m = t.match(re);
  if (!m) return null;
  const w = (m[1] || m[2] || m[3] || "").toLowerCase();
  if (w.startsWith("cr")) return "crore";
  if (w.startsWith("lakh") || w.startsWith("lac")) return "lakh";
  if (w.startsWith("million") || w === "mn") return "million";
  if (w.startsWith("billion") || w === "bn") return "billion";
  if (w.startsWith("thousand") || w === "'000") return "thousand";
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface DateHit {
  year: number;
  month: number;
  day: number;
  index: number; // char index in the string
  length: number;
  /** "fy" when the token was a financial-year label like FY2023-24. */
  form: "date" | "fy";
}

function normYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Find period-end dates and FY labels in a header string. */
export function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const push = (h: DateHit) => {
    if (h.year < 1990 || h.year > 2100 || h.month < 1 || h.month > 12) return;
    if (hits.some((x) => x.index < h.index + h.length && h.index < x.index + x.length)) return;
    hits.push(h);
  };
  let m: RegExpExecArray | null;
  // 31.03.2024 | 31-03-2024 | 31/03/24
  const r1 = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g;
  while ((m = r1.exec(text))) push({ day: +m[1], month: +m[2], year: normYear(m[3]), index: m.index, length: m[0].length, form: "date" });
  // 31st March, 2024 | 31 March 2024 | 31-Mar-24
  const r2 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,.-]+(\d{4}|\d{2})\b/gi;
  while ((m = r2.exec(text))) push({ day: +m[1], month: MONTHS[m[2].toLowerCase()], year: normYear(m[3]), index: m.index, length: m[0].length, form: "date" });
  // March 31, 2024
  const r3 = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while ((m = r3.exec(text))) push({ day: +m[2], month: MONTHS[m[1].toLowerCase()], year: normYear(m[3]), index: m.index, length: m[0].length, form: "date" });
  // FY 2023-24 | FY24 | F.Y. 2023-2024 | 2023-24
  const r4 = /\b(?:f\.?y\.?\s*)?(20\d{2})\s*[-–/]\s*(\d{2}|\d{4})\b/gi;
  while ((m = r4.exec(text))) {
    const start = Number(m[1]);
    const endRaw = m[2];
    const end = endRaw.length === 2 ? Math.floor(start / 100) * 100 + Number(endRaw) : Number(endRaw);
    if (end === start + 1) push({ day: 31, month: 3, year: end, index: m.index, length: m[0].length, form: "fy" });
  }
  const r5 = /\bfy\s*'?(\d{2}|\d{4})\b/gi;
  while ((m = r5.exec(text))) push({ day: 31, month: 3, year: normYear(m[1]), index: m.index, length: m[0].length, form: "fy" });
  return hits.sort((a, b) => a.index - b.index);
}

/** Financial-year (ending year) containing a calendar month/year, given FY end month. */
export function fyOf(year: number, month: number, fyEndMonth = 3): number {
  return month <= fyEndMonth ? year : year + 1;
}

/** Quarter number (1-4) of a quarter ending in `month`. */
export function quarterOf(month: number, fyEndMonth = 3): 1 | 2 | 3 | 4 {
  const offset = (month - fyEndMonth - 1 + 12) % 12; // months after FY start
  return (Math.floor(offset / 3) + 1) as 1 | 2 | 3 | 4;
}

export function fyLabel(fy: number, fyEndMonth = 3): string {
  if (fyEndMonth === 12) return `CY${fy}`;
  return `FY${fy - 1}-${String(fy).slice(2)}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function fyPeriod(fy: number, fyEndMonth = 3): PeriodRef {
  const endDate = `${fy}-${String(fyEndMonth).padStart(2, "0")}-${String(lastDay(fy, fyEndMonth)).padStart(2, "0")}`;
  return { id: `FY${fy}`, kind: "FY", fy, endDate, label: fyLabel(fy, fyEndMonth) };
}

export function quarterPeriod(q: 1 | 2 | 3 | 4, fy: number, fyEndMonth = 3): PeriodRef {
  // quarter end month
  let month = fyEndMonth + 3 * q; // months after previous FY end
  let year = fy - 1;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay(year, month)).padStart(2, "0")}`;
  return { id: `Q${q}FY${fy}`, kind: "Q", fy, q, endDate, label: `Q${q} ${fyLabel(fy, fyEndMonth)}` };
}

export function parsePeriodId(id: string, fyEndMonth = 3): PeriodRef | null {
  let m = id.match(/^FY(\d{4})$/);
  if (m) return fyPeriod(Number(m[1]), fyEndMonth);
  m = id.match(/^Q([1-4])FY(\d{4})$/);
  if (m) return quarterPeriod(Number(m[1]) as 1 | 2 | 3 | 4, Number(m[2]), fyEndMonth);
  return null;
}

/** Sort key: chronological by end date; FY after its Q4. */
export function periodSortKey(id: string): number {
  const p = parsePeriodId(id);
  if (!p) return 0;
  return p.kind === "FY" ? p.fy * 10 + 5 : p.fy * 10 + (p.q ?? 0);
}

export function sortPeriodIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => periodSortKey(a) - periodSortKey(b));
}

/** Simple non-cryptographic content hash (FNV-1a over sampled bytes) for duplicate detection. */
export function quickHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 200000));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length.toString(16)}-${h.toString(16)}`;
}
