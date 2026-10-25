// Deterministic calculation primitives with full traceability.
// Missing data is never treated as zero: operands carry `null` plus the list
// of missing inputs, and every metric reports *why* it could not be computed.
import type { DataPoint, PeriodFacts, SectorKey, SourceRef, ValueStatus } from "../types";
import { itemLabel } from "../lineItems";

export type MetricUnit = "cr" | "pct" | "x" | "days" | "rs" | "count" | "num";
export type MetricStatus = "ok" | "insufficient-data" | "not-meaningful" | "not-applicable";

export interface Part {
  label: string;
  periodId: string;
  value: number | null;
  status: ValueStatus;
  source?: SourceRef;
  note?: string;
}

export interface Operand {
  label: string;
  value: number | null;
  parts: Part[];
  missing: string[];
  notes: string[];
  lowConfidence: boolean;
}

export interface MetricResult {
  key: string;
  name: string;
  periodId: string;
  value: number | null;
  unit: MetricUnit;
  formula: string;
  numerator?: { label: string; value: number | null };
  denominator?: { label: string; value: number | null };
  inputs: Part[];
  status: MetricStatus;
  reason?: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
  prev?: number | null;
  change?: number | null;
  interpretation?: string;
}

export interface FactView {
  get(periodId: string, key: string): DataPoint | undefined;
  periods: Record<string, PeriodFacts>;
}

export function makeView(periods: Record<string, PeriodFacts>): FactView {
  return { periods, get: (p, k) => periods[p]?.[k] };
}

export function item(view: FactView, periodId: string, key: string, label?: string): Operand {
  const dp = view.get(periodId, key);
  const lbl = label ?? itemLabel(key);
  if (!dp || dp.value === null || dp.value === undefined || !Number.isFinite(dp.value)) {
    return { label: lbl, value: null, parts: [{ label: lbl, periodId, value: null, status: "missing" }], missing: [`${lbl} (${periodId})`], notes: [], lowConfidence: false };
  }
  return {
    label: lbl,
    value: dp.value,
    parts: [{ label: lbl, periodId, value: dp.value, status: dp.status, source: dp.source, note: dp.note }],
    missing: [],
    notes: dp.note && dp.status === "derived" ? [dp.note] : [],
    lowConfidence: dp.confidence === "low",
  };
}

export function constant(label: string, value: number | null): Operand {
  return { label, value, parts: [], missing: value === null ? [label] : [], notes: [], lowConfidence: false };
}

function combine(label: string, ops: Operand[], f: (vals: number[]) => number): Operand {
  const missing = ops.flatMap((o) => o.missing);
  const parts = ops.flatMap((o) => o.parts);
  const notes = [...new Set(ops.flatMap((o) => o.notes))];
  const low = ops.some((o) => o.lowConfidence);
  if (ops.some((o) => o.value === null)) return { label, value: null, parts, missing, notes, lowConfidence: low };
  return { label, value: f(ops.map((o) => o.value as number)), parts, missing: [], notes, lowConfidence: low };
}

export const add = (label: string, ...ops: Operand[]) => combine(label, ops, (v) => v.reduce((a, b) => a + b, 0));
export const sub = (label: string, a: Operand, b: Operand) => combine(label, [a, b], ([x, y]) => x - y);
export const mul = (label: string, a: Operand, b: Operand) => combine(label, [a, b], ([x, y]) => x * y);
export const absOp = (label: string, a: Operand) => combine(label, [a], ([x]) => Math.abs(x));
export const negOp = (label: string, a: Operand) => combine(label, [a], ([x]) => -x);

/** Sum where some components may be legitimately absent: requires at least `minPresent` present. */
export function addAvailable(label: string, ops: Operand[], minPresent = 1): Operand {
  const present = ops.filter((o) => o.value !== null);
  if (present.length < minPresent) return combine(label, ops, (v) => v.reduce((a, b) => a + b, 0));
  const r = combine(label, present, (v) => v.reduce((a, b) => a + b, 0));
  const absent = ops.filter((o) => o.value === null).map((o) => o.label);
  if (absent.length) r.notes = [...r.notes, `${absent.join(", ")} not available — excluded from ${label}.`];
  return r;
}

/** Average of opening and closing balances; falls back to closing balance with a disclosed limitation. */
export function average(label: string, closing: Operand, opening: Operand): Operand {
  if (closing.value !== null && opening.value !== null) {
    return combine(`Average ${label}`, [closing, opening], ([a, b]) => (a + b) / 2);
  }
  if (closing.value !== null) {
    return { ...closing, label: `${label} (closing)`, notes: [...closing.notes, `Opening ${label} unavailable — closing balance used instead of average.`] };
  }
  return { ...closing, label: `Average ${label}` };
}

export function safeDivide(n: number | null, d: number | null): number | null {
  if (n === null || d === null) return null;
  if (d === 0 || !Number.isFinite(d)) return null;
  const r = n / d;
  return Number.isFinite(r) ? r : null;
}

