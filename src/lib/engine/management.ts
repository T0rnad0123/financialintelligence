// Management guidance vs reported outcomes — deterministic comparison.
import type { GuidanceItem } from "../types";
import type { FactView } from "./core";
import { ebitdaOp } from "./metrics";

export interface GuidanceEval {
  status: "achieved" | "partially-achieved" | "not-achieved" | "pending" | "insufficient-evidence";
  actual: number | null;
  actualLabel: string;
  explanation: string;
}

export const GUIDANCE_METRICS: { value: GuidanceItem["metric"]; label: string; unit: "%" | "₹ cr" }[] = [
  { value: "revenueGrowth", label: "Revenue growth (%)", unit: "%" },
  { value: "revenue", label: "Revenue (₹ cr)", unit: "₹ cr" },
  { value: "ebitdaMargin", label: "EBITDA margin (%)", unit: "%" },
  { value: "capex", label: "Capital expenditure (₹ cr)", unit: "₹ cr" },
  { value: "totalDebt", label: "Total debt (₹ cr)", unit: "₹ cr" },
  { value: "netDebt", label: "Net debt (₹ cr)", unit: "₹ cr" },
  { value: "pat", label: "PAT (₹ cr)", unit: "₹ cr" },
  { value: "custom", label: "Custom (enter actual)", unit: "₹ cr" },
];

export function actualFor(view: FactView, g: GuidanceItem): { value: number | null; label: string } {
  const p = `FY${g.targetFy}`;
  const v = (k: string, pid = p) => view.get(pid, k)?.value ?? null;
  switch (g.metric) {
    case "revenueGrowth": {
      const a = v("revenue");
      const b = v("revenue", `FY${g.targetFy - 1}`);
      return { value: a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null, label: "Revenue growth" };
    }
    case "revenue":
      return { value: v("revenue"), label: "Revenue" };
    case "ebitdaMargin": {
      const e = ebitdaOp(view, p).value;
      const r = v("revenue");
      return { value: e !== null && r ? (e / r) * 100 : null, label: "EBITDA margin" };
    }
    case "capex":
      return { value: v("capexTotal"), label: "Capex" };
    case "totalDebt":
      return { value: v("totalDebt"), label: "Total debt" };
    case "netDebt": {
      const d = v("totalDebt");
      const c = v("cash");
      return { value: d !== null && c !== null ? d - c - (v("otherBankBalances") ?? 0) : null, label: "Net debt" };
    }
    case "pat":
      return { value: v("pat"), label: "PAT" };
    default:
      return { value: g.customActual ?? null, label: g.customLabel ?? "Custom" };
  }
}

export function evaluateGuidance(view: FactView, g: GuidanceItem, latestFy: number | null): GuidanceEval {
  const a = actualFor(view, g);
  if (a.value === null) {
    if (latestFy !== null && g.targetFy > latestFy) return { status: "pending", actual: null, actualLabel: a.label, explanation: `Target year FY${g.targetFy} has not been reported yet (latest available FY${latestFy}).` };
    return { status: "insufficient-evidence", actual: null, actualLabel: a.label, explanation: "The reported outcome for the target year is not available in the uploaded documents." };
  }
  const t = g.target;
  const pctMetric = g.metric === "revenueGrowth" || g.metric === "ebitdaMargin";
  let status: GuidanceEval["status"];
  if (g.direction === "at-least") {
    if (a.value >= t) status = "achieved";
    else if (pctMetric ? a.value >= t - 2 : a.value >= t * 0.85) status = "partially-achieved";
    else status = "not-achieved";
  } else {
    if (a.value <= t) status = "achieved";
    else if (pctMetric ? a.value <= t + 2 : a.value <= t * 1.15) status = "partially-achieved";
    else status = "not-achieved";
  }
  const tol = pctMetric ? "within 2 pp" : "within 15%";
  return { status, actual: a.value, actualLabel: a.label, explanation: `Target ${g.direction === "at-least" ? "≥" : "≤"} ${t}${pctMetric ? "%" : " cr"} vs actual ${a.value.toFixed(pctMetric ? 1 : 0)}${pctMetric ? "%" : " cr"} in FY${g.targetFy}. 'Partially achieved' = missed but ${tol}.` };
}
