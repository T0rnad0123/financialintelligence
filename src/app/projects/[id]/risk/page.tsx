"use client";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Card, CardBody, CardHeader, cn, PageTitle, severityTone } from "@/components/ui";
import { SourceTag } from "@/components/analysis";
import { AiPanel } from "@/components/AiPanel";
import type { RiskItem } from "@/lib/engine/risks";

const SEV = ["critical", "high", "medium", "low", "informational"] as const;
const LIK = ["Elevated", "Moderate", "Low", "Not assessable"] as const;

export default function RiskPage() {
  const { analysis: a } = useProject();
  const [open, setOpen] = useState<string | null>(null);
  const active = a.risks.filter((r) => r.severity !== "none");
  const cellColor = (s: string, l: string) => {
    const si = SEV.indexOf(s as (typeof SEV)[number]);
    const li = LIK.indexOf(l as (typeof LIK)[number]);
    const score = (4 - si) + (l === "Not assessable" ? 0.5 : 2 - li);
    return score >= 5 ? "bg-red-100" : score >= 3.5 ? "bg-amber-100" : score >= 2 ? "bg-yellow-50" : "bg-slate-50";
  };
  return (
    <div className="space-y-5">
      <PageTitle title="Risk analysis & early-warning system" subtitle="Severity comes from calculated metrics or disclosures; likelihood is qualitative and shown only where the evidence supports it. No probabilities or loss amounts are invented." />
      <Card>
        <CardHeader title="Risk heatmap" subtitle="Rows: severity · Columns: likelihood. Click a risk to see its evidence." />
        <CardBody className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
            <thead><tr><th />{LIK.map((l) => <th key={l} className="text-ink-soft">{l}</th>)}</tr></thead>
            <tbody>
              {SEV.map((s) => (
                <tr key={s}>
                  <td className="w-24 text-right font-medium capitalize text-ink-soft">{s}</td>
                  {LIK.map((l) => (
                    <td key={l} className={cn("h-16 rounded-lg p-1 align-top", cellColor(s, l))}>
                      <div className="flex flex-wrap gap-1">{active.filter((r) => r.severity === s && r.likelihood === l).map((r) => <button key={r.id} onClick={() => setOpen(r.id)} className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] shadow-sm hover:text-brand">{r.name}</button>)}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <div className="space-y-2">
        {a.risks.map((r) => <RiskRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
      </div>
      <AiPanel task="risks" title="AI risk narrative (optional)" question="biggest financial risks leverage liquidity receivables regulatory commodity" />
    </div>
  );
}

function RiskRow({ r, open, onToggle }: { r: RiskItem; open: boolean; onToggle: () => void }) {
  return (
    <div className={cn("rounded-xl border bg-white p-3", open ? "border-brand" : "border-line")}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 text-left">
        <Badge tone={r.severity === "none" ? "green" : severityTone(r.severity)}>{r.severity === "none" ? "not triggered" : r.severity}</Badge>
        <span className="font-medium">{r.name}</span>
        <Badge tone="slate">{r.category}</Badge>
        <span className="ml-auto text-xs text-ink-soft">Likelihood: {r.likelihood}</span>
      </button>
      {open && (
        <div className="mt-2 grid gap-2 text-[13px] md:grid-cols-2">
          <div><b>Evidence:</b> {r.evidence}</div>
          <div><b>Financial impact:</b> {r.impact}</div>
          {r.history && <div className="md:col-span-2"><b>Historical development:</b> <span className="num">{r.history}</span></div>}
          <div><b>Potential mitigation:</b> {r.mitigation}</div>
          <div><b>Uncertainty:</b> {r.uncertainty}</div>
          {r.sources.length > 0 && <div className="space-y-1 md:col-span-2">{r.sources.map((s, i) => <div key={i} className="rounded bg-slate-50 p-2 text-xs"><SourceTag name={s.docName} page={s.page} />{s.text && <div className="mt-0.5 italic text-ink-soft">“{s.text.slice(0, 300)}”</div>}</div>)}</div>}
        </div>
      )}
    </div>
  );
}
