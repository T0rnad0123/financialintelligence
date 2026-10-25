"use client";
import Link from "next/link";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Card, CardBody, CardHeader, PageTitle, ScoreBar, Stat, Tabs } from "@/components/ui";
import { applyCorrection } from "@/lib/engine/merge";

export default function DataQualityPage() {
  const { analysis: a, project, update } = useProject();
  const [lvl, setLvl] = useState<"all" | "error" | "warning" | "info">("all");
  const dq = a.dq;
  const issues = dq.issues.filter((i) => lvl === "all" || i.level === lvl);
  const sc = dq.statusCounts;
  return (
    <div className="space-y-5">
      <PageTitle title="Data quality & validation" subtitle="Accounting identities, cross-document conflicts, unit sanity checks, coverage and reconciliation. Contradictory figures are never overwritten silently — you choose." />
      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        <Card>
          <CardBody>
            <div className="text-xs uppercase text-ink-soft">Data-quality score</div>
            <div className="num text-3xl font-semibold">{dq.score}<span className="text-base text-ink-soft">/100</span></div>
            <ScoreBar score={dq.score} />
            <ul className="mt-2 space-y-1 text-[11px] text-ink-soft">{dq.scoreExplanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </CardBody>
        </Card>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="High-confidence reported" value={sc.reportedHigh} />
          <Stat label="Other reported" value={sc.reportedOther} hint="Medium/low confidence: fallback column mapping, OCR, AI-extracted or conflicting sources." />
          <Stat label="User-corrected" value={sc.corrected} />
          <Stat label="Derived" value={sc.derived} hint="Calculated from other values by a disclosed rule (e.g. Q4 = FY − 9M)." />
          <Stat label="Estimated" value={sc.estimated} />
          <Stat label="Missing core items" value={sc.missingCore} />
        </div>
      </div>
      <Card>
        <CardHeader title="Coverage of core line items by year" />
        <CardBody className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {dq.coverage.map((c) => <div key={c.periodId} className="rounded-lg border border-line p-2 text-xs"><div className="flex justify-between"><b>{c.periodId}</b><span>{c.present}/{c.required}</span></div><ScoreBar score={c.pct} /></div>)}
          {!dq.coverage.length && <div className="text-sm text-ink-soft">No annual data.</div>}
        </CardBody>
      </Card>
      {dq.conflicts.length > 0 && (
        <Card>
          <CardHeader title={`Conflicting values (${dq.conflicts.length})`} subtitle="Choose the appropriate value; your choice is recorded as a user correction with its source." />
          <div className="scroll-thin overflow-x-auto">
            <table className="fin w-full text-[13px]">
              <thead><tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><th className="px-3 py-2">Item</th><th>Period</th><th className="text-right">Selected</th><th className="px-3">Competing values</th></tr></thead>
              <tbody>
                {dq.conflicts.map((c) => (
                  <tr key={`${c.periodId}-${c.item}`} className="border-b border-line align-top">
                    <td className="px-3 py-1">{c.label}</td><td>{c.periodId}</td><td className="num text-right">{c.selected?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="space-y-1 px-3 py-1">{c.values.map((v, i) => <div key={i} className="flex flex-wrap items-center gap-2 text-xs"><b className="num">{v.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b><span className="text-ink-soft">{v.docName}{v.page ? ` p.${v.page}` : ""} · {v.primary ? "own period" : "comparative"}</span><Button size="sm" onClick={() => update((p) => ({ ...p, facts: applyCorrection(p.facts, c.basis, c.periodId, c.item, v.value, `User selected value from ${v.docName}${v.page ? ` p.${v.page}` : ""} (conflict resolution).`) }))}>Use</Button></div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="flex items-center gap-2"><Tabs value={lvl} onChange={setLvl} tabs={[{ value: "all", label: `All (${dq.issues.length})` }, { value: "error", label: `Errors (${dq.issues.filter((i) => i.level === "error").length})` }, { value: "warning", label: `Warnings (${dq.issues.filter((i) => i.level === "warning").length})` }, { value: "info", label: `Notes (${dq.issues.filter((i) => i.level === "info").length})` }]} /><Link className="ml-auto text-xs text-brand underline" href={`/projects/${project.id}/data`}>Open data review</Link></div>
      <div className="space-y-2">
        {issues.length === 0 && <div className="rounded-lg border border-line bg-white p-4 text-sm text-ink-soft">No issues at this level.</div>}
        {issues.map((i) => (
          <div key={i.id} className="rounded-lg border border-line bg-white p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={i.level === "error" ? "red" : i.level === "warning" ? "amber" : "slate"}>{i.level}</Badge><Badge tone="slate">{i.category}</Badge><b>{i.title}</b></div>
            <div className="mt-1 text-ink-soft">{i.detail}</div>
            {i.causes && <div className="mt-1 text-xs"><b>Possible causes:</b> {i.causes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
