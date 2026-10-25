"use client";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Callout, Card, CardBody, CardHeader, PageTitle, severityTone, Tabs, Toggle } from "@/components/ui";
import { FlagCard, MetricTable, seriesFrom, SourceTag, TrendChart } from "@/components/analysis";
import type { ModelResult } from "@/lib/engine/forensics";

function ModelCard({ m }: { m: ModelResult }) {
  return (
    <Card>
      <CardHeader title={m.name} subtitle={m.period ? `Period: ${m.period}` : undefined} right={m.computed ? <Badge tone={m.zone?.startsWith("Distress") || m.zone?.startsWith("Above") ? "red" : m.zone?.startsWith("Grey") ? "amber" : "green"}>{m.value?.toFixed(2)} · {m.zone}</Badge> : <Badge tone="slate">{m.applicable ? "Not computed" : "Not applicable"}</Badge>} />
      <CardBody className="space-y-3 text-sm">
        <div className="rounded bg-slate-50 p-2 font-mono text-[11px]">{m.formula}</div>
        <div>{m.interpretation}</div>
        {m.components.length > 0 && (
          <table className="fin w-full text-xs"><thead className="text-ink-soft"><tr><th className="text-left">Component</th><th className="text-right">Value</th><th className="text-right">Weight</th><th className="text-right">Contribution</th></tr></thead>
            <tbody>{m.components.map((c) => <tr key={c.label} className="border-t border-line"><td className="py-0.5">{c.label}</td><td className="num text-right">{c.value?.toFixed(3)}</td><td className="num text-right">{c.weight}</td><td className="num text-right">{c.value !== null && c.weight !== undefined ? (c.value * c.weight).toFixed(3) : "—"}</td></tr>)}</tbody>
          </table>
        )}
        <details><summary className="cursor-pointer text-xs text-brand">Inputs ({m.inputs.length})</summary>
          <ul className="mt-1 grid gap-0.5 text-xs md:grid-cols-2">{m.inputs.map((i) => <li key={i.label} className={i.value === null ? "text-neg" : ""}>{i.label}: <span className="num">{i.value === null ? "missing" : i.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></li>)}</ul>
        </details>
        <ul className="list-disc pl-5 text-xs text-ink-soft">{m.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </CardBody>
    </Card>
  );
}

export default function ForensicsPage() {
  const { analysis: a, fyRange, project, update } = useProject();
  const [sev, setSev] = useState<string>("all");
  const flags = a.flags.filter((f) => sev === "all" || f.severity === sev);
  const counts = ["critical", "high", "medium", "low", "informational"].map((s) => ({ s, n: a.flags.filter((f) => f.severity === s).length }));
  return (
    <div className="space-y-5">
      <PageTitle title="Earnings quality & forensic accounting" subtitle="Rule-based warning signs and statistical models. Unusual ratios are prompts for investigation — never evidence of fraud. Confirmed disclosures (e.g. auditor remarks) are labelled separately from potential warning signs." />
      <div className="flex flex-wrap items-center gap-2">
        {counts.map((c) => <Badge key={c.s} tone={severityTone(c.s)}>{c.s}: {c.n}</Badge>)}
        <div className="ml-auto"><Tabs value={sev} onChange={setSev} tabs={[{ value: "all", label: "All" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }, { value: "informational", label: "Info" }]} /></div>
      </div>
      <div className="space-y-2">{flags.length ? flags.map((f) => <FlagCard key={f.id} f={f} />) : <Callout tone="green">No flags at this severity.</Callout>}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Profit vs cash" periods={fyRange} series={[seriesFrom(a.annual.pat, fyRange, { type: "bar" }), seriesFrom(a.annual.ebitda, fyRange, { type: "bar", color: "#a87a12" }), seriesFrom(a.annual.cfo, fyRange, { type: "line", color: "#15803d" })]} />
        <TrendChart title="Earnings-quality ratios" periods={fyRange} selectable series={[seriesFrom(a.annual.otherIncomeToPbt, fyRange, { type: "line" }), seriesFrom(a.annual.accrualsRatio, fyRange, { type: "line" }), seriesFrom(a.annual.exceptionalToPbt, fyRange, { type: "line" }), seriesFrom(a.annual.effectiveTaxRate, fyRange, { type: "line" })]} />
      </div>
      <MetricTable title="Earnings-quality metrics" series={a.annual} keys={["ocfToPat", "ocfToEbitda", "accrualsRatio", "otherIncomeToPbt", "exceptionalToPbt", "adjustedPat", "effectiveTaxRate", "depreciationRate", "receivablesToRevenue", "inventoryToRevenue"]} periods={fyRange} />
      <Card>
        <CardHeader title="Model input options (disclosed proxies)" subtitle="Off by default: models are only computed with the exact required inputs." />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <Toggle checked={project.settings.beneishUseOtherExpensesAsSga} onChange={(v) => update((p) => ({ ...p, settings: { ...p.settings, beneishUseOtherExpensesAsSga: v } }))} label="Beneish: use 'Other expenses' as SG&A proxy" hint="Indian P&Ls rarely report SG&A. The proxy includes non-SG&A costs and is disclosed in the result." />
          <Toggle checked={project.settings.altmanUseOtherEquityAsRetainedEarnings} onChange={(v) => update((p) => ({ ...p, settings: { ...p.settings, altmanUseOtherEquityAsRetainedEarnings: v } }))} label="Altman: use 'Other equity' as retained-earnings proxy" hint="Other equity includes securities premium and other reserves, overstating retained earnings. Prefer entering retained earnings from the notes in Data Review." />
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <ModelCard m={a.beneish} />
        {a.altman.map((m) => <ModelCard key={m.name} m={m} />)}
      </div>
      <Card>
        <CardHeader title="Auditor's report & disclosure scan" subtitle="Keyword detection with page references — read the full paragraphs before drawing conclusions." />
        <CardBody className="space-y-2">
          {a.auditFindings.length === 0 && <div className="text-sm text-ink-soft">No qualification, adverse opinion, disclaimer, going-concern, emphasis-of-matter or control-weakness wording was detected in the uploaded documents.</div>}
          {a.auditFindings.map((f, i) => <div key={i} className="rounded-lg border border-line p-2 text-[13px]"><div className="flex flex-wrap items-center gap-2"><Badge tone={severityTone(f.severity)}>{f.severity}</Badge><b>{f.title}</b><SourceTag name={f.docName} page={f.page} /></div><div className="mt-1 italic text-ink-soft">“{f.text}”</div></div>)}
          {project.excerpts.filter((e) => e.category === "accounting-policy" || e.category === "restatement").slice(0, 6).map((e) => <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} /> · {e.category}</div>“{e.text}”</div>)}
        </CardBody>
      </Card>
    </div>
  );
}
