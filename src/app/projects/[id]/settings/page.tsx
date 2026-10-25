"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader, downloadText, Input, Label, PageTitle, Slider, Toggle } from "@/components/ui";
import { SECTOR_PROFILES } from "@/lib/sector/profiles";
import { ANNUAL_METRICS, QUARTERLY_METRICS } from "@/lib/engine/metrics";
import type { ScoreWeights } from "@/lib/types";
import { deleteProject, exportProject } from "@/lib/store/db";

const W_LABELS: Record<keyof ScoreWeights, string> = { profitability: "Profitability", growth: "Growth", cashFlow: "Cash-flow quality", balanceSheet: "Balance-sheet strength", capitalEfficiency: "Capital efficiency", workingCapital: "Working capital", earningsQuality: "Earnings quality", resilience: "Financial resilience" };

export default function SettingsPage() {
  const { project, update, ai } = useProject();
  const router = useRouter();
  const [q, setQ] = useState("");
  const w = project.settings.scoreWeights;
  const setW = (k: keyof ScoreWeights, v: number) => update((p) => ({ ...p, settings: { ...p.settings, scoreWeights: { ...p.settings.scoreWeights, [k]: v } } }));
  const defs = [...ANNUAL_METRICS, ...QUARTERLY_METRICS.map((d) => ({ ...d, name: `${d.name} (quarterly)` }))].filter((d) => !q || `${d.name} ${d.formula}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageTitle title="Settings & methodology" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Financial Health score weights" subtitle={`Defaults from the ${SECTOR_PROFILES[project.sector].label} profile. Weights are relative; components without data are excluded and confidence is reduced.`} right={<Button size="sm" onClick={() => update((p) => ({ ...p, settings: { ...p.settings, scoreWeights: { ...SECTOR_PROFILES[p.sector].weights } } }))}>Reset to sector defaults</Button>} />
          <CardBody className="grid gap-3 md:grid-cols-2">
            {(Object.keys(W_LABELS) as (keyof ScoreWeights)[]).map((k) => <Slider key={k} label={W_LABELS[k]} value={w[k]} min={0} max={40} step={1} suffix="" onChange={(v) => setW(k, v)} />)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="AI integration" />
          <CardBody className="space-y-3 text-sm">
            <div>Status: <Badge tone={ai?.configured ? "green" : "slate"}>{ai?.configured ? `${ai.provider} · ${ai.model}` : "not configured (deterministic mode)"}</Badge></div>
            <p className="text-ink-soft">API keys live only in server environment variables (<code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code>) and are never sent to the browser. If the server sets <code>APP_ACCESS_TOKEN</code>, enter it here so this browser can use the AI routes.</p>
            {ai?.tokenRequired && <Callout tone="amber">This deployment requires an access token for AI requests.</Callout>}
            <div><Label>AI access token (stored in this project locally)</Label><Input type="password" value={project.settings.aiAccessToken ?? ""} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, aiAccessToken: e.target.value || undefined } }))} /></div>
            <Toggle checked={project.settings.beneishUseOtherExpensesAsSga} onChange={(v) => update((p) => ({ ...p, settings: { ...p.settings, beneishUseOtherExpensesAsSga: v } }))} label="Beneish: other expenses as SG&A proxy" />
            <Toggle checked={project.settings.altmanUseOtherEquityAsRetainedEarnings} onChange={(v) => update((p) => ({ ...p, settings: { ...p.settings, altmanUseOtherEquityAsRetainedEarnings: v } }))} label="Altman: other equity as retained-earnings proxy" />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Project data" />
        <CardBody className="flex flex-wrap items-center gap-2 text-sm">
          <Button onClick={async () => downloadText(`${project.name.replace(/\W+/g, "_")}_backup.json`, JSON.stringify(await exportProject(project.id)), "application/json")}>Export project backup (JSON)</Button>
          <Button variant="danger" onClick={async () => { if (confirm(`Permanently delete “${project.name}” and all locally stored documents, extracted data and assumptions?`)) { await deleteProject(project.id); router.push("/"); } }}>Delete project & local data</Button>
          <span className="text-xs text-ink-soft">Projects are stored in this browser's IndexedDB. They do not sync across browsers/devices and may be lost if you clear site data. Backups contain extracted data and assumptions but not the original PDFs.</span>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Metric definitions" subtitle="Every metric is computed deterministically from validated inputs; AI never calculates numbers." right={<Input className="h-7 w-48 text-xs" placeholder="Search formulas" value={q} onChange={(e) => setQ(e.target.value)} />} />
        <div className="scroll-thin max-h-[480px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><tr><th className="px-3 py-2">Metric</th><th>Formula</th><th>Unit</th><th>Applies to</th></tr></thead>
            <tbody>{defs.map((d, i) => <tr key={`${d.key}-${i}`} className="border-t border-line align-top"><td className="px-3 py-1 font-medium">{d.name}<div className="text-[11px] font-normal text-ink-soft">{d.description}</div></td><td className="pr-3 font-mono text-[11px]">{d.formula}</td><td>{d.unit}</td><td>{d.applies}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Key methodology notes" />
        <CardBody className="space-y-1 text-[13px] text-ink-soft">
          <p><b>Units.</b> All amounts are normalised to ₹ crore (1 crore = 100 lakh = 10 million). Original printed values and units are preserved for every figure.</p>
          <p><b>Fact selection.</b> User corrections always win; otherwise the figure from the document whose own period it is (annual report over quarterly results); otherwise the latest document's comparative. Every competing value is kept and conflicts are flagged.</p>
          <p><b>Derived values.</b> Q4 = FY − (Q1+Q2+Q3) when not reported; totals (tax, debt, liabilities) from components; nil-if-absent for common balance-sheet lines only when that balance sheet was captured. All are labelled “derived”.</p>
          <p><b>EBITDA</b> = revenue − (total expenses − finance costs − D&A). Excludes other income and exceptional items. Not a reported figure under Ind AS.</p>
          <p><b>Averages</b> use opening and closing balances; if the opening is missing the closing balance is used and the limitation is flagged.</p>
          <p><b>Scores</b> map each input linearly between disclosed worst/best bands to 0–100 and combine with the weights above. They are analytical aids, not objective truths, and valuation attractiveness is scored separately from company quality.</p>
          <p><b>Valuation</b> uses only the share price you enter. FCFF DCF for non-financials; residual income / P/B / DDM for financial institutions. Terminal growth must be below WACC.</p>
        </CardBody>
      </Card>
    </div>
  );
}
