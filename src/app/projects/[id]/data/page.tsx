"use client";
import { useMemo, useState } from "react";
import { Download, Pencil, Plus, RotateCcw } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardHeader, cn, Drawer, downloadText, Input, Label, NumberField, PageTitle, Select, Tabs, toCsv } from "@/components/ui";
import { SourceTag, StatusBadge } from "@/components/analysis";
import { LINE_ITEMS, type Statement } from "@/lib/lineItems";
import { applyCorrection, revertCorrection } from "@/lib/engine/merge";
import { sortPeriodIds } from "@/lib/extraction/parseUtils";
import type { DataPoint } from "@/lib/types";

const STATEMENTS: { value: Statement | "all"; label: string }[] = [
  { value: "pl", label: "Profit & loss" },
  { value: "bs", label: "Balance sheet" },
  { value: "cf", label: "Cash flow" },
  { value: "share", label: "Per-share" },
  { value: "bank", label: "Banking" },
  { value: "sector", label: "Sector items" },
  { value: "all", label: "All" },
];

export default function DataReviewPage() {
  const { project, update, analysis } = useProject();
  const [stmt, setStmt] = useState<Statement | "all">("pl");
  const [kind, setKind] = useState<"FY" | "Q">("FY");
  const [edit, setEdit] = useState<{ pid: string; item: string } | null>(null);
  const [extraPeriods, setExtraPeriods] = useState<string[]>([]);
  const [newPeriod, setNewPeriod] = useState("");
  const [showDerived, setShowDerived] = useState(true);
  const basis = project.ui.basis;
  const raw = project.facts[basis] ?? {};
  const periods = useMemo(() => sortPeriodIds([...new Set([...Object.keys(raw), ...Object.keys(analysis.view.periods), ...extraPeriods])].filter((p) => (kind === "FY" ? p.startsWith("FY") : p.startsWith("Q")))).slice(kind === "Q" ? -16 : -8), [raw, analysis.view.periods, extraPeriods, kind]);
  const items = LINE_ITEMS.filter((d) => stmt === "all" || d.statement === stmt);
  const cell = (pid: string, k: string): DataPoint | undefined => raw[pid]?.[k] ?? (showDerived ? analysis.view.get(pid, k) : undefined);
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [["Item", "Key", "Unit", ...periods.flatMap((p) => [p, `${p} status`, `${p} source`])]];
    for (const d of items) rows.push([d.label, d.key, d.unit, ...periods.flatMap((p) => { const c = cell(p, d.key); return [c?.value ?? null, c?.status ?? "missing", c?.source ? `${c.source.docName}${c.source.page ? ` p.${c.source.page}` : ""}` : ""]; })]);
    downloadText(`${project.name}_${basis}_extracted_data.csv`, toCsv(rows), "text/csv");
  };
  const counts = useMemo(() => {
    const c = { reported: 0, corrected: 0, low: 0, conflicts: 0 };
    for (const pf of Object.values(raw)) for (const dp of Object.values(pf ?? {})) {
      if (!dp) continue;
      if (dp.status === "user-corrected") c.corrected++;
      else c.reported++;
      if (dp.confidence !== "high") c.low++;
      if (dp.note?.includes("differ")) c.conflicts++;
    }
    return c;
  }, [raw]);
  const sel = edit ? { dp: raw[edit.pid]?.[edit.item], derived: analysis.view.get(edit.pid, edit.item), def: LINE_ITEMS.find((d) => d.key === edit.item)! } : null;

  return (
    <div className="space-y-4">
      <PageTitle title="Data review & correction" subtitle={`Every extracted figure for the ${basis} basis, with its source page. Values are in ₹ crore except per-share (₹), counts and percentages. Click a cell to correct it — corrections are kept when documents are reprocessed.`} right={<Button size="sm" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</Button>} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="green">{counts.reported} extracted</Badge>
        <Badge tone="purple">{counts.corrected} user-corrected</Badge>
        <Badge tone="amber">{counts.low} medium/low confidence</Badge>
        <Badge tone="red">{counts.conflicts} with conflicting sources</Badge>
        <span className="text-ink-soft">Legend: <span className="text-pos">●</span> reported <span className="text-violet-600">●</span> corrected <span className="text-brand">●</span> derived (calculated, not editable here) <span className="text-warn">●</span> low confidence / conflict</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={stmt} onChange={setStmt} tabs={STATEMENTS} />
        <Tabs value={kind} onChange={setKind} tabs={[{ value: "FY", label: "Annual" }, { value: "Q", label: "Quarterly (last 16)" }]} />
        <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" checked={showDerived} onChange={(e) => setShowDerived(e.target.checked)} /> show derived values</label>
        <div className="ml-auto flex items-center gap-1">
          <Input placeholder={kind === "FY" ? "e.g. FY2025" : "e.g. Q1FY2026"} value={newPeriod} onChange={(e) => setNewPeriod(e.target.value.toUpperCase().replace(/\s/g, ""))} className="h-8 w-32 text-xs" />
          <Button size="sm" onClick={() => { if (/^(FY\d{4}|Q[1-4]FY\d{4})$/.test(newPeriod)) { setExtraPeriods((x) => [...x, newPeriod]); setNewPeriod(""); } else alert("Use FY2025 or Q1FY2026 format (FY = ending year)."); }}><Plus className="h-3.5 w-3.5" /> Add period</Button>
        </div>
      </div>
      {periods.length === 0 && <Callout tone="amber" title="No data yet">Upload documents in the Document centre, or add a period above to enter figures manually.</Callout>}
      <Card>
        <div className="scroll-thin overflow-x-auto">
          <table className="fin w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft">
                <th className="sticky left-0 bg-slate-50 px-3 py-2">Line item</th>
                {periods.map((p) => <th key={p} className="px-3 py-2 text-right">{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.key} className="border-b border-line hover:bg-slate-50/50">
                  <td className="sticky left-0 bg-white px-3 py-1" title={d.description}>{d.label}<span className="ml-1 text-[10px] text-slate-400">{d.unit === "crore" ? "" : d.unit === "perShare" ? "₹/sh" : d.unit}</span></td>
                  {periods.map((p) => {
                    const c = cell(p, d.key);
                    const isRaw = !!raw[p]?.[d.key];
                    const color = !c ? "text-slate-300" : c.status === "user-corrected" ? "text-violet-700" : c.status === "derived" ? "text-brand" : c.confidence !== "high" || c.note?.includes("differ") ? "text-warn" : "text-ink";
                    return (
                      <td key={p} className="px-3 py-1 text-right">
                        <button className={cn("num hover:underline", color, c?.status === "derived" && !isRaw && "italic")} onClick={() => setEdit({ pid: p, item: d.key })} title={c?.source ? `${c.source.docName}${c.source.page ? ` p.${c.source.page}` : ""}${c.note ? `\n${c.note}` : ""}` : "Missing — click to enter"}>
                          {c?.value === null || c?.value === undefined ? "—" : c.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit ? `${sel?.def.label} · ${edit.pid} · ${basis}` : ""}>
        {edit && sel && <EditPanel key={`${edit.pid}-${edit.item}`} pid={edit.pid} item={edit.item} dp={sel.dp} derived={sel.derived} unit={sel.def.unit} onSave={(v, note) => { update((p) => ({ ...p, facts: applyCorrection(p.facts, basis, edit.pid, edit.item, v, note) })); setEdit(null); }} onRevert={() => { update((p) => ({ ...p, facts: revertCorrection(p.facts, basis, edit.pid, edit.item) })); setEdit(null); }} />}
      </Drawer>
    </div>
  );
}

function EditPanel({ pid, item, dp, derived, unit, onSave, onRevert }: { pid: string; item: string; dp?: DataPoint; derived?: DataPoint; unit: string; onSave: (v: number | null, note: string) => void; onRevert: () => void }) {
  const [v, setV] = useState<number | null>(dp?.value ?? null);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-4 text-sm">
      {dp ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2"><StatusBadge status={dp.status} /><Badge tone={dp.confidence === "high" ? "green" : "amber"}>{dp.confidence}</Badge></div>
          {dp.source && <div className="text-xs"><SourceTag name={dp.source.docName} page={dp.source.page} /> · method: {dp.source.method}</div>}
          {dp.source?.rawText && <div className="rounded bg-slate-50 p-2 font-mono text-[11px]">{dp.source.rawText}</div>}
          {dp.source?.rawValue && <div className="text-xs">Printed value: <b>{dp.source.rawValue}</b> {dp.source.rawUnit && <>({dp.source.rawUnit})</>}</div>}
          {dp.selectionRule && <div className="text-xs text-ink-soft">Selection rule: {dp.selectionRule}</div>}
          {dp.note && <Callout tone="amber">{dp.note}</Callout>}
        </div>
      ) : derived ? (
        <Callout tone="blue" title="Derived value">{derived.note} Entering a value here overrides it with your own figure.</Callout>
      ) : (
        <Callout tone="slate">No value extracted for {item} in {pid}. Enter it manually (e.g. from a note in the annual report).</Callout>
      )}
      {dp?.candidates && dp.candidates.length > 1 && (
        <div>
          <div className="text-xs font-semibold uppercase text-ink-soft">Values found in documents</div>
          <ul className="mt-1 space-y-1">
            {dp.candidates.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded border border-line p-2 text-xs">
                <span><b className="num">{c.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b> · <SourceTag name={c.source.docName} page={c.source.page} /> · {c.isPrimaryPeriod ? "own period" : "comparative"}</span>
                <Button size="sm" onClick={() => onSave(c.value, `User selected value from ${c.source.docName}${c.source.page ? ` p.${c.source.page}` : ""}.`)}>Use this</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Label>Your value ({unit === "crore" ? "₹ crore" : unit === "perShare" ? "₹ per share" : unit})</Label>
        <NumberField value={v} onChange={setV} />
        <p className="mt-1 text-[11px] text-ink-soft">Leave empty to mark the value as missing (it will not be treated as zero).</p>
      </div>
      <div><Label>Reason / note (kept for audit trail)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. corrected from note 24, p.212" /></div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => onSave(v, note)}><Pencil className="h-3.5 w-3.5" /> Save correction</Button>
        {dp?.status === "user-corrected" && <Button onClick={onRevert}><RotateCcw className="h-3.5 w-3.5" /> Revert to extracted</Button>}
      </div>
    </div>
  );
}
