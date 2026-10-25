"use client";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Callout, Card, CardBody, CardHeader, downloadText, Button, Label, NumberField, PageTitle, Slider, Tabs, toCsv, Toggle } from "@/components/ui";
import { TrendChart, type ChartSeries } from "@/components/analysis";
import { ebitdaOp } from "@/lib/engine/metrics";
import type { DcfScenario, ProjectionSettings } from "@/lib/types";
import type { ProjectionRow } from "@/lib/engine/projections";

const KEYS: { key: keyof ProjectionRow; label: string; unit: "cr" | "pct" | "rs" }[] = [
  { key: "revenue", label: "Revenue", unit: "cr" }, { key: "growth", label: "Revenue growth", unit: "pct" }, { key: "ebitda", label: "EBITDA", unit: "cr" }, { key: "ebitdaMargin", label: "EBITDA margin", unit: "pct" }, { key: "ebit", label: "EBIT", unit: "cr" }, { key: "interest", label: "Interest", unit: "cr" }, { key: "pat", label: "PAT", unit: "cr" }, { key: "eps", label: "EPS (₹)", unit: "rs" }, { key: "capex", label: "Capex", unit: "cr" }, { key: "deltaNwc", label: "Δ Working capital", unit: "cr" }, { key: "ocf", label: "Operating cash flow (model)", unit: "cr" }, { key: "fcf", label: "Free cash flow", unit: "cr" }, { key: "dividends", label: "Dividends", unit: "cr" }, { key: "debt", label: "Debt", unit: "cr" }, { key: "netDebt", label: "Net debt", unit: "cr" }, { key: "roce", label: "ROCE", unit: "pct" }, { key: "roic", label: "ROIC", unit: "pct" },
];