export interface RatioOptions {
  key: string;
  name: string;
  unit: MetricUnit;
  formula: string;
  periodId: string;
  scale?: number; // e.g. 100 for %, 365 for days
  /** Denominator must be positive for the ratio to be meaningful. */
  requirePositiveDenominator?: boolean;
  requirePositiveNumerator?: boolean;
  notMeaningfulReason?: string;
}

export function ratio(num: Operand, den: Operand, o: RatioOptions): MetricResult {
  const base = {
    key: o.key,
    name: o.name,
    periodId: o.periodId,
    unit: o.unit,
    formula: o.formula,
    numerator: { label: num.label, value: num.value },
    denominator: { label: den.label, value: den.value },
    inputs: [...num.parts, ...den.parts],
    notes: [...new Set([...num.notes, ...den.notes])],
  };
  const missing = [...num.missing, ...den.missing];
  if (num.value === null || den.value === null) {
    return { ...base, value: null, status: "insufficient-data", reason: `Missing: ${[...new Set(missing)].join("; ")}`, confidence: "low" };
  }
  if (den.value === 0) {
    return { ...base, value: null, status: "not-meaningful", reason: `${den.label} is zero — ratio undefined.`, confidence: "low" };
  }
  if (o.requirePositiveDenominator && den.value < 0) {
    return { ...base, value: null, status: "not-meaningful", reason: o.notMeaningfulReason ?? `${den.label} is negative — ratio not meaningful.`, confidence: "low" };
  }
  if (o.requirePositiveNumerator && num.value < 0) {
    return { ...base, value: null, status: "not-meaningful", reason: o.notMeaningfulReason ?? `${num.label} is negative — ratio not meaningful.`, confidence: "low" };
  }
  const value = (num.value / den.value) * (o.scale ?? 1);
  const derivedInputs = base.inputs.some((p) => p.status === "derived" || p.status === "estimated");
  const confidence = num.lowConfidence || den.lowConfidence ? "low" : derivedInputs || base.notes.length ? "medium" : "high";
  return { ...base, value, status: "ok", confidence };
}

export function amount(op: Operand, o: Omit<RatioOptions, "scale">): MetricResult {
  const base = {
    key: o.key,
    name: o.name,
    periodId: o.periodId,
    unit: o.unit,
    formula: o.formula,
    inputs: op.parts,
    notes: op.notes,
  };
  if (op.value === null) {
    return { ...base, value: null, status: "insufficient-data", reason: `Missing: ${[...new Set(op.missing)].join("; ")}`, confidence: "low" };
  }
  const derivedInputs = op.parts.some((p) => p.status === "derived" || p.status === "estimated") || op.parts.length > 1;
  return { ...base, value: op.value, status: "ok", confidence: op.lowConfidence ? "low" : derivedInputs || op.notes.length ? "medium" : "high" };
}

export function na(key: string, name: string, periodId: string, unit: MetricUnit, formula: string, reason: string): MetricResult {
  return { key, name, periodId, value: null, unit, formula, inputs: [], status: "not-applicable", reason, confidence: "low", notes: [] };
}

export function growthRate(cur: number | null, prev: number | null): { value: number | null; reason?: string } {
  if (cur === null || prev === null) return { value: null, reason: "Missing current or prior-period value." };
  if (prev === 0) return { value: null, reason: "Prior-period value is zero — growth undefined." };
  if (prev < 0) return { value: null, reason: "Prior-period value is negative — percentage growth not meaningful." };
  return { value: (cur / prev - 1) * 100 };
}

/** Compound annual growth rate in % between two values `years` apart. */
export function cagr(end: number | null, start: number | null, years: number): { value: number | null; reason?: string } {
  if (end === null || start === null) return { value: null, reason: "Missing start or end value." };
  if (years <= 0) return { value: null, reason: "Period length must be positive." };
  if (start <= 0 || end <= 0) return { value: null, reason: "CAGR requires positive start and end values." };
  return { value: (Math.pow(end / start, 1 / years) - 1) * 100 };
}

export function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const FINANCIAL_SECTORS: SectorKey[] = ["bank", "nbfc", "insurance"];
export const isFinancial = (s: SectorKey) => FINANCIAL_SECTORS.includes(s);

export function fmtNum(v: number | null | undefined, unit: MetricUnit = "cr", digits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const d = digits ?? (unit === "cr" ? (Math.abs(v) >= 1000 ? 0 : 2) : unit === "count" ? 0 : unit === "days" ? 0 : unit === "rs" ? 2 : 1);
  const s = v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (unit) {
    case "cr":
      return `₹${s} cr`;
    case "pct":
      return `${s}%`;
    case "x":
      return `${s}x`;
    case "days":
      return `${s} days`;
    case "rs":
      return `₹${s}`;
    default:
      return s;
  }
}
