"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, HelpCircle, Lightbulb, TrendingUp } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Callout, Card, CardBody, CardHeader, cn, Hint, PageTitle, ScoreBar, Stat } from "@/components/ui";
import { AiPanel } from "@/components/AiPanel";
import { SourceTag } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";
import type { CompositeScore } from "@/lib/engine/scores";
import type { Finding } from "@/lib/engine/analyze";

export default function ExecutiveSummary() {
  const { project, analysis: a, docs } = useProject();
  const router = useRouter();
  const base = `/projects/${project.id}`;
  const L = a.latestFy;
  const m = (k: string) => (L ? a.annual[k]?.byPeriod[L] : undefined);
  const val = (k: string) => m(k)?.value ?? null;
  const go = (p: string) => () => router.push(`${base}/${p}`);
  const annualDocs = docs.filter((d) => d.kind === "annual");
  const okDocs = docs.filter((d) => d.status === "success" || d.status === "partial").length;
  const v = a.valuation;
  const mult = (k: string) => v.multiples.find((x) => x.key === k);

  if (!docs.length && !a.fys.length) {
    return (
      <div className="space-y-4">
        <PageTitle title="Executive summary" />
        <Callout tone="blue" title="Start by uploading documents">
          Go to the <Link className="underline" href={`${base}/documents`}>Document centre</Link> to upload annual reports and quarterly results. You can open any page before all reports are uploaded — missing data is shown as “Insufficient data”, never as zero.
        </Callout>
      </div>
    );
  }
  const scores: CompositeScore[] = [a.scores.financialHealth, a.scores.earningsQuality, a.scores.balanceSheetRisk, a.scores.capitalAllocation, a.scores.managementOutlook, a.scores.valuationAttractiveness];
  const by = (k: Finding["kind"]) => a.findings.filter((f) => f.kind === k);
  return (
    <div className="space-y-5">
      <PageTitle
        title="Executive summary"
        subtitle={<>
          {project.name} · {a.basis} basis · {L ? `latest FY ${L}` : "no annual data"} · {a.quarters.length ? `latest quarter ${a.quarters[a.quarters.length - 1]}` : "no quarterly data"}
        </>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat label="Documents" value={`${okDocs}/${docs.length} processed`} sub={`${annualDocs.length}/4 annual · ${a.quarters.slice(-16).length}/16 quarters`} onClick={go("documents")} />
        <Stat label="Share price (manual)" value={project.price ? `₹${project.price.toLocaleString("en-IN")}` : "Not entered"} sub={project.priceDate ? `as of ${project.priceDate}` : "Enter on Valuation page"} onClick={go("valuation")} />
        <Stat label={`Revenue ${L ?? ""}`} value={fmtNum(val("revenue"))} sub={`YoY ${fmtNum(val("revenueGrowth"), "pct")}`} onClick={go("revenue")} />
        <Stat label="EBITDA" value={a.financial ? "N/A (financial)" : fmtNum(val("ebitda"))} sub={a.financial ? "" : `Margin ${fmtNum(val("ebitdaMargin"), "pct")}`} onClick={go("profitability")} hint="Calculated: revenue − operating costs; excludes other income and exceptional items." />
        <Stat label="PAT" value={fmtNum(val("pat"))} sub={`Growth ${fmtNum(val("patGrowth"), "pct")}`} onClick={go("profitability")} />
        <Stat label="Operating cash flow" value={fmtNum(val("cfo"))} sub={`OCF/PAT ${fmtNum(val("ocfToPat"), "x")}`} onClick={go("cash-flow")} />
        <Stat label="Free cash flow" value={fmtNum(val("fcf"))} tone={val("fcf") !== null ? (val("fcf")! >= 0 ? "pos" : "neg") : undefined} onClick={go("cash-flow")} />
        <Stat label="Total debt" value={fmtNum(val("totalDebt"))} sub={`Net debt ${fmtNum(val("netDebt"))}`} onClick={go("balance-sheet")} />
        <Stat label="Net debt / EBITDA" value={fmtNum(val("netDebtToEbitda"), "x")} onClick={go("balance-sheet")} />
        <Stat label="ROE" value={fmtNum(val("roe"), "pct")} onClick={go("returns")} />
        <Stat label="ROCE" value={fmtNum(val("roce"), "pct")} onClick={go("returns")} />
        <Stat label="Revenue CAGR (3y)" value={fmtNum(a.growth.revenue.cagr3.value, "pct")} sub={a.growth.revenue.cagr3.value === null ? a.growth.revenue.cagr3.reason : `PAT CAGR ${fmtNum(a.growth.pat.cagr3.value, "pct")}`} onClick={go("revenue")} />
        <Stat label="P/E" value={fmtNum(mult("pe")?.value ?? null, "x")} sub={mult("pe")?.status !== "ok" ? mult("pe")?.note : v.earningsLabel} onClick={go("valuation")} />
        <Stat label="EV/EBITDA" value={fmtNum(mult("evEbitda")?.value ?? null, "x")} sub={mult("evEbitda")?.status !== "ok" ? mult("evEbitda")?.note?.slice(0, 50) : ""} onClick={go("valuation")} />
        <Stat label="P/B" value={fmtNum(mult("pb")?.value ?? null, "x")} onClick={go("valuation")} />
        <Stat label="Market cap" value={fmtNum(v.marketCap)} sub={v.marketCapReason} onClick={go("valuation")} />
        <Stat label="Fair value (weighted)" value={v.weighted !== null ? `₹${v.weighted.toFixed(0)}` : "—"} sub={v.verdict} onClick={go("valuation")} />
        <Stat label="Data quality" value={`${a.dq.score}/100`} sub={`${a.dq.issues.filter((i) => i.level === "error").length} errors · ${a.dq.issues.filter((i) => i.level === "warning").length} warnings`} onClick={go("data-quality")} />
      </div>

      <Card>
        <CardHeader title="Scores" subtitle="Separate lenses — company quality and valuation attractiveness are never merged. Scores are heuristic summaries of the calculated metrics; weights are configurable in Settings." right={<Link href={`${base}/settings`} className="text-xs text-brand underline">Weights & methodology</Link>} />
        <CardBody className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scores.map((s) => (
            <div key={s.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm font-medium">{s.label}<Hint text={s.explanation.join(" ")} /></div>
                <Badge tone={s.confidence === "high" ? "green" : s.confidence === "medium" ? "blue" : "amber"}>{s.confidence === "n/a" ? "insufficient data" : `${s.confidence} confidence`}</Badge>
              </div>
              <div className="mt-1 flex items-end gap-2">
                <div className={cn("num text-2xl font-semibold", s.score === null && "text-slate-400")}>{s.score === null ? "—" : s.score.toFixed(0)}</div>
                <div className="pb-1 text-xs text-ink-soft">/100 {s.higherIsBetter ? "" : "(higher = more risk)"}</div>
              </div>
              <ScoreBar score={s.score} higherIsBetter={s.higherIsBetter} />
              {s.components && (
                <div className="mt-2 space-y-1">
                  {s.components.filter((c) => c.weight > 0).map((c) => (
                    <div key={c.key} className="flex items-center gap-2 text-xs">
                      <span className="w-40 truncate text-ink-soft" title={c.inputs.map((i) => `${i.label}: ${i.value === null ? "n/a" : i.value.toFixed(2)} → ${i.subScore === null ? "n/a" : i.subScore.toFixed(0)} (band ${i.band.worst}→${i.band.best})`).join("\n") + (c.note ? `\n${c.note}` : "")}>{c.label} <span className="text-slate-400">w{c.weight}</span></span>
                      <div className="flex-1"><ScoreBar score={c.score} /></div>
                      <span className="num w-8 text-right">{c.score === null ? "—" : c.score.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              )}
              {s.inputs && !s.components && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                  {s.inputs.map((i) => <li key={i.label}>{i.label}: <b className="num text-ink">{i.value === null ? "n/a" : fmtNum(i.value, i.unit, 2)}</b>{i.subScore !== null && <> → {i.subScore.toFixed(0)}</>}</li>)}
                </ul>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <FindingCard title="Strongest positive findings" icon={<CheckCircle2 className="h-4 w-4 text-pos" />} items={by("positive")} base={base} empty="No strong positives identified from the available data." />
        <FindingCard title="Most serious concerns" icon={<AlertTriangle className="h-4 w-4 text-neg" />} items={by("concern")} base={base} empty="No significant concerns triggered." />
        <FindingCard title="Key emerging trends" icon={<TrendingUp className="h-4 w-4 text-brand" />} items={by("trend")} base={base} empty="Not enough history to identify trends." />
        <FindingCard title="Management's stated priorities" icon={<Lightbulb className="h-4 w-4 text-gold" />} items={by("priority")} base={base} empty="No management priorities extracted yet — see the Management page." />
      </div>
      <FindingCard title="Important unanswered questions" icon={<HelpCircle className="h-4 w-4 text-ink-soft" />} items={by("question")} base={base} empty="—" />
      <Card>
        <CardHeader title="Overall analytical conclusion (deterministic)" subtitle="Generated from calculated figures with fixed rules — not AI." />
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-sm">{a.conclusion.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </CardBody>
      </Card>
      <AiPanel task="summary" title="AI executive summary (optional)" />
    </div>
  );
}

function FindingCard({ title, icon, items, empty, base }: { title: string; icon: React.ReactNode; items: Finding[]; empty: string; base: string }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <CardBody className="space-y-2">
        {items.length === 0 && <div className="text-sm text-ink-soft">{empty}</div>}
        {items.map((f, i) => (
          <div key={i} className="rounded-lg border border-line p-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{f.title}</div>
              {f.link && <Link href={`${base}/${f.link}`} className="shrink-0 text-xs text-brand underline">Drill down</Link>}
            </div>
            {f.detail && <div className="mt-0.5 text-[13px] text-ink-soft">{f.detail.length > 400 ? `${f.detail.slice(0, 400)}…` : f.detail}</div>}
            {f.evidence.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{f.evidence.map((e, j) => <span key={j} className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px]">{e.label}{e.period ? ` (${e.period})` : ""}: <b className="num">{e.value}</b></span>)}</div>}
            {f.sources && f.sources.length > 0 && <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-soft">{f.sources.slice(0, 3).map((s, j) => <SourceTag key={j} name={s.docName} page={s.page} />)}</div>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
