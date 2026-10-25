"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle, Stat } from "@/components/ui";
import { MetricTable, seriesFrom, SourceTag, TrendChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function CapitalAllocationPage() {
  const { analysis: a, fyRange, project } = useProject();
  const ca = a.capitalAllocation;
  const rows = ca.perYear.filter((r) => fyRange.includes(r.fy));
  const vals = (k: keyof (typeof rows)[number]) => Object.fromEntries(rows.map((r) => [r.fy, (r[k] as number | null) ?? null]));
  const concerns: string[] = [];
  const L = a.latestFy;
  const m = (k: string, p = L) => (p ? a.annual[k]?.byPeriod[p]?.value ?? null : null);
  const first = fyRange[0];
  if (m("capexToDepreciation") !== null && m("capexToDepreciation")! > 2 && m("roce") !== null && m("roce", first) !== null && m("roce")! < m("roce", first)!) concerns.push("Heavy capex (above 2x depreciation) while ROCE has declined since the start of the period — check whether new capacity has started earning.");
  if (a.flags.some((f) => f.id === "dividends-debt-funded")) concerns.push("Dividends exceeded free cash flow while net borrowing increased.");
  if (a.flags.some((f) => f.id === "negative-fcf")) concerns.push("Persistent negative free cash flow.");
  if (a.flags.some((f) => f.id === "intangibles-heavy")) concerns.push("Large goodwill/intangibles — check acquisition returns and impairment history.");
  const ex = project.excerpts.filter((e) => ["capex", "expansion", "dividend", "debt"].includes(e.category)).slice(0, 6);
  return (
    <div className="space-y-5">
      <PageTitle title="Capital allocation" subtitle="How cash generated was used: reinvestment, acquisitions, dividends, buy-backs and debt. A growth-phase company may rationally invest heavily; judge by the returns that follow." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ca.totals.map((t) => <Stat key={t.label} label={t.label} value={fmtNum(t.value)} hint={t.note} />)}
        <Stat label="Cash payout ratio" value={fmtNum(ca.payoutRatio, "pct")} sub={`Retention ${fmtNum(ca.retentionRatio, "pct")}`} />
        <Stat label="Return on retained earnings" value={fmtNum(ca.incrementalReturn.value, "pct")} hint={ca.incrementalReturn.note} />
        <Stat label="ROIC − WACC (latest)" value={m("roic") !== null ? `${(m("roic")! - project.settings.valuation.wacc).toFixed(1)} pp` : "—"} sub="WACC is your assumption" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Uses of cash" periods={rows.map((r) => r.fy)} selectable series={[{ key: "cfo", label: "Operating cash flow", unit: "cr", type: "line", color: "#15803d", values: vals("cfo") }, { key: "capex", label: "Capex", unit: "cr", type: "bar", values: vals("capex") }, { key: "acq", label: "Acquisitions", unit: "cr", type: "bar", values: vals("acquisitions") }, { key: "div", label: "Dividends", unit: "cr", type: "bar", color: "#a87a12", values: vals("dividends") }, { key: "bb", label: "Buy-backs", unit: "cr", type: "bar", values: vals("buyback") }, { key: "nb", label: "Net borrowing", unit: "cr", type: "line", color: "#b91c1c", values: vals("netBorrowing") }]} />
        <TrendChart title="Returns on the capital deployed" periods={fyRange} selectable series={[seriesFrom(a.annual.roce, fyRange, { type: "line" }), seriesFrom(a.annual.roic, fyRange, { type: "line" }), seriesFrom(a.annual.capitalEmployed, fyRange, { type: "bar", axis: "right", color: "#cbd5e1" })]} />
      </div>
      <Card>
        <CardHeader title="Observations" />
        <CardBody className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">{ca.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>
          {concerns.length ? <Callout tone="amber" title="Potential capital-allocation concerns"><ul className="list-disc pl-5">{concerns.map((c, i) => <li key={i}>{c}</li>)}</ul></Callout> : <Callout tone="green">No rule-based capital-allocation concern triggered.</Callout>}
          <p className="text-xs text-ink-soft">Maintenance vs expansion capex, investments in subsidiaries/JVs and related-party investments are usually disclosed in notes and MD&A rather than on the face of the statements; see the disclosures below.</p>
        </CardBody>
      </Card>
      <MetricTable title="Capital allocation metrics" series={a.annual} keys={["capex", "capexToRevenue", "capexToDepreciation", "fcf", "payoutRatio", "dividendsToFcf", "fcfAfterDividends", "netBorrowing", "roce", "roic", "eva"]} periods={fyRange} />
      {ex.length > 0 && <Card><CardHeader title="Management statements on capex, dividends and debt" /><CardBody className="space-y-2">{ex.map((e) => <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} /> · {e.category}</div>“{e.text}”</div>)}</CardBody></Card>}
    </div>
  );
}
