"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle, Stat } from "@/components/ui";
import { FlagCard, MetricTable, seriesFrom, SourceTag, TrendChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";
import { SegmentMix } from "../segments/SegmentMix";

export default function RevenuePage() {
  const { analysis: a, fyRange, project } = useProject();
  const g = a.growth.revenue;
  const q16 = a.quarters.slice(-(project.ui.quarterCount || 16));
  const relevantFlags = a.flags.filter((f) => ["receivables-vs-revenue", "revenue-up-ocf-down", "inventory-vs-revenue"].includes(f.id));
  const orderBook = project.excerpts.filter((e) => e.category === "order-book").slice(0, 4);
  const concentration = project.excerpts.filter((e) => /customer|concentration|export|domestic|international|volume|realisation|realization|price/i.test(e.text) && (e.category === "outlook" || e.category === "risk" || e.category === "segment")).slice(0, 5);
  return (
    <div className="space-y-5">
      <PageTitle title="Revenue & growth" subtitle="Annual and quarterly revenue trends, growth quality and its relation to margins and cash generation." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="3-year revenue CAGR" value={fmtNum(g.cagr3.value, "pct")} sub={g.cagr3.value === null ? g.cagr3.reason : `${g.cagr3.from} → ${a.latestFy}`} />
        <Stat label="4-year revenue CAGR" value={fmtNum(g.cagr4.value, "pct")} sub={g.cagr4.value === null ? g.cagr4.reason : `${g.cagr4.from} → ${a.latestFy}`} />
        <Stat label="Growth volatility (σ of YoY)" value={fmtNum(g.volatility, "pct")} sub={g.volatility === null ? "Needs ≥3 YoY observations" : `${g.yoy.length} observations`} />
        <Stat label="Acceleration" value={g.acceleration === null ? "—" : `${g.acceleration > 0 ? "+" : ""}${g.acceleration.toFixed(1)} pp`} sub="Change in YoY growth vs prior year" tone={g.acceleration === null ? undefined : g.acceleration >= 0 ? "pos" : "neg"} />
        <Stat label="3-year PAT CAGR" value={fmtNum(a.growth.pat.cagr3.value, "pct")} sub="vs revenue CAGR above" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Annual revenue and growth" periods={fyRange} series={[seriesFrom(a.annual.revenue, fyRange, { type: "bar" }), seriesFrom(a.annual.revenueGrowth, fyRange, { type: "line", axis: "right", color: "#a87a12" })]} />
        <TrendChart title={`Quarterly revenue and YoY growth (last ${q16.length} quarters)`} periods={q16} series={[seriesFrom(a.quarterly.revenue, q16, { type: "bar" }), seriesFrom(a.quarterly.revenueYoY, q16, { type: "line", axis: "right", color: "#a87a12" })]} />
        <TrendChart title="Growth vs profitability vs cash" subtitle="Is revenue growth accompanied by margins and cash flow?" periods={fyRange} selectable series={[seriesFrom(a.annual.revenueGrowth, fyRange, { type: "line" }), seriesFrom(a.annual.patGrowth, fyRange, { type: "line" }), seriesFrom(a.annual.ebitdaMargin, fyRange, { type: "line" }), seriesFrom(a.annual.ocfToRevenue, fyRange, { type: "line" })]} />
        <TrendChart title="Revenue vs operating cash flow" periods={fyRange} series={[seriesFrom(a.annual.revenue, fyRange, { type: "bar" }), seriesFrom(a.annual.cfo, fyRange, { type: "bar", color: "#15803d" })]} />
      </div>
      <MetricTable title="Growth metrics" series={a.annual} keys={["revenue", "revenueGrowth", "ebitdaGrowth", "patGrowth", "epsGrowth", "receivablesToRevenue", "ocfToRevenue"]} periods={fyRange} />
      <SegmentMix />
      <Card>
        <CardHeader title="Growth consistency checks" subtitle="Rule-based checks comparing revenue with receivables, inventory and cash." />
        <CardBody className="space-y-2">
          {relevantFlags.length ? relevantFlags.map((f) => <FlagCard key={f.id} f={f} />) : <Callout tone="green">No inconsistency between revenue, receivables, inventory and operating cash flow was triggered in the latest year.</Callout>}
          <p className="text-xs text-ink-soft">Organic vs acquisition-driven growth, volume vs price, domestic vs export split and customer concentration require disclosures in the MD&A/notes. The app does not infer causes without evidence; relevant passages found are listed below.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Disclosures on order book, mix and concentration" subtitle="Extracted sentences (keyword-based) with page references." />
        <CardBody className="space-y-2">
          {[...orderBook, ...concentration].length === 0 && <div className="text-sm text-ink-soft">No relevant disclosures found in the extracted text.</div>}
          {[...orderBook, ...concentration].map((e) => (
            <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="mb-1 text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} /> · {e.category}</div>“{e.text}”</div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
