"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Callout, Card, CardBody, CardHeader, PageTitle, Select } from "@/components/ui";
import { MetricCell, MetricDetail, SourceTag } from "@/components/analysis";
import { useState } from "react";
import { SECTOR_OPTIONS, SECTOR_PROFILES } from "@/lib/sector/profiles";
import { fmtNum, type MetricResult } from "@/lib/engine/core";
import { ITEM_MAP } from "@/lib/lineItems";
import type { SectorKey } from "@/lib/types";

export default function SectorPage() {
  const { analysis: a, project, update, fyRange } = useProject();
  const prof = SECTOR_PROFILES[project.sector];
  const [sel, setSel] = useState<MetricResult | null>(null);
  const regulatory = project.excerpts.filter((e) => e.category === "regulatory" || e.category === "rnd" || e.category === "order-book").slice(0, 6);
  return (
    <div className="space-y-5">
      <PageTitle title="Sector lens" subtitle="Sector-aware metrics, scoring bands and valuation suitability. Override the automatically selected profile if it does not fit." right={<Select value={project.sector} onChange={(v) => update((p) => ({ ...p, sector: v as SectorKey }))} options={SECTOR_OPTIONS} />} />
      <Callout tone="blue" title={prof.label}>{prof.description}</Callout>
      <Card>
        <CardHeader title="Sector-specific indicators" subtitle="'Unavailable' means the figure was not found in the documents — it is never estimated. Enter reported figures (e.g. NPA %, order book, PLF) in Data Review." />
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead><tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><th className="px-3 py-2">Indicator</th><th>Type</th>{fyRange.map((p) => <th key={p} className="px-3 py-2 text-right">{p}</th>)}</tr></thead>
            <tbody>
              {prof.focusItems.map((f) => (
                <tr key={f.key} className="border-b border-line">
                  <td className="px-3 py-1.5">{f.label}{f.note && <div className="text-[11px] text-ink-soft">{f.note}</div>}</td>
                  <td><Badge tone={f.kind === "item" ? "green" : "blue"}>{f.kind === "item" ? "reported" : "calculated"}</Badge></td>
                  {fyRange.map((p) => (
                    <td key={p} className="px-3 text-right">
                      {f.kind === "metric" ? <MetricCell r={a.annual[f.key]?.byPeriod[p]} onClick={() => setSel(a.annual[f.key]?.byPeriod[p] ?? null)} /> : (() => { const dp = a.view.get(p, f.key); const u = ITEM_MAP[f.key]?.unit; return dp?.value != null ? <span className="num" title={dp.source ? `${dp.source.docName} p.${dp.source.page}` : ""}>{fmtNum(dp.value, u === "pct" ? "pct" : u === "crore" ? "cr" : "num")}</span> : <span className="text-[11px] italic text-slate-400">Unavailable</span>; })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Scoring weights & bands for this profile" />
          <CardBody className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(prof.weights).map(([k, w]) => <div key={k} className="flex justify-between rounded bg-slate-50 px-2 py-1"><span>{k}</span><b>{w}</b></div>)}
            {Object.entries(prof.bands).map(([k, b]) => <div key={k} className="flex justify-between rounded bg-slate-50 px-2 py-1"><span>{k}</span><span className="num">{b.worst} → {b.best}</span></div>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Valuation suitability" />
          <CardBody className="space-y-1 text-sm">
            <div>FCFF DCF: <Badge tone={prof.dcfSuitable ? "green" : "red"}>{prof.dcfSuitable ? "suitable" : "not suitable"}</Badge> · EV multiples: <Badge tone={prof.evMultiplesSuitable ? "green" : "red"}>{prof.evMultiplesSuitable ? "suitable" : "not suitable"}</Badge></div>
            {prof.valuationNotes.map((n, i) => <p key={i} className="text-ink-soft">{n}</p>)}
          </CardBody>
        </Card>
      </div>
      {regulatory.length > 0 && (
        <Card>
          <CardHeader title="Sector-relevant disclosures" />
          <CardBody className="space-y-2">{regulatory.map((e) => <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} /> · {e.category}</div>“{e.text}”</div>)}</CardBody>
        </Card>
      )}
      <MetricDetail r={sel} onClose={() => setSel(null)} />
    </div>
  );
}
