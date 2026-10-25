"use client";
import { useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Input, Label, NumberField, PageTitle, Select, Tabs, Toggle } from "@/components/ui";
import { SourceTag } from "@/components/analysis";
import { AiPanel } from "@/components/AiPanel";
import { GUIDANCE_METRICS } from "@/lib/engine/management";
import type { ExcerptCategory, GuidanceItem, StrategyItem, StrategyStatus } from "@/lib/types";
import { uid } from "@/lib/project";
import { fmtNum } from "@/lib/engine/core";

const STATUS: { value: StrategyStatus; label: string; tone: "green" | "blue" | "amber" | "red" | "slate" }[] = [
  { value: "achieved", label: "Achieved", tone: "green" },
  { value: "on-track", label: "On track", tone: "blue" },
  { value: "partially-achieved", label: "Partially achieved", tone: "amber" },
  { value: "delayed", label: "Delayed", tone: "amber" },
  { value: "not-achieved", label: "Not achieved", tone: "red" },
  { value: "insufficient-evidence", label: "Insufficient evidence", tone: "slate" },
];
const CATS: ExcerptCategory[] = ["outlook", "strategy", "guidance", "capex", "expansion", "debt", "dividend", "order-book", "rnd", "regulatory", "risk"];

export default function ManagementPage() {
  const { project, analysis: a, update } = useProject();
  const [view, setView] = useState<"tracker" | "candidates" | "guidance" | "statements">("tracker");
  const [cat, setCat] = useState<ExcerptCategory>("outlook");
  const confirmed = project.strategy.filter((s) => s.confirmed);
  const candidates = project.strategy.filter((s) => !s.confirmed);
  const setItem = (id: string, patch: Partial<StrategyItem>) => update((p) => ({ ...p, strategy: p.strategy.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const L = a.latestFy;
  const m = (k: string) => (L ? a.annual[k]?.byPeriod[L]?.value ?? null : null);
  const capacity = [
    `Latest operating cash flow ${fmtNum(m("cfo"))}, free cash flow ${fmtNum(m("fcf"))}.`,
    `Net debt ${fmtNum(m("netDebt"))} (${fmtNum(m("netDebtToEbitda"), "x")} EBITDA); interest coverage ${fmtNum(m("interestCoverage"), "x")}.`,
    `Cash-like balances ${fmtNum(m("cashLike"))}.`,
  ];
  const achieved = a.guidance.filter((g) => g.eval.status === "achieved");
  const missed = a.guidance.filter((g) => g.eval.status === "not-achieved" || g.eval.status === "partially-achieved");
  const pending = a.guidance.filter((g) => g.eval.status === "pending");
  return (
    <div className="space-y-5">
      <PageTitle title="Management outlook & strategic direction" subtitle="What management has publicly communicated, with page references — and whether subsequent reported results support it. Claims are kept separate from verified outcomes." />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-4">
          <CardHeader title="Forward-looking assessment (evidence-based)" subtitle="Deterministic summary; use the AI assessment below for a narrative." />
          <CardBody className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <div><b>1. Stated ambitions</b><div className="text-ink-soft">{confirmed.length} confirmed strategic statement(s); {candidates.length} auto-detected candidate(s) awaiting review.</div></div>
            <div><b>2. Supporting evidence</b><div className="text-ink-soft">{achieved.length ? achieved.map((g) => `${g.eval.actualLabel} FY${g.item.targetFy}`).join(", ") + " met guidance." : "No guidance verified as achieved yet."}</div></div>
            <div><b>3. Contradicting evidence</b><div className="text-ink-soft">{missed.length ? missed.map((g) => `${g.eval.actualLabel} FY${g.item.targetFy} (${g.eval.status})`).join(", ") : "No missed guidance recorded."}</div></div>
            <div><b>4. Financial capacity</b><ul className="text-ink-soft">{capacity.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
            <div><b>5. Execution & industry risks</b><div className="text-ink-soft">{a.risks.filter((r) => r.severity !== "none").slice(0, 3).map((r) => r.name).join(", ") || "See Risk dashboard."}</div></div>
            <div><b>6–7. Upside / downside</b><div className="text-ink-soft">Compare bull and bear projections on the Projections page; DCF range ₹{a.valuation.dcf.bear.perShare?.perShare.toFixed(0) ?? "—"}–₹{a.valuation.dcf.bull.perShare?.perShare.toFixed(0) ?? "—"} per share.</div></div>
            <div className="md:col-span-2"><b>8. Milestones to monitor</b><div className="text-ink-soft">{[...pending.map((g) => `${g.item.customLabel ?? g.eval.actualLabel} target for FY${g.item.targetFy}`), ...confirmed.filter((s) => s.status === "on-track" || s.status === "insufficient-evidence").slice(0, 4).map((s) => `${s.category}: ${s.horizon}`)].join("; ") || "Record guidance and confirm statements to build the milestone list."}</div></div>
          </CardBody>
        </Card>
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ value: "tracker", label: `Strategy tracker (${confirmed.length})` }, { value: "candidates", label: `Detected statements (${candidates.length})` }, { value: "guidance", label: `Guidance vs actual (${project.guidance.length})` }, { value: "statements", label: "Management commentary" }]} />

      {view === "tracker" && (
        <div className="space-y-3">
          <Callout tone="slate">A status other than “Insufficient evidence” requires you to record the evidence (e.g. “Plant commissioned, AR FY25 p.34”). The app never assigns delivery status without evidence.</Callout>
          <Button size="sm" onClick={() => update((p) => ({ ...p, strategy: [{ id: uid("st"), statement: "", objective: "", category: "Other", expectedEffect: "", investment: "Not disclosed", executionRisks: "", horizon: "Not stated", measurable: false, progressReported: false, status: "insufficient-evidence", evidence: "", origin: "user", confirmed: true }, ...p.strategy] }))}><Plus className="h-3.5 w-3.5" /> Add statement manually</Button>
          {confirmed.length === 0 && <div className="text-sm text-ink-soft">No confirmed statements yet. Review the detected statements tab.</div>}
          {confirmed.map((s) => <StrategyEditor key={s.id} s={s} onChange={(patch) => setItem(s.id, patch)} onRemove={() => update((p) => ({ ...p, strategy: p.strategy.filter((x) => x.id !== s.id) }))} />)}
        </div>
      )}

      {view === "candidates" && (
        <div className="space-y-2">
          <Callout tone="slate">Forward-looking, quantified sentences detected in Chairman/MD letters, MD&A and Board's report. Confirm the ones that are genuine strategic commitments.</Callout>
          {candidates.length === 0 && <div className="text-sm text-ink-soft">No candidates (upload annual reports with MD&A / Chairman's message).</div>}
          {candidates.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded-lg border border-line bg-white p-2 text-[13px]">
              <div className="flex-1"><div className="mb-0.5 flex flex-wrap gap-1 text-[11px]"><Badge tone="blue">{s.category}</Badge>{s.fy && <Badge tone="slate">FY{s.fy}</Badge>}{s.measurable && <Badge tone="green">quantified</Badge>}{s.docName && <SourceTag name={s.docName} page={s.page} />}</div>“{s.statement}”</div>
              <Button size="sm" onClick={() => setItem(s.id, { confirmed: true, objective: s.objective || s.statement.slice(0, 120) })}><Check className="h-3.5 w-3.5" /> Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => update((p) => ({ ...p, strategy: p.strategy.filter((x) => x.id !== s.id) }))}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      )}

      {view === "guidance" && <GuidanceSection />}

      {view === "statements" && (
        <Card>
          <CardHeader title="Extracted management commentary" right={<Select value={cat} onChange={(v) => setCat(v as ExcerptCategory)} options={CATS.map((c) => ({ value: c, label: c }))} />} />
          <CardBody className="space-y-2">
            {project.excerpts.filter((e) => e.category === cat).sort((x, y) => (y.fy ?? 0) - (x.fy ?? 0) || y.score - x.score).map((e) => <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} />{e.fy ? ` · FY${e.fy}` : ""}</div>“{e.text}”</div>)}
            {!project.excerpts.some((e) => e.category === cat) && <div className="text-sm text-ink-soft">No passages in this category.</div>}
          </CardBody>
        </Card>
      )}
      <AiPanel task="management" title="AI assessment of management strategy & credibility (optional)" question="management strategy outlook capex expansion guidance debt reduction" />
    </div>
  );
}

function StrategyEditor({ s, onChange, onRemove }: { s: StrategyItem; onChange: (p: Partial<StrategyItem>) => void; onRemove: () => void }) {
  const st = STATUS.find((x) => x.value === s.status)!;
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <Badge tone={st.tone}>{st.label}</Badge><Badge tone="blue">{s.category}</Badge><Badge tone="slate">{s.origin}</Badge>{s.fy && <Badge tone="slate">FY{s.fy}</Badge>}{s.docName && <SourceTag name={s.docName} page={s.page} />}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        {s.origin === "user" ? <textarea className="w-full rounded-lg border border-line p-2 text-sm" placeholder="Exact statement / short quotation" value={s.statement} onChange={(e) => onChange({ statement: e.target.value })} /> : <div className="text-[13px] italic">“{s.statement}”</div>}
        <div className="grid gap-2 md:grid-cols-3">
          <div><Label>Strategic objective</Label><Input value={s.objective} onChange={(e) => onChange({ objective: e.target.value })} /></div>
          <div><Label>Expected financial effect</Label><Input value={s.expectedEffect} onChange={(e) => onChange({ expectedEffect: e.target.value })} /></div>
          <div><Label>Investment required</Label><Input value={s.investment} onChange={(e) => onChange({ investment: e.target.value })} /></div>
          <div><Label>Time horizon</Label><Input value={s.horizon} onChange={(e) => onChange({ horizon: e.target.value })} /></div>
          <div><Label>Execution risks</Label><Input value={s.executionRisks} onChange={(e) => onChange({ executionRisks: e.target.value })} /></div>
          <div><Label>Category</Label><Input value={s.category} onChange={(e) => onChange({ category: e.target.value })} /></div>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle checked={s.measurable} onChange={(v) => onChange({ measurable: v })} label="Measurable objective" />
          <Toggle checked={s.progressReported} onChange={(v) => onChange({ progressReported: v })} label="Company reports progress against it" />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <div><Label>Status</Label><Select className="w-full" value={s.status} onChange={(v) => { if (v !== "insufficient-evidence" && !s.evidence.trim()) { alert("Record the evidence first (document, page, figure)."); return; } onChange({ status: v as StrategyStatus }); }} options={STATUS.map((x) => ({ value: x.value, label: x.label }))} /></div>
          <div className="md:col-span-2"><Label>Evidence for status (document, page, reported figure)</Label><Input value={s.evidence} onChange={(e) => onChange({ evidence: e.target.value, ...(e.target.value.trim() ? {} : { status: "insufficient-evidence" }) })} /></div>
        </div>
      </CardBody>
    </Card>
  );
}

function GuidanceSection() {
  const { project, analysis: a, update } = useProject();
  const blank: GuidanceItem = { id: "", metric: "revenueGrowth", direction: "at-least", target: 0, targetFy: (a.latestFy ? Number(a.latestFy.slice(2)) : new Date().getFullYear()) + 1, quote: "" };
  const [g, setG] = useState<GuidanceItem>(blank);
  const evals = useMemo(() => a.guidance, [a.guidance]);
  const tone = (s: string) => (s === "achieved" ? "green" : s === "partially-achieved" ? "amber" : s === "not-achieved" ? "red" : "slate");
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Record a quantified management target" subtitle="Copy the guidance from the report (with page). The app compares it with the reported outcome once that year is uploaded." />
        <CardBody className="grid gap-2 md:grid-cols-6">
          <div className="md:col-span-2"><Label>Metric</Label><Select className="w-full" value={g.metric} onChange={(v) => setG({ ...g, metric: v as GuidanceItem["metric"] })} options={GUIDANCE_METRICS.map((m) => ({ value: m.value, label: m.label }))} /></div>
          <div><Label>Direction</Label><Select className="w-full" value={g.direction} onChange={(v) => setG({ ...g, direction: v as GuidanceItem["direction"] })} options={[{ value: "at-least", label: "At least (≥)" }, { value: "at-most", label: "At most (≤)" }]} /></div>
          <div><Label>Target</Label><NumberField value={g.target} onChange={(v) => setG({ ...g, target: v ?? 0 })} /></div>
          <div><Label>Target FY (ending year)</Label><NumberField value={g.targetFy} onChange={(v) => setG({ ...g, targetFy: Math.round(v ?? g.targetFy) })} step={1} /></div>
          <div><Label>Stated in FY</Label><NumberField value={g.statedFy ?? null} onChange={(v) => setG({ ...g, statedFy: v === null ? undefined : Math.round(v) })} step={1} /></div>
          {g.metric === "custom" && (<><div className="md:col-span-3"><Label>Custom metric label</Label><Input value={g.customLabel ?? ""} onChange={(e) => setG({ ...g, customLabel: e.target.value })} /></div><div><Label>Actual (when known)</Label><NumberField value={g.customActual ?? null} onChange={(v) => setG({ ...g, customActual: v })} /></div></>)}
          <div className="md:col-span-4"><Label>Quotation</Label><Input value={g.quote} onChange={(e) => setG({ ...g, quote: e.target.value })} placeholder="“We aim to reduce net debt below ₹2,000 crore by FY26”" /></div>
          <div><Label>Document</Label><Input value={g.docName ?? ""} onChange={(e) => setG({ ...g, docName: e.target.value })} /></div>
          <div><Label>Page</Label><NumberField value={g.page ?? null} onChange={(v) => setG({ ...g, page: v === null ? undefined : Math.round(v) })} step={1} /></div>
          <div className="md:col-span-6"><Button variant="primary" onClick={() => { if (!g.quote.trim()) return alert("Add the quotation so the target stays traceable."); update((p) => ({ ...p, guidance: [...p.guidance, { ...g, id: uid("g") }] })); setG(blank); }}><Plus className="h-3.5 w-3.5" /> Add guidance</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Guidance vs reported outcome" />
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead><tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><th className="px-3 py-2">Target</th><th>FY</th><th className="text-right">Target</th><th className="text-right">Actual</th><th>Status</th><th className="px-3">Basis / quote</th><th /></tr></thead>
            <tbody>
              {evals.map(({ item, eval: e }) => (
                <tr key={item.id} className="border-b border-line align-top">
                  <td className="px-3 py-1">{item.metric === "custom" ? item.customLabel : GUIDANCE_METRICS.find((m) => m.value === item.metric)?.label}</td>
                  <td>FY{item.targetFy}</td>
                  <td className="num text-right">{item.direction === "at-least" ? "≥" : "≤"} {item.target}</td>
                  <td className="num text-right">{e.actual === null ? "—" : e.actual.toFixed(1)}</td>
                  <td><Badge tone={tone(e.status)}>{e.status}</Badge></td>
                  <td className="whitespace-normal px-3 text-xs text-ink-soft">{e.explanation}<div className="italic">“{item.quote}” {item.docName && `(${item.docName}${item.page ? ` p.${item.page}` : ""})`}</div></td>
                  <td><Button size="sm" variant="ghost" onClick={() => update((p) => ({ ...p, guidance: p.guidance.filter((x) => x.id !== item.id) }))}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
              {!evals.length && <tr><td colSpan={7} className="px-3 py-4 text-center text-ink-soft">No guidance recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {project.excerpts.filter((e) => e.category === "guidance").slice(0, 8).length > 0 && (
        <Card>
          <CardHeader title="Possible guidance statements found in the reports" subtitle="Use these to record targets above." />
          <CardBody className="space-y-2">{project.excerpts.filter((e) => e.category === "guidance").slice(0, 8).map((e) => <div key={e.id} className="rounded-lg bg-slate-50 p-2 text-[13px]"><div className="text-[11px] text-ink-soft"><SourceTag name={e.docName} page={e.page} />{e.fy ? ` · FY${e.fy}` : ""}</div>“{e.text}”</div>)}</CardBody>
        </Card>
      )}
    </div>
  );
}
