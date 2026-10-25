"use client";
import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Replace, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader, cn, Input, Label, NumberField, PageTitle, Select, Toggle } from "@/components/ui";
import type { Basis, DocKind, DocMeta, ExtractedFact, UnitKey } from "@/lib/types";
import { createDocument, MAX_FILE_MB, OCR_PREF_KEY, prefs, processDocument, setPref, STORE_PDF_PREF_KEY } from "@/lib/store/pipeline";
import { deleteDoc, getDocData, saveDoc, saveDocData } from "@/lib/store/db";
import { SECTOR_OPTIONS } from "@/lib/sector/profiles";
import { UNIT_LABEL, toCrore, fyLabel, fyOf, quarterOf } from "@/lib/extraction/parseUtils";
import { ITEM_MAP } from "@/lib/lineItems";
import type { SectorKey } from "@/lib/types";

const fyNow = () => {
  const d = new Date();
  return d.getMonth() + 1 > 3 ? d.getFullYear() : d.getFullYear() - 1; // latest completed FY (ending year) for Mar year-end
};

function statusTone(s: DocMeta["status"]) {
  return s === "success" ? "green" : s === "failed" ? "red" : s === "partial" ? "amber" : "blue";
}

export default function DocumentsPage() {
  const { project, docs, setDocs, update, remerge, ai } = useProject();
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const [pref, setPrefState] = useState(prefs());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latestFy = fyNow();
  const [slotFy, setSlotFy] = useState<number[]>(() => {
    const declared = docs.filter((d) => d.kind === "annual" && d.declaredFy).map((d) => d.declaredFy as number);
    const top = declared.length ? Math.max(...declared) : latestFy;
    return [top - 3, top - 2, top - 1, top];
  });

  const patchDoc = useCallback((d: DocMeta) => setDocs((all) => (all.some((x) => x.id === d.id) ? all.map((x) => (x.id === d.id ? d : x)) : [...all, d])), [setDocs]);

  const enqueue = useCallback(
    (doc: DocMeta, bytes: Uint8Array | null) => {
      queue.current = queue.current.then(async () => {
        const res = await processDocument(project, doc, bytes, patchDoc);
        await remerge();
        if (res.status === "failed") setMsg({ tone: "red", text: `${res.fileName}: ${res.error}` });
      });
    },
    [project, patchDoc, remerge],
  );

  const upload = async (files: FileList | File[], kind: DocKind, slot?: { slot: string; fy: number; replace?: DocMeta }) => {
    setMsg(null);
    for (const file of Array.from(files)) {
      try {
        if (slot?.replace) await deleteDoc(slot.replace.id);
        const { doc, bytes, duplicateOf } = await createDocument(project, file, kind, slot ? { slot: slot.slot, declaredFy: slot.fy } : {});
        if (slot?.replace) setDocs((all) => all.filter((x) => x.id !== slot.replace!.id));
        patchDoc(doc);
        if (duplicateOf) setMsg({ tone: "amber", text: `${file.name} has the same content as ${duplicateOf}. It was added; remove one of them if it is a duplicate.` });
        enqueue(doc, bytes);
      } catch (e) {
        setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  const remove = async (d: DocMeta) => {
    if (!confirm(`Remove “${d.fileName}” and all figures extracted from it?`)) return;
    await deleteDoc(d.id);
    setDocs((all) => all.filter((x) => x.id !== d.id));
    await remerge();
  };

  const reprocess = async (d: DocMeta, patch: Partial<DocMeta> = {}) => {
    const next = { ...d, ...patch };
    await saveDoc(next);
    patchDoc(next);
    enqueue(next, null);
  };

  const annualDocs = docs.filter((d) => d.kind === "annual");
  const qDocs = docs.filter((d) => d.kind === "quarterly");

  return (
    <div className="space-y-5">
      <PageTitle title="Document upload centre" subtitle="Upload annual reports and quarterly results progressively. Extraction runs in your browser; files are not sent to any server." />
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <CompanyInfo />
      <Card>
        <CardHeader title="Processing options" />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <Toggle checked={pref.ocr} onChange={(v) => { setPref(OCR_PREF_KEY, v); setPrefState(prefs()); }} label="Enable OCR for scanned pages (tesseract.js)" hint="Runs in the browser. The OCR engine and English language data (~10–20 MB) are downloaded from the tesseract.js CDN on first use; your documents are not uploaded. OCR is slow (several seconds per page) and less accurate — verify figures." />
          <Toggle checked={pref.storePdfs} onChange={(v) => { setPref(STORE_PDF_PREF_KEY, v); setPrefState(prefs()); }} label="Keep original PDFs in browser storage" hint="Needed to reprocess documents later without re-uploading. Uses browser storage quota." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Annual reports (last four financial years)" subtitle={`PDF up to ${MAX_FILE_MB} MB each. Missing years are allowed. Assign each slot to its reporting year.`} icon={<FileText className="h-4 w-4 text-brand" />} />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => {
            const slot = `FY${i + 1}`;
            const doc = annualDocs.find((d) => d.slot === slot) ?? annualDocs.filter((d) => !d.slot || !/^FY[1-4]$/.test(d.slot)).find((d) => d.declaredFy === slotFy[i]);
            return (
              <div key={slot} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">Annual Report {slot}</div>
                  <label className="flex items-center gap-1 text-xs text-ink-soft">
                    Reporting year
                    <Select value={String(doc?.declaredFy ?? slotFy[i])} disabled={!!doc} onChange={(v) => setSlotFy((s) => s.map((x, j) => (j === i ? Number(v) : x)))} options={Array.from({ length: 16 }, (_, k) => latestFy + 1 - k).map((y) => ({ value: String(y), label: fyLabel(y, project.fyEndMonth) }))} />
                  </label>
                </div>
                {doc ? (
                  <DocCard d={doc} onRemove={() => remove(doc)} onReprocess={(p) => reprocess(doc, p)} onReplace={(f) => upload([f], "annual", { slot, fy: doc.declaredFy ?? slotFy[i], replace: doc })} aiConfigured={!!ai?.configured} />
                ) : (
                  <DropZone label={`Drop the ${fyLabel(slotFy[i], project.fyEndMonth)} annual report PDF`} onFiles={(f) => upload([f[0]], "annual", { slot, fy: slotFy[i] })} />
                )}
              </div>
            );
          })}
          {annualDocs.filter((d) => !d.slot || !/^FY[1-4]$/.test(d.slot)).map((d) => (
            <div key={d.id} className="rounded-xl border border-line p-3">
              <div className="mb-2 font-medium">Additional annual report</div>
              <DocCard d={d} onRemove={() => remove(d)} onReprocess={(p) => reprocess(d, p)} aiConfigured={!!ai?.configured} />
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Quarterly results (most recent 16 quarters)" subtitle="One PDF with many quarters, or one PDF per quarter. Quarters are organised by the reporting period printed in the document (e.g. Q1 FY2024-25), not by upload date." icon={<FileText className="h-4 w-4 text-brand" />} />
        <CardBody className="space-y-3">
          <DropZone multiple label="Drop quarterly results PDFs (multiple allowed)" onFiles={(f) => upload(f, "quarterly")} />
          <QuarterCoverage />
          <div className="grid gap-3 lg:grid-cols-2">
            {qDocs.map((d) => (
              <DocCard key={d.id} d={d} onRemove={() => remove(d)} onReprocess={(p) => reprocess(d, p)} onReplace={(f) => upload([f], "quarterly", undefined).then(() => remove(d))} aiConfigured={!!ai?.configured} />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function CompanyInfo() {
  const { project, update } = useProject();
  return (
    <Card>
      <CardHeader title="Company information" subtitle="Saved automatically." />
      <CardBody className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><Label>Company name</Label><Input defaultValue={project.name} onBlur={(e) => e.target.value.trim() && update((p) => ({ ...p, name: e.target.value.trim() }))} /></div>
        <div><Label>NSE symbol</Label><Input defaultValue={project.nseSymbol ?? ""} onBlur={(e) => update((p) => ({ ...p, nseSymbol: e.target.value.trim().toUpperCase() || undefined }))} /></div>
        <div><Label>BSE code</Label><Input defaultValue={project.bseCode ?? ""} onBlur={(e) => update((p) => ({ ...p, bseCode: e.target.value.trim() || undefined }))} /></div>
        <div><Label hint="Overrides the sector profile used for ratios, scoring and valuation suitability.">Sector profile</Label><Select className="w-full" value={project.sector} onChange={(v) => update((p) => ({ ...p, sector: v as SectorKey }))} options={SECTOR_OPTIONS} /></div>
        <div><Label hint="Used when a statement page does not say standalone/consolidated.">Default basis</Label><Select className="w-full" value={project.preferredBasis} onChange={(v) => update((p) => ({ ...p, preferredBasis: v as Basis }))} options={[{ value: "consolidated", label: "Consolidated" }, { value: "standalone", label: "Standalone" }]} /></div>
        <div><Label hint="Manual input only — never fetched.">Current share price (₹)</Label><NumberField value={project.price} onChange={(v) => update((p) => ({ ...p, price: v !== null && v > 0 ? v : null }))} /></div>
        <div><Label>Price date</Label><Input type="date" defaultValue={project.priceDate ?? ""} onBlur={(e) => update((p) => ({ ...p, priceDate: e.target.value || undefined }))} /></div>
        <div><Label hint="Absolute number of equity shares.">Shares outstanding</Label><NumberField value={project.sharesOutstanding} step={1} onChange={(v) => update((p) => ({ ...p, sharesOutstanding: v !== null && v > 0 ? v : null, sharesSource: "Entered by user" }))} /></div>
        <div><Label>Diluted shares (optional)</Label><NumberField value={project.dilutedShares} step={1} onChange={(v) => update((p) => ({ ...p, dilutedShares: v !== null && v > 0 ? v : null }))} /></div>
        <div className="md:col-span-2"><Label>Notes</Label><Input defaultValue={project.notes ?? ""} onBlur={(e) => update((p) => ({ ...p, notes: e.target.value }))} /></div>
      </CardBody>
    </Card>
  );
}

function QuarterCoverage() {
  const { analysis, project } = useProject();
  const last16 = analysis.quarters.slice(-16);
  if (!analysis.quarters.length) return <div className="text-xs text-ink-soft">No quarterly figures extracted yet for the {project.ui.basis} basis.</div>;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="mr-1 text-ink-soft">Quarters available ({project.ui.basis}):</span>
      {last16.map((q) => <Badge key={q} tone={analysis.view.get(q, "revenue")?.status === "derived" ? "blue" : "green"}>{q}</Badge>)}
      {analysis.missingQs.length > 0 && <span className="ml-2 text-warn">Missing: {analysis.missingQs.join(", ")}</span>}
    </div>
  );
}

function DropZone({ label, onFiles, multiple }: { label: string; onFiles: (f: File[]) => void; multiple?: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); }}
      className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition", over ? "border-brand bg-brand-soft" : "border-line bg-slate-50/50")}
    >
      <UploadCloud className="h-7 w-7 text-brand" />
      <div className="mt-1 text-sm font-medium">{label}</div>
      <div className="text-xs text-ink-soft">PDF only · max {MAX_FILE_MB} MB</div>
      <input ref={ref} type="file" accept="application/pdf,.pdf" multiple={multiple} className="hidden" data-testid={multiple ? "quarterly-input" : "annual-input"} onChange={(e) => { if (e.target.files?.length) onFiles(Array.from(e.target.files)); e.target.value = ""; }} />
      <Button size="sm" className="mt-2" onClick={() => ref.current?.click()}>Browse files</Button>
    </div>
  );
}

function DocCard({ d, onRemove, onReprocess, onReplace, aiConfigured }: { d: DocMeta; onRemove: () => void; onReprocess: (p?: Partial<DocMeta>) => void; onReplace?: (f: File) => void; aiConfigured: boolean }) {
  const { project, remerge } = useProject();
  const [showWarn, setShowWarn] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const repRef = useRef<HTMLInputElement>(null);
  const busy = d.status === "processing" || d.status === "uploading";
  const errs = d.warnings.filter((w) => w.level === "error");

  const aiExtract = async () => {
    const dd = await getDocData(d.id);
    if (!dd) return;
    const pages = Object.entries(d.statementPages ?? {}).filter(([t]) => ["balance-sheet", "profit-loss", "cash-flow", "quarterly-results"].includes(t)).flatMap(([, p]) => p);
    const uniq = [...new Set(pages)].slice(0, 12);
    if (!uniq.length) return alert("No statement pages were identified in this document.");
    if (!confirm(`AI-assisted extraction will send the TEXT of ${uniq.length} statement page(s) (not the PDF) to the AI provider configured on the server. Values are kept only if their exact printed text appears on the page, and are marked “AI-extracted”. Continue?`)) return;
    const added: ExtractedFact[] = [];
    let rejected = 0;
    for (const n of uniq) {
      setAiBusy(`page ${n}`);
      const page = dd.pages.find((p) => p.n === n);
      if (!page) continue;
      const r = await fetch("/api/ai/extract", { method: "POST", headers: { "content-type": "application/json", ...(project.settings.aiAccessToken ? { "x-app-token": project.settings.aiAccessToken } : {}) }, body: JSON.stringify({ pageText: page.text.slice(0, 30000), pageNumber: n }) });
      const j = await r.json();
      if (!r.ok) { setAiBusy(null); return alert(j.error || "AI extraction failed."); }
      rejected += j.rejected ?? 0;
      const unit: UnitKey | null = d.unitOverride ?? (j.unit !== "unknown" ? j.unit : page.unit ?? null);
      if (!unit) continue;
      const basis: Basis = d.basisOverride ?? (j.basis !== "unknown" ? j.basis : page.basis ?? project.preferredBasis);
      for (const it of j.items as { item: string; periodEnd: string; periodType: string; rawValue: string; value: number }[]) {
        const def = ITEM_MAP[it.item];
        if (!def || it.periodType === "ytd") continue;
        const [y, m] = it.periodEnd.split("-").map(Number);
        const isFyEnd = m === project.fyEndMonth;
        const pid = it.periodType === "quarter" || (!isFyEnd && it.periodType === "asAt") ? `Q${quarterOf(m, project.fyEndMonth)}FY${fyOf(y, m, project.fyEndMonth)}` : isFyEnd ? `FY${fyOf(y, m, project.fyEndMonth)}` : null;
        if (!pid) continue;
        if (dd.facts.some((f) => f.item === it.item && f.periodId === pid && f.basis === basis)) continue;
        let v = def.unit === "crore" ? toCrore(it.value, unit) : it.value;
        if (def.absolute) v = Math.abs(v);
        added.push({ basis, periodId: pid, item: it.item, value: v, confidence: "medium", isPrimaryPeriod: pid === d.primaryPeriod, source: { docId: d.id, docName: d.fileName, page: n, rawValue: it.rawValue, rawUnit: UNIT_LABEL[unit], rawText: "AI-extracted (value text verified on page)", method: "ai" } });
      }
    }
    dd.facts.push(...added);
    await saveDocData(dd);
    const next = { ...d, factCount: dd.facts.length, status: dd.facts.length ? (d.status === "failed" ? "partial" : d.status) : d.status, warnings: [...d.warnings, { level: "info" as const, message: `AI-assisted extraction added ${added.length} value(s) not found by the parser; ${rejected} value(s) rejected because their text was not on the page.` }] };
    await saveDoc(next);
    setAiBusy(null);
    await remerge();
  };

  return (
    <div className="rounded-xl border border-line bg-white p-3" data-testid="doc-card">
      <div className="flex items-start gap-2">
        {d.status === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-pos" /> : d.status === "failed" ? <AlertCircle className="mt-0.5 h-4 w-4 text-neg" /> : busy ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-brand" /> : <AlertCircle className="mt-0.5 h-4 w-4 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={d.fileName}>{d.fileName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-soft">
            <Badge tone={statusTone(d.status)}>{d.status === "partial" ? "partially completed" : d.status}</Badge>
            <span>{(d.size / 1e6).toFixed(2)} MB</span>
            {d.pageCount && <span>· {d.pageCount} pages</span>}
            {d.declaredFy && <span>· {fyLabel(d.declaredFy, project.fyEndMonth)}</span>}
            {d.factCount !== undefined && <span>· {d.factCount} figures</span>}
            {d.scanned && <Badge tone="amber">scanned</Badge>}
            {d.ocrApplied && <Badge tone="purple">OCR</Badge>}
          </div>
        </div>
      </div>
      {busy && (
        <div className="mt-2">
          <div className="h-1.5 w-full rounded bg-slate-100"><div className="h-1.5 rounded bg-brand transition-all" style={{ width: `${d.progress}%` }} /></div>
          <div className="mt-1 text-[11px] text-ink-soft">{d.stage ?? "Queued"} · {d.progress}%</div>
        </div>
      )}
      {d.error && <Callout tone="red" className="mt-2">{d.error}</Callout>}
      {!busy && d.status !== "uploading" && (
        <div className="mt-2 space-y-1 text-[11px] text-ink-soft">
          {d.detectedPeriods && d.detectedPeriods.length > 0 && <div><b>Periods:</b> {d.detectedPeriods.join(", ")}</div>}
          {d.detectedBases && d.detectedBases.length > 0 && <div><b>Basis:</b> {d.detectedBases.join(", ")} · <b>Units:</b> {(d.detectedUnits ?? []).map((u) => UNIT_LABEL[u]).join(", ") || "not detected"}</div>}
          {d.statementPages && Object.keys(d.statementPages).length > 0 && <div><b>Sections found:</b> {Object.entries(d.statementPages).map(([t, p]) => `${t} (p.${p.slice(0, 3).join(",")}${p.length > 3 ? "…" : ""})`).join("; ")}</div>}
        </div>
      )}
      {d.warnings.length > 0 && (
        <div className="mt-2">
          <button className="text-[11px] text-warn underline" onClick={() => setShowWarn((s) => !s)}>{errs.length ? `${errs.length} error(s), ` : ""}{d.warnings.length} message(s)</button>
          {showWarn && <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[11px]">{d.warnings.map((w, i) => <li key={i} className={w.level === "error" ? "text-neg" : w.level === "warning" ? "text-warn" : "text-ink-soft"}>{w.page ? `p.${w.page}: ` : ""}{w.message}</li>)}</ul>}
        </div>
      )}
      {!busy && (
        <div className="mt-2 grid gap-2 border-t border-line pt-2 text-xs md:grid-cols-3">
          <label className="flex flex-col gap-0.5 text-ink-soft">Unit override
            <Select value={d.unitOverride ?? ""} onChange={(v) => onReprocess({ unitOverride: (v || undefined) as UnitKey | undefined })} options={[{ value: "", label: "Auto-detect" }, ...Object.entries(UNIT_LABEL).map(([k, l]) => ({ value: k, label: l }))]} />
          </label>
          <label className="flex flex-col gap-0.5 text-ink-soft">Basis override
            <Select value={d.basisOverride ?? ""} onChange={(v) => onReprocess({ basisOverride: (v || undefined) as Basis | undefined })} options={[{ value: "", label: "Auto-detect" }, { value: "consolidated", label: "Consolidated" }, { value: "standalone", label: "Standalone" }]} />
          </label>
          {d.kind === "quarterly" && (
            <label className="flex flex-col gap-0.5 text-ink-soft" title="Use only if column headers could not be read: the first numeric column is assigned to this quarter.">Period hint (fallback)
              <Select value={d.periodHint ? `Q${d.periodHint.q}FY${d.periodHint.fy}` : ""} onChange={(v) => { const m = v.match(/^Q(\d)FY(\d{4})$/); onReprocess({ periodHint: m ? { q: Number(m[1]) as 1 | 2 | 3 | 4, fy: Number(m[2]) } : undefined }); }} options={[{ value: "", label: "None" }, ...Array.from({ length: 24 }, (_, k) => { const fy = fyNow() + 1 - Math.floor(k / 4); const q = 4 - (k % 4); return { value: `Q${q}FY${fy}`, label: `Q${q} ${fyLabel(fy)}` }; })]} />
            </label>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => onReprocess()} disabled={busy || !d.blobStored} title={d.blobStored ? "Re-run extraction" : "Original PDF not stored — use Replace"}><RefreshCw className="h-3.5 w-3.5" /> {d.status === "failed" ? "Retry" : "Reprocess"}</Button>
        {onReplace && (<><input ref={repRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onReplace(e.target.files[0])} /><Button size="sm" onClick={() => repRef.current?.click()} disabled={busy}><Replace className="h-3.5 w-3.5" /> Replace</Button></>)}
        {aiConfigured && d.status !== "uploading" && <Button size="sm" onClick={aiExtract} disabled={busy || !!aiBusy} loading={!!aiBusy} title="Optional: send statement-page text to your AI provider to find values the parser missed"><Sparkles className="h-3.5 w-3.5" /> {aiBusy ? `AI: ${aiBusy}` : "AI-assisted extraction"}</Button>}
        <Button size="sm" variant="danger" onClick={onRemove} disabled={busy}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
      </div>
    </div>
  );
}
