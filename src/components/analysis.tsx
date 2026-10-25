"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownUp, Download, FileSearch } from "lucide-react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Cell, BarChart,
} from "recharts";
import type { MetricResult, MetricUnit } from "@/lib/engine/core";
import { fmtNum } from "@/lib/engine/core";
import type { MetricSeries } from "@/lib/engine/metrics";
import type { RedFlag } from "@/lib/engine/forensics";
import { Badge, Button, Card, CardHeader, cn, Drawer, downloadText, Input, severityTone, toCsv, Callout } from "./ui";

export const PALETTE = ["#1d4ed8", "#a87a12", "#15803d", "#b91c1c", "#7c3aed", "#0891b2", "#64748b", "#db2777"];

const STATUS_LABEL: Record<string, string> = { ok: "", "insufficient-data": "Insufficient data", "not-meaningful": "Not meaningful", "not-applicable": "N/A" };

export function MetricCell({ r, onClick }: { r?: MetricResult; onClick?: () => void }) {
  if (!r) return <span className="text-slate-300">—</span>;
  if (r.status !== "ok" || r.value === null) {
    return (
      <button type="button" onClick={onClick} title={r.reason} className="text-[11px] italic text-slate-400 hover:text-brand">
        {STATUS_LABEL[r.status] || "—"}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} title={`${r.formula}${r.notes.length ? `\n${r.notes.join("\n")}` : ""}`} className={cn("num hover:text-brand hover:underline", r.confidence === "low" && "text-warn", r.confidence === "medium" && "decoration-dotted")}>
      {fmtNum(r.value, r.unit)}
      {r.confidence !== "high" && <sup className="ml-0.5 text-[9px] text-slate-400">{r.confidence === "medium" ? "d" : "!"}</sup>}
    </button>
  );
}

