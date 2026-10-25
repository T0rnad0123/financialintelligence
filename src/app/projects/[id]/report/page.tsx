"use client";
import { useMemo, useState } from "react";
import { Download, FileJson, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Button, Callout, Card, CardBody, downloadBlob, downloadText, PageTitle, toCsv } from "@/components/ui";
import { allMetricsTable, buildReport, exportExcel, exportPdf } from "@/lib/export/report";
import { exportProject } from "@/lib/store/db";

export default function ReportPage() {
  const { project, analysis: a, docs } = useProject();
  const sections = useMemo(() => buildReport(project, a, docs), [project, a, docs]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const safeName = project.name.replace(/[^\w\-]+/g, "_").slice(0, 60);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      <PageTitle title="Analysis report" subtitle="Generated from the same calculated figures shown on the dashboard. Exports contain real text and tables, not screenshots." right={<>
        <Button size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print / Save as PDF</Button>
        <Button size="sm" variant="primary" loading={busy === "pdf"} onClick={() => run("pdf", async () => downloadBlob(`${safeName}_report.pdf`, await exportPdf(project, sections)))}><FileText className="h-3.5 w-3.5" /> Download PDF</Button>
        <Button size="sm" loading={busy === "xlsx"} onClick={() => run("xlsx", async () => downloadBlob(`${safeName}_analysis.xlsx`, await exportExcel(project, a, sections)))}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button>
        <Button size="sm" onClick={() => { const t = allMetricsTable(a); downloadText(`${safeName}_metrics.csv`, toCsv([t.head, ...t.rows]), "text/csv"); }}><Download className="h-3.5 w-3.5" /> Metrics CSV</Button>
        <Button size="sm" loading={busy === "json"} onClick={() => run("json", async () => downloadText(`${safeName}_backup.json`, JSON.stringify(await exportProject(project.id)), "application/json"))}><FileJson className="h-3.5 w-3.5" /> Project backup</Button>
      </>} />
      {err && <Callout tone="red">{err}</Callout>}
      <Callout tone="slate" className="no-print">The PDF export uses standard fonts, so “₹” is written as “Rs”. Use “Print / Save as PDF” for an exact copy of this page.</Callout>
      <Card>
        <CardBody className="space-y-6 p-6 text-[13px]">
          <header className="border-b border-line pb-3">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <div className="text-ink-soft">Financial health, fundamental analysis & valuation · {a.basis} basis · generated {new Date().toLocaleString("en-IN")}</div>
          </header>
          {sections.map((s) => (
            <section key={s.n} className="print-avoid space-y-2">
              <h2 className="text-base font-semibold text-brand">{s.n}. {s.title}</h2>
              {s.paragraphs.map((p, i) => <p key={i} className="whitespace-pre-wrap leading-relaxed">{p}</p>)}
              {s.bullets && (s.bullets.length ? <ul className="list-disc space-y-0.5 pl-5">{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : <p className="text-ink-soft">None identified.</p>)}
              {s.tables.filter((t) => t.rows.length).map((t, i) => (
                <div key={i} className="scroll-thin overflow-x-auto">
                  <div className="mb-1 text-xs font-semibold text-ink-soft">{t.title}</div>
                  <table className="w-full border-collapse text-[11px]">
                    <thead><tr>{t.head.map((h, j) => <th key={j} className="border border-line bg-slate-50 px-2 py-1 text-left">{h}</th>)}</tr></thead>
                    <tbody>{t.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-line px-2 py-0.5 align-top">{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              ))}
            </section>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