export default function ProjectionsPage() {
  const { project, analysis: a, update } = useProject();
  const [sc, setSc] = useState<"bear" | "base" | "bull">("base");
  const ps = project.settings.projection;
  const setP = (patch: Partial<ProjectionSettings>) => update((p) => ({ ...p, settings: { ...p.settings, projection: { ...p.settings.projection, ...patch } } }));
  const setS = (patch: Partial<DcfScenario>) => update((p) => ({ ...p, settings: { ...p.settings, valuation: { ...p.settings.valuation, scenarios: { ...p.settings.valuation.scenarios, [sc]: { ...p.settings.valuation.scenarios[sc], ...patch } } } } }));
  const proj = a.projections;
  const cur = proj[sc];
  const scen = project.settings.valuation.scenarios[sc];
  const hist = a.fys.slice(-4);
  const futureLabels = cur.rows.map((r) => r.label);
  const periods = [...hist, ...futureLabels];
  const histVal = (k: "revenue" | "pat" | "ebitda" | "fcf" | "netDebt") => Object.fromEntries(hist.map((p) => [p, k === "ebitda" ? ebitdaOp(a.view, p).value : k === "fcf" ? a.annual.fcf?.byPeriod[p]?.value ?? null : k === "netDebt" ? a.annual.netDebt?.byPeriod[p]?.value ?? null : a.view.get(p, k)?.value ?? null]));
  const sSeries = (k: keyof ProjectionRow, label: string): ChartSeries[] => [
    { key: `h-${String(k)}`, label: `${label} (reported)`, unit: "cr", type: "bar", color: "#94a3b8", values: histVal(k as "revenue") },
    ...(["bear", "base", "bull"] as const).map((s, i) => ({ key: `${s}-${String(k)}`, label: `${label} – ${s} (model)`, unit: "cr" as const, type: "line" as const, color: ["#b91c1c", "#1d4ed8", "#15803d"][i], values: Object.fromEntries(proj[s].rows.map((r) => [r.label, r[k] as number])) })),
  ];
  const guidance = a.guidance.filter((g) => ["revenue", "ebitdaMargin", "capex", "totalDebt", "netDebt", "pat", "revenueGrowth"].includes(g.item.metric));
  return (
    <div className="space-y-5">
      <PageTitle title="Five-year projections" subtitle="Model-generated estimates from explicit assumptions. Projections are estimates, not guarantees, and are never management forecasts." right={<Button size="sm" onClick={() => downloadText(`${project.name}_projections_${sc}.csv`, toCsv([["Item", ...futureLabels], ...KEYS.map((k) => [k.label, ...cur.rows.map((r) => (r[k.key] as number | null) ?? null)])]), "text/csv")}>Export CSV</Button>} />
      <div className="flex flex-wrap gap-2 text-xs"><Badge tone="purple">Management guidance</Badge><span className="text-ink-soft">= targets you recorded from reports</span><Badge tone="blue">Model projection</Badge><span className="text-ink-soft">= this engine's calculation</span><Badge tone="gold">User assumption</Badge><span className="text-ink-soft">= sliders below</span></div>
      {!cur.ok && <Callout tone="amber" title="Projection unavailable">{cur.errors.join(" ")}</Callout>}
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader title="Assumptions" right={<Tabs value={sc} onChange={setSc} tabs={[{ value: "bear", label: "Bear" }, { value: "base", label: "Base" }, { value: "bull", label: "Bull" }]} />} />
          <CardBody className="space-y-3">
            <Callout tone="gold">Shared with the DCF scenario of the same name on the Valuation page.</Callout>
            <Slider label="Revenue growth – year 1" value={scen.revenueGrowthStart} min={-20} max={50} step={0.5} onChange={(x) => setS({ revenueGrowthStart: x })} />
            <Slider label="Revenue growth – year 5+" value={scen.revenueGrowthEnd} min={-10} max={30} step={0.5} onChange={(x) => setS({ revenueGrowthEnd: x })} />
            <Slider label="EBIT margin – year 1" value={scen.ebitMarginStart} min={-10} max={60} step={0.5} onChange={(x) => setS({ ebitMarginStart: x })} />
            <Slider label="EBIT margin – year 5+" value={scen.ebitMarginEnd} min={-10} max={60} step={0.5} onChange={(x) => setS({ ebitMarginEnd: x })} />
            <Slider label="Capex (% revenue)" value={scen.capexPctRevenue} min={0} max={40} step={0.1} onChange={(x) => setS({ capexPctRevenue: x })} />
            <Slider label="D&A (% revenue)" value={scen.daPctRevenue} min={0} max={25} step={0.1} onChange={(x) => setS({ daPctRevenue: x })} />
            <Slider label="Working capital (% Δrevenue)" value={scen.nwcPctIncrementalRevenue} min={-30} max={80} step={0.5} onChange={(x) => setS({ nwcPctIncrementalRevenue: x })} />
            <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
              <div><Label hint="Blank = derived from history">Interest rate on debt %</Label><NumberField value={ps.interestRateOnDebt} onChange={(x) => setP({ interestRateOnDebt: x })} /></div>
              <div><Label hint="Blank = latest cash payout">Dividend payout %</Label><NumberField value={ps.payoutRatio} onChange={(x) => setP({ payoutRatio: x })} /></div>
            </div>
            <Toggle checked={ps.useFcfToRepayDebt} onChange={(x) => setP({ useFcfToRepayDebt: x })} label="Use surplus FCF to repay debt" />
            {!ps.useFcfToRepayDebt && <div><Label>Net borrowing (% of revenue p.a.)</Label><NumberField value={ps.netBorrowingPctRevenue} onChange={(x) => setP({ netBorrowingPctRevenue: x ?? 0 })} /></div>}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <div className="grid gap-4 2xl:grid-cols-2">
            <TrendChart title="Revenue: reported vs scenarios" periods={periods} series={sSeries("revenue", "Revenue")} />
            <TrendChart title="PAT: reported vs scenarios" periods={periods} series={sSeries("pat", "PAT")} />
            <TrendChart title="Free cash flow" periods={periods} series={sSeries("fcf", "FCF")} />
            <TrendChart title="Net debt" periods={periods} series={sSeries("netDebt", "Net debt")} />
          </div>
        </div>
      </div>
      <Card>
        <CardHeader title={`Projected financials — ${sc} case (₹ crore unless stated)`} subtitle={cur.base ? `Base year ${cur.base.fy}: revenue ₹${cur.base.revenue.toFixed(0)} cr, debt ₹${cur.base.debt.toFixed(0)} cr, cash ₹${cur.base.cash.toFixed(0)} cr.` : undefined} />
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead><tr className="border-b border-line bg-slate-50 text-[11px] uppercase text-ink-soft"><th className="px-3 py-2 text-left">Item</th>{futureLabels.map((l) => <th key={l} className="px-3 text-right">{l}</th>)}</tr></thead>
            <tbody>{KEYS.map((k) => <tr key={String(k.key)} className="border-b border-line"><td className="px-3 py-1">{k.label}</td>{cur.rows.map((r) => { const val = r[k.key] as number | null; return <td key={r.label} className="num px-3 text-right">{val === null ? "—" : k.unit === "pct" ? `${val.toFixed(1)}%` : k.unit === "rs" ? val.toFixed(2) : val.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>; })}</tr>)}</tbody>
          </table>
        </div>
        <CardBody><ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft">{cur.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul></CardBody>
      </Card>
      <Card>
        <CardHeader title="Management guidance (recorded from reports)" subtitle="Shown separately from model projections; add targets on the Management page." />
        <CardBody>{guidance.length ? <ul className="space-y-1 text-sm">{guidance.map((g) => <li key={g.item.id}><Badge tone="purple">guidance</Badge> {g.item.metric} {g.item.direction === "at-least" ? "≥" : "≤"} {g.item.target} by FY{g.item.targetFy} — “{g.item.quote}” <span className="text-xs text-ink-soft">({g.eval.status})</span></li>)}</ul> : <div className="text-sm text-ink-soft">No management guidance recorded.</div>}</CardBody>
      </Card>
      <Callout tone="slate">Disclosure: projections mechanically extend your assumptions. They ignore acquisitions, equity issuance, regulatory changes and cyclical turns unless you change the inputs. They are not forecasts by the company or by an AI.</Callout>
    </div>
  );
}
