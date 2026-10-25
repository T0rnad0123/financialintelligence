"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Callout, Card, CardBody, CardHeader, PageTitle, Select, Stat } from "@/components/ui";
import { Heatmap, MetricTable, seriesFrom, TrendChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function QuarterlyPage() {
  const { analysis: a, project, update } = useProject();
  const n = project.ui.quarterCount || 16;
  const qs = a.quarters.slice(-n);
  const fysQ = [...new Set(qs.map((q) => q.slice(2)))];
  const ttm = a.ttm.filter((t) => qs.includes(t.periodId));
  const ttmVals = (k: "revenue" | "ebitda" | "pat" | "eps") => Object.fromEntries(ttm.map((t) => [t.periodId, t[k]]));
  const derivedQs = qs.filter((q) => a.view.get(q, "revenue")?.status === "derived");
  if (!a.quarters.length) return (<div className="space-y-4"><PageTitle title="Quarterly performance" /><Callout tone="amber" title="No quarterly data for this basis">Upload quarterly results in the Document centre, or switch the reporting basis (top bar).</Callout></div>);
  return (
    <div className="space-y-5">
      <PageTitle title="Quarterly performance" subtitle="Reported quarterly figures; TTM values are derived from four consecutive quarters and labelled as such." right={<Select value={String(n)} onChange={(v) => update((p) => ({ ...p, ui: { ...p.ui, quarterCount: Number(v) } }))} options={[{ value: "8", label: "Last 8 quarters" }, { value: "12", label: "Last 12 quarters" }, { value: "16", label: "Last 16 quarters" }, { value: "40", label: "All available" }]} />} />
      {(a.missingQs.length > 0 || derivedQs.length > 0) && (
        <Callout tone="amber">
          {a.missingQs.length > 0 && <div>Missing quarters in the 16-quarter window: {a.missingQs.join(", ")}. TTM is not computed across gaps.</div>}
          {derivedQs.length > 0 && <div>Derived quarters (annual − 9 months, not separately reported): {derivedQs.join(", ")}.</div>}
        </Callout>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`TTM revenue (to ${ttm[ttm.length - 1]?.periodId ?? "—"})`} value={fmtNum(ttm[ttm.length - 1]?.revenue ?? null)} sub={ttm[ttm.length - 1]?.includesDerived ? "includes a derived quarter" : "sum of 4 reported quarters"} />
        <Stat label="TTM EBITDA" value={fmtNum(ttm[ttm.length - 1]?.ebitda ?? null)} />
        <Stat label="TTM PAT" value={fmtNum(ttm[ttm.length - 1]?.pat ?? null)} />
        <Stat label="PAT YoY growth volatility" value={fmtNum(a.volatility.patYoYStdev, "pct")} sub={`σ over ${a.volatility.observations} quarters`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Revenue, EBITDA and PAT" periods={qs} selectable series={[seriesFrom(a.quarterly.revenue, qs, { type: "bar" }), seriesFrom(a.quarterly.ebitda, qs, { type: "bar", color: "#a87a12" }), seriesFrom(a.quarterly.pat, qs, { type: "bar", color: "#15803d" })]} />
        <TrendChart title="YoY and QoQ growth" subtitle={a.season.significant ? "Seasonality is significant — prefer YoY comparisons." : "Seasonality appears modest."} periods={qs} selectable series={[seriesFrom(a.quarterly.revenueYoY, qs, { type: "line" }), seriesFrom(a.quarterly.revenueQoQ, qs, { type: "line" }), seriesFrom(a.quarterly.patYoY, qs, { type: "line" }), seriesFrom(a.quarterly.ebitdaYoY, qs, { type: "line" })]} />
        <TrendChart title="Trailing-twelve-month (derived)" periods={ttm.map((t) => t.periodId)} selectable series={[{ key: "r", label: "TTM revenue", unit: "cr", type: "line", values: ttmVals("revenue") }, { key: "e", label: "TTM EBITDA", unit: "cr", type: "line", values: ttmVals("ebitda") }, { key: "p", label: "TTM PAT", unit: "cr", type: "line", values: ttmVals("pat") }]} />
        <TrendChart title="Margins and effective tax rate" periods={qs} selectable series={[seriesFrom(a.quarterly.ebitdaMargin, qs, { type: "line" }), seriesFrom(a.quarterly.patMargin, qs, { type: "line" }), seriesFrom(a.quarterly.effectiveTaxRate, qs, { type: "line" })]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Heatmap title="EBITDA margin by quarter" rows={fysQ} cols={["Q1", "Q2", "Q3", "Q4"]} value={(r, c) => a.quarterly.ebitdaMargin?.byPeriod[`${c}${r}`]?.value ?? null} />
        <Heatmap title="Revenue YoY growth by quarter" rows={fysQ} cols={["Q1", "Q2", "Q3", "Q4"]} value={(r, c) => a.quarterly.revenueYoY?.byPeriod[`${c}${r}`]?.value ?? null} />
      </div>
      <Card>
        <CardHeader title="Seasonality" subtitle="Average share of annual revenue earned in each quarter (complete years only)." />
        <CardBody className="flex flex-wrap items-center gap-3 text-sm">
          {a.season.shares.map((s) => <Badge key={s.q} tone="blue">Q{s.q}: {s.avgShare === null ? "n/a" : `${s.avgShare.toFixed(1)}%`} ({s.observations} yrs)</Badge>)}
          <span className="text-ink-soft">{a.season.note}</span>
        </CardBody>
      </Card>
      <MetricTable title="Quarterly metrics" series={a.quarterly} keys={["revenue", "revenueYoY", "revenueQoQ", "ebitda", "ebitdaMargin", "ebitdaYoY", "ebit", "ebitMargin", "pbt", "pat", "patMargin", "patYoY", "patQoQ", "eps", "financeCost", "exceptional", "effectiveTaxRate", "otherIncomeToPbt"]} periods={qs} />
      <Card>
        <CardHeader title="Quarterly vs annual reconciliation" subtitle="Annual figure compared with the sum of the four quarters for the same basis." />
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead><tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><th className="px-3 py-2">FY</th><th>Item</th><th className="text-right">Annual</th><th className="text-right">Σ quarters</th><th className="text-right">Difference</th><th className="px-3">Explanation</th></tr></thead>
            <tbody>
              {a.recon.map((r, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="px-3 py-1">{r.fy}</td><td>{r.label}</td>
                  <td className="num text-right">{fmtNum(r.annual)}</td><td className="num text-right">{fmtNum(r.sumOfQuarters)}</td>
                  <td className={`num text-right ${r.differencePct !== null && Math.abs(r.differencePct) > 1 ? "text-warn" : ""}`}>{r.difference === null ? "—" : `${r.difference.toFixed(2)} (${r.differencePct?.toFixed(2)}%)`}</td>
                  <td className="whitespace-normal px-3 text-xs text-ink-soft">{r.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
