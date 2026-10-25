"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle, Stat } from "@/components/ui";
import { MetricTable, seriesFrom, TrendChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function ReturnsPage() {
  const { analysis: a, fyRange, project } = useProject();
  const L = a.latestFy;
  const m = (k: string, p = L) => (p ? a.annual[k]?.byPeriod[p]?.value ?? null : null);
  const wacc = project.settings.valuation.wacc;
  const ke = project.settings.valuation.costOfEquity;
  const npm = m("dupontNpm"), at = m("dupontAt"), em = m("dupontEm");
  const first = fyRange[0];
  const driver = (() => {
    if (!first || first === L) return null;
    const ch = (k: string) => (m(k) !== null && m(k, first) !== null ? (m(k) as number) / (m(k, first) as number) - 1 : null);
    const parts = [{ n: "net margin", c: ch("dupontNpm") }, { n: "asset turnover", c: ch("dupontAt") }, { n: "financial leverage (equity multiplier)", c: ch("dupontEm") }].filter((x) => x.c !== null) as { n: string; c: number }[];
    if (!parts.length) return null;
    const top = parts.sort((x, y) => Math.abs(y.c) - Math.abs(x.c))[0];
    return `Between ${first} and ${L}, the largest change in the ROE drivers came from ${top.n} (${top.c >= 0 ? "+" : ""}${(top.c * 100).toFixed(0)}%).`;
  })();
  const roic = m("roic");
  return (
    <div className="space-y-5">
      <PageTitle title="Returns & capital efficiency" subtitle="Average balances are used (opening + closing ÷ 2); where the opening balance is unavailable the closing balance is used and flagged." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="ROE" value={fmtNum(m("roe"), "pct")} sub={`vs cost of equity ${ke}% (your assumption)`} tone={m("roe") !== null ? (m("roe")! > ke ? "pos" : "neg") : undefined} />
        <Stat label="ROCE (pre-tax)" value={fmtNum(m("roce"), "pct")} />
        <Stat label="ROIC (post-tax)" value={fmtNum(roic, "pct")} sub={`vs WACC ${wacc}% (your assumption)`} tone={roic !== null ? (roic > wacc ? "pos" : "neg") : undefined} />
        <Stat label="ROA" value={fmtNum(m("roa"), "pct")} />
        <Stat label="EVA" value={fmtNum(m("eva"))} sub="NOPAT − WACC × invested capital" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Return ratios vs cost of capital" periods={fyRange} selectable series={[seriesFrom(a.annual.roe, fyRange, { type: "line" }), seriesFrom(a.annual.roce, fyRange, { type: "line" }), seriesFrom(a.annual.roic, fyRange, { type: "line" }), { key: "wacc", label: "WACC (assumption)", unit: "pct", type: "line", color: "#94a3b8", values: Object.fromEntries(fyRange.map((p) => [p, wacc])) }]} />
        <TrendChart title="DuPont decomposition of ROE" periods={fyRange} selectable series={[seriesFrom(a.annual.dupontNpm, fyRange, { type: "bar" }), seriesFrom(a.annual.dupontAt, fyRange, { type: "line", axis: "right" }), seriesFrom(a.annual.dupontEm, fyRange, { type: "line", axis: "right" })]} />
      </div>
      <Card>
        <CardHeader title="DuPont analysis" subtitle="ROE = net margin × asset turnover × equity multiplier (all on average balances)." />
        <CardBody className="space-y-2 text-sm">
          {npm !== null && at !== null && em !== null ? (
            <div className="num">{L}: {npm.toFixed(2)}% × {at.toFixed(2)}x × {em.toFixed(2)}x = <b>{((npm * at * em)).toFixed(2)}%</b> (reported ROE on owners' equity: {fmtNum(m("roe"), "pct")})</div>
          ) : <div className="text-ink-soft">Insufficient data for the DuPont identity.</div>}
          {driver && <div>{driver}</div>}
          {em !== null && em > 3 && <Callout tone="amber">An equity multiplier above 3x means ROE is substantially supported by financial leverage rather than operating performance.</Callout>}
        </CardBody>
      </Card>
      <MetricTable title="Return & efficiency metrics" series={a.annual} keys={["roe", "roce", "roa", "roic", "eva", "assetTurnover", "fixedAssetTurnover", "wcTurnover", "dupontNpm", "dupontAt", "dupontEm", "capitalEmployed"]} periods={fyRange} />
      <Callout tone="slate">ROIC methodology: NOPAT = operating EBIT (excluding other income) × (1 − effective tax rate, statutory 25.17% when not meaningful). Invested capital = equity + non-controlling interest + debt (+ leases if enabled) − cash-like balances (financing approach) — this differs from accounting equity and from total capital employed used in ROCE. WACC and cost of equity are your assumptions from the Valuation page.</Callout>
    </div>
  );
}
