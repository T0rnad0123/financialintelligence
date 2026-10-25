"use client";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardHeader, downloadText, PageTitle, Tabs, toCsv } from "@/components/ui";
import { TrendChart, type ChartSeries } from "@/components/analysis";
import { useSegmentData } from "./SegmentMix";
import { fmtNum } from "@/lib/engine/core";
import type { SegmentMetric } from "@/lib/types";
import { prevQuarter, prevYearQuarter } from "@/lib/engine/derive";

export default function SegmentsPage() {
  const { project } = useProject();
  const { names, periods, get } = useSegmentData();
  const [kind, setKind] = useState<"FY" | "Q">(periods.some((p) => p.startsWith("FY")) ? "FY" : "Q");
  const [selected, setSelected] = useState<Set<string>>(new Set(names));
  const [metric, setMetric] = useState<SegmentMetric | "margin" | "share">("revenue");
  const ps = periods.filter((p) => (kind === "FY" ? p.startsWith("FY") : p.startsWith("Q"))).slice(-16);
  const total = (p: string) => names.reduce((s, n) => s + (get(n, p, "revenue") ?? 0), 0);
  const value = (n: string, p: string): number | null => {
    if (metric === "margin") {
      const r = get(n, p, "revenue");
      const res = get(n, p, "result");
      return r && res !== null && r > 0 ? (res / r) * 100 : null;
    }
    if (metric === "share") {
      const r = get(n, p, "revenue");
      const t = total(p);
      return r !== null && t > 0 ? (r / t) * 100 : null;
    }
    return get(n, p, metric);
  };
  const growth = (n: string, p: string) => {
    const prev = kind === "FY" ? `FY${Number(p.slice(2)) - 1}` : prevYearQuarter(p);
    const a = get(n, p, "revenue");
    const b = get(n, prev, "revenue");
    return a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null;
  };
  void prevQuarter;
  const unit = metric === "margin" || metric === "share" ? "pct" : "cr";
  const series: ChartSeries[] = names.filter((n) => selected.has(n)).map((n) => ({ key: n, label: n, unit, type: metric === "margin" || metric === "share" ? "line" : "bar", values: Object.fromEntries(ps.map((p) => [p, value(n, p)])) }));
  if (!names.length) return (<div className="space-y-4"><PageTitle title="Segment & business analysis" /><Callout tone="amber" title="No segment data extracted">Segment tables (segment revenue / results / assets / liabilities) are read from quarterly results and annual reports when present. If your documents contain them but nothing was captured, check the Document centre messages or enter figures via Data Review (segment-level manual entry is not yet supported — this is a known limitation).</Callout></div>);
  return (
    <div className="space-y-5">
      <PageTitle title="Segment & business analysis" subtitle={`${names.length} reported segment(s). Segment results are as reported (usually before interest, tax and unallocable items).`} right={<Button size="sm" onClick={() => downloadText(`${project.name}_segments.csv`, toCsv([["Segment", "Metric", ...ps], ...names.flatMap((n) => (["revenue", "result", "assets", "liabilities", "capex"] as SegmentMetric[]).map((m) => [n, m, ...ps.map((p) => get(n, p, m))]))]), "text/csv")}>Export CSV</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={kind} onChange={setKind} tabs={[{ value: "FY", label: "Annual" }, { value: "Q", label: "Quarterly" }]} />
        <Tabs value={metric} onChange={setMetric} tabs={[{ value: "revenue", label: "Revenue" }, { value: "result", label: "Result" }, { value: "margin", label: "Margin %" }, { value: "share", label: "Mix %" }, { value: "assets", label: "Assets" }, { value: "liabilities", label: "Liabilities" }, { value: "capex", label: "Capex" }]} />
        <div className="flex flex-wrap gap-1">
          {names.map((n) => <button key={n} onClick={() => setSelected((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })}><Badge tone={selected.has(n) ? "blue" : "slate"}>{n}</Badge></button>)}
        </div>
      </div>
      <TrendChart title={`Segment ${metric}`} periods={ps} series={series} height={320} />
      <Card>
        <CardHeader title="Segment table" subtitle="Revenue growth is year-over-year (same quarter last year for quarterly view)." />
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead><tr className="border-b border-line bg-slate-50 text-[11px] uppercase text-ink-soft"><th className="px-3 py-2 text-left">Segment</th><th className="text-left">Measure</th>{ps.map((p) => <th key={p} className="px-3 py-2 text-right">{p}</th>)}</tr></thead>
            <tbody>
              {names.filter((n) => selected.has(n)).flatMap((n) => [
                <tr key={`${n}-r`} className="border-t border-line"><td className="px-3 py-1 font-medium" rowSpan={4}>{n}</td><td>Revenue</td>{ps.map((p) => <td key={p} className="num px-3 text-right">{fmtNum(get(n, p, "revenue"))}</td>)}</tr>,
                <tr key={`${n}-g`}><td>YoY growth</td>{ps.map((p) => <td key={p} className="num px-3 text-right">{fmtNum(growth(n, p), "pct")}</td>)}</tr>,
                <tr key={`${n}-m`}><td>Result margin</td>{ps.map((p) => { const r = get(n, p, "revenue"); const res = get(n, p, "result"); return <td key={p} className="num px-3 text-right">{fmtNum(r && res !== null && r > 0 ? (res / r) * 100 : null, "pct")}</td>; })}</tr>,
                <tr key={`${n}-c`}><td>Share of profit</td>{ps.map((p) => { const tot = names.reduce((s, x) => s + (get(x, p, "result") ?? 0), 0); const res = get(n, p, "result"); return <td key={p} className="num px-3 text-right">{fmtNum(res !== null && tot > 0 ? (res / tot) * 100 : null, "pct")}</td>; })}</tr>,
              ])}
            </tbody>
          </table>
        </div>
      </Card>
      <Callout tone="slate">The consolidated company is not treated as one homogeneous business here: compare growth and margins by segment above. Segment assets/liabilities/capex appear only if the documents present them in a segment table.</Callout>
    </div>
  );
}