export function MetricDetail({ r, onClose }: { r: MetricResult | null; onClose: () => void }) {
  return (
    <Drawer open={!!r} onClose={onClose} title={r ? `${r.name} · ${r.periodId}` : ""}>
      {r && (
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-2xl font-semibold num">{r.value === null ? STATUS_LABEL[r.status] : fmtNum(r.value, r.unit)}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={r.status === "ok" ? "green" : "amber"}>{r.status}</Badge>
              <Badge tone={r.confidence === "high" ? "green" : r.confidence === "medium" ? "blue" : "amber"}>confidence: {r.confidence}</Badge>
            </div>
            {r.reason && <Callout tone="amber" className="mt-2">{r.reason}</Callout>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-soft">Formula</div>
            <div className="mt-1 rounded-lg bg-slate-50 p-2 font-mono text-xs">{r.formula}</div>
          </div>
          {(r.numerator || r.denominator) && (
            <div className="grid grid-cols-2 gap-2">
              {r.numerator && <div className="rounded-lg border border-line p-2"><div className="text-[11px] text-ink-soft">Numerator · {r.numerator.label}</div><div className="num font-medium">{r.numerator.value === null ? "missing" : r.numerator.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div></div>}
              {r.denominator && <div className="rounded-lg border border-line p-2"><div className="text-[11px] text-ink-soft">Denominator · {r.denominator.label}</div><div className="num font-medium">{r.denominator.value === null ? "missing" : r.denominator.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div></div>}
            </div>
          )}
          <div>
            <div className="text-xs font-semibold uppercase text-ink-soft">Inputs & sources</div>
            <table className="fin mt-1 w-full text-xs">
              <thead className="text-left text-ink-soft"><tr><th className="py-1">Item</th><th>Period</th><th className="text-right">Value (₹ cr)</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {r.inputs.map((p, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="py-1 pr-2 whitespace-normal">{p.label}</td>
                    <td className="pr-2">{p.periodId}</td>
                    <td className="num pr-2 text-right">{p.value === null ? <span className="text-neg">missing</span> : p.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="pr-2"><StatusBadge status={p.status} /></td>
                    <td className="whitespace-normal text-ink-soft">{p.source ? <SourceTag name={p.source.docName} page={p.source.page} raw={p.source.rawText} /> : "—"}{p.note && <div className="text-[11px] italic">{p.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.notes.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-ink-soft">Methodology notes</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          {r.interpretation && <Callout tone="slate" title="Deterministic interpretation">{r.interpretation} {r.prev !== null && r.prev !== undefined && <>Prior period: {fmtNum(r.prev, r.unit)}.</>}</Callout>}
        </div>
      )}
    </Drawer>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const t = status === "reported" ? "green" : status === "user-corrected" ? "purple" : status === "derived" ? "blue" : status === "estimated" ? "amber" : "red";
  return <Badge tone={t}>{status}</Badge>;
}

export function SourceTag({ name, page, raw }: { name: string; page?: number; raw?: string }) {
  return (
    <span title={raw} className="inline-flex items-center gap-1">
      <FileSearch className="h-3 w-3" />
      <span className="max-w-[220px] truncate">{name}</span>
      {page && <span className="rounded bg-slate-100 px-1 text-[10px]">p.{page}</span>}
    </span>
  );
}

export function MetricTable({ title, subtitle, series, keys, periods, exportName, right }: { title: string; subtitle?: string; series: Record<string, MetricSeries>; keys: string[]; periods: string[]; exportName?: string; right?: ReactNode }) {
  const [sel, setSel] = useState<MetricResult | null>(null);
  const [q, setQ] = useState("");
  const [sortAsc, setSortAsc] = useState<boolean | null>(null);
  const rows = useMemo(() => {
    let r = keys.map((k) => series[k]).filter(Boolean);
    if (q) r = r.filter((s) => s.def.name.toLowerCase().includes(q.toLowerCase()));
    if (sortAsc !== null) r = [...r].sort((a, b) => (sortAsc ? 1 : -1) * a.def.name.localeCompare(b.def.name));
    return r;
  }, [keys, series, q, sortAsc]);
  const exportCsv = () => {
    const data: (string | number | null)[][] = [["Metric", "Unit", "Formula", ...periods]];
    rows.forEach((s) => data.push([s.def.name, s.def.unit, s.def.formula, ...periods.map((p) => s.byPeriod[p]?.value ?? (s.byPeriod[p] ? STATUS_LABEL[s.byPeriod[p].status] : ""))]));
    downloadText(`${exportName ?? title}.csv`.replace(/\s+/g, "_"), toCsv(data), "text/csv");
  };
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle ?? "Click any value for formula, inputs and source pages. ᵈ = includes derived/averaged inputs; ! = low confidence."}
        right={
          <>
            {right}
            <Input placeholder="Filter metrics" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 w-36 text-xs" />
            <Button size="sm" variant="ghost" onClick={() => setSortAsc((s) => (s === null ? true : s ? false : null))} title="Sort by name">
              <ArrowDownUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </>
        }
      />
      <div className="scroll-thin overflow-x-auto">
        <table className="fin w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="sticky left-0 bg-slate-50 px-4 py-2">Metric</th>
              {periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.def.key} className="border-b border-line last:border-0 hover:bg-slate-50/60">
                <td className="sticky left-0 bg-white px-4 py-1.5" title={`${s.def.formula}\n${s.def.description}`}>
                  <span className="font-medium">{s.def.name}</span>
                </td>
                {periods.map((p) => (
                  <td key={p} className="px-3 py-1.5 text-right">
                    <MetricCell r={s.byPeriod[p]} onClick={() => setSel(s.byPeriod[p])} />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr><td className="px-4 py-6 text-center text-ink-soft" colSpan={periods.length + 1}>No metrics.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <MetricDetail r={sel} onClose={() => setSel(null)} />
    </Card>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: MetricUnit;
  type?: "bar" | "line" | "area";
  axis?: "left" | "right";
  values: Record<string, number | null>;
  color?: string;
}

const tickFmt = (unit: MetricUnit) => (v: number) => (unit === "pct" ? `${v.toFixed(0)}%` : unit === "x" ? `${v.toFixed(1)}x` : unit === "days" ? `${v.toFixed(0)}d` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));

export function TrendChart({ title, subtitle, periods, series, height = 280, selectable = false, empty }: { title: string; subtitle?: string; periods: string[]; series: ChartSeries[]; height?: number; selectable?: boolean; empty?: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = series.filter((s) => !hidden.has(s.key));
  const data = periods.map((p) => {
    const row: Record<string, string | number | null> = { period: p };
    for (const s of series) row[s.key] = s.values[p] ?? null;
    return row;
  });
  const hasData = series.some((s) => periods.some((p) => s.values[p] !== null && s.values[p] !== undefined));
  const leftUnit = shown.find((s) => (s.axis ?? "left") === "left")?.unit ?? "cr";
  const rightUnit = shown.find((s) => s.axis === "right")?.unit;
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle ?? `Units: ${[...new Set(series.map((s) => (s.unit === "cr" ? "₹ crore" : s.unit === "pct" ? "%" : s.unit)))].join(", ")}`}
        right={
          selectable ? (
            <div className="flex flex-wrap gap-1">
              {series.map((s, i) => (
                <button key={s.key} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })} className={cn("rounded border px-1.5 py-0.5 text-[11px]", hidden.has(s.key) ? "border-line text-slate-400" : "border-transparent text-white")} style={hidden.has(s.key) ? {} : { background: s.color ?? PALETTE[i % PALETTE.length] }}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="p-2" style={{ height }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">{empty ?? "Insufficient data to plot."}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#3b4a66" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#3b4a66" }} tickFormatter={tickFmt(leftUnit)} width={52} />
              {rightUnit && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#3b4a66" }} tickFormatter={tickFmt(rightUnit)} width={48} />}
              <ReferenceLine yAxisId="left" y={0} stroke="#cbd5e1" />
              <RTooltip formatter={(v, n) => { const s = series.find((x) => x.label === n); return [typeof v === "number" ? fmtNum(v, s?.unit ?? "num") : "n/a", n]; }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s, i) => {
                if (hidden.has(s.key)) return null;
                const color = s.color ?? PALETTE[i % PALETTE.length];
                const common = { key: s.key, dataKey: s.key, name: s.label, yAxisId: s.axis ?? "left", isAnimationActive: false } as const;
                if ((s.type ?? "bar") === "bar") return <Bar {...common} fill={color} radius={[3, 3, 0, 0]} maxBarSize={44} />;
                if (s.type === "area") return <Area {...common} type="monotone" stroke={color} fill={color} fillOpacity={0.12} connectNulls={false} />;
                return <Line {...common} type="monotone" stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />;
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function seriesFrom(s: MetricSeries | undefined, periods: string[], opts: Partial<ChartSeries> = {}): ChartSeries {
  return { key: s?.def.key ?? opts.key ?? "x", label: opts.label ?? s?.def.name ?? "", unit: s?.def.unit ?? "num", values: Object.fromEntries(periods.map((p) => [p, s?.byPeriod[p]?.status === "ok" ? s.byPeriod[p].value : null])), ...opts };
}

export function WaterfallChart({ title, steps, unit = "cr", height = 280 }: { title: string; steps: { label: string; value: number | null; total?: boolean }[]; unit?: MetricUnit; height?: number }) {
  let running = 0;
  const ok = steps.every((s) => s.value !== null);
  const data = steps.map((s) => {
    const v = s.value ?? 0;
    if (s.total) {
      running = v;
      return { label: s.label, base: Math.min(0, v), delta: Math.abs(v), raw: v, kind: "total" };
    }
    const start = running;
    running += v;
    return { label: s.label, base: Math.min(start, running), delta: Math.abs(v), raw: v, kind: v >= 0 ? "up" : "down" };
  });
  return (
    <Card>
      <CardHeader title={title} subtitle="Bridge of reported/calculated amounts (₹ crore)" />
      <div className="p-2" style={{ height }}>
        {!ok ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">Insufficient data for the bridge: {steps.filter((s) => s.value === null).map((s) => s.label).join(", ")} missing.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#3b4a66" }} interval={0} />
              <YAxis tick={{ fontSize: 11, fill: "#3b4a66" }} tickFormatter={tickFmt(unit)} width={52} />
              <RTooltip formatter={(_v, _n, item) => [fmtNum((item?.payload as { raw: number }).raw, unit), "Amount"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="delta" stackId="a" isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.kind === "total" ? "#1d4ed8" : d.kind === "up" ? "#15803d" : "#b91c1c"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export function Heatmap({ title, rows, cols, value, unit = "pct", subtitle, goodHigh = true }: { title: string; rows: string[]; cols: string[]; value: (r: string, c: string) => number | null; unit?: MetricUnit; subtitle?: string; goodHigh?: boolean }) {
  const vals = rows.flatMap((r) => cols.map((c) => value(r, c))).filter((v): v is number => v !== null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const color = (v: number | null) => {
    if (v === null || !vals.length) return "#f8fafc";
    let t = max === min ? 0.5 : (v - min) / (max - min);
    if (!goodHigh) t = 1 - t;
    const r = Math.round(185 + (21 - 185) * t), g = Math.round(28 + (128 - 28) * t), b = Math.round(28 + (61 - 28) * t);
    return `rgba(${r},${g},${b},${0.15 + 0.55 * Math.abs(t - 0.5) * 2})`;
  };
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="scroll-thin overflow-x-auto p-3">
        <table className="fin text-xs">
          <thead><tr><th className="px-2 py-1" />{cols.map((c) => <th key={c} className="px-3 py-1 text-ink-soft">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="px-2 py-1 font-medium">{r}</td>
                {cols.map((c) => {
                  const v = value(r, c);
                  return <td key={c} className="num px-3 py-2 text-center" style={{ background: color(v) }}>{v === null ? "—" : fmtNum(v, unit)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function FlagCard({ f }: { f: RedFlag }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-white p-3 print-avoid">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
            <Badge tone={f.kind === "confirmed-disclosure" ? "purple" : "slate"}>{f.kind === "confirmed-disclosure" ? "Disclosure in report" : "Potential warning sign"}</Badge>
            <span className="font-medium">{f.title}</span>
          </div>
          <div className="mt-1 text-sm text-ink-soft">{f.observation}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Less" : "Details"}</Button>
      </div>
      {f.numbers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {f.numbers.map((n, i) => (
            <span key={i} className="rounded-md bg-slate-50 px-2 py-0.5 text-xs"><span className="text-ink-soft">{n.label}{n.period ? ` (${n.period})` : ""}:</span> <b className="num">{fmtNum(n.value, n.unit)}</b></span>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-3 grid gap-2 text-[13px] md:grid-cols-2">
          {f.history && <div className="md:col-span-2"><b>History:</b> <span className="num">{f.history}</span></div>}
          <div><b>Why it matters:</b> {f.whyItMatters}</div>
          <div><b>Alternative explanations:</b> {f.alternatives}</div>
          <div className="md:col-span-2"><b>What to verify:</b> {f.verify}</div>
          {f.sources.length > 0 && (
            <div className="md:col-span-2 space-y-1">
              <b>Sources:</b>
              {f.sources.map((s, i) => (
                <div key={i} className="rounded-md bg-slate-50 p-2 text-xs"><SourceTag name={s.docName} page={s.page} />{s.text && <div className="mt-1 italic text-ink-soft">“{s.text.slice(0, 400)}”</div>}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NoData({ what, children }: { what: string; children?: ReactNode }) {
  return <Callout tone="amber" title={`Insufficient data: ${what}`}>{children ?? "Upload the relevant reports or enter the figures in Data Review."}</Callout>;
}
