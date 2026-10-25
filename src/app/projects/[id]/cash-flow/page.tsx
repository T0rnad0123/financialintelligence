"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle, Stat } from "@/components/ui";
import { FlagCard, MetricTable, seriesFrom, TrendChart, WaterfallChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function CashFlowPage() {
  const { analysis: a, fyRange } = useProject();
  const L = a.latestFy;
  const g = (k: string) => (L ? a.view.get(L, k)?.value ?? null : null);
  let cumCfo = 0, cumPat = 0, cumFcf = 0, n = 0;
  for (const p of fyRange) {
    const c = a.view.get(p, "cfo")?.value;
    const pt = a.view.get(p, "pat")?.value;
    const f = a.annual.fcf?.byPeriod[p]?.value;
    if (c != null && pt != null) { cumCfo += c; cumPat += pt; n++; if (f != null) cumFcf += f; }
  }
  const flags = a.flags.filter((f) => ["cum-cash-conversion", "negative-fcf", "dividends-debt-funded", "revenue-up-ocf-down", "high-accruals"].includes(f.id));
  return (
    <div className="space-y-5">
      <PageTitle title="Cash-flow analysis" subtitle="Sign convention: inflows positive, outflows negative for CFO/CFI/CFF; capex, dividends and repayments are shown as positive outflow amounts. FCF = OCF − gross capex." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Cumulative OCF (${n} yrs)`} value={n ? fmtNum(cumCfo) : "—"} />
        <Stat label="Cumulative PAT" value={n ? fmtNum(cumPat) : "—"} />
        <Stat label="Cumulative OCF / PAT" value={n && cumPat > 0 ? fmtNum(cumCfo / cumPat, "x", 2) : "—"} tone={n && cumPat > 0 ? (cumCfo / cumPat >= 1 ? "pos" : "neg") : undefined} hint="Above 1x means profits are backed by cash over the period." />
        <Stat label="Cumulative FCF" value={n ? fmtNum(cumFcf) : "—"} tone={n ? (cumFcf >= 0 ? "pos" : "neg") : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Cash flow by activity" periods={fyRange} series={[seriesFrom(a.annual.cfo, fyRange, { type: "bar", color: "#15803d" }), seriesFrom(a.annual.cfi, fyRange, { type: "bar", color: "#a87a12" }), seriesFrom(a.annual.cff, fyRange, { type: "bar", color: "#b91c1c" })]} />
        <TrendChart title="PAT vs OCF vs FCF" periods={fyRange} series={[seriesFrom(a.annual.pat, fyRange, { type: "line" }), seriesFrom(a.annual.cfo, fyRange, { type: "line", color: "#15803d" }), seriesFrom(a.annual.fcf, fyRange, { type: "line", color: "#a87a12" })]} />
        <TrendChart title="Cash conversion ratios" periods={fyRange} selectable series={[seriesFrom(a.annual.ocfToPat, fyRange, { type: "line" }), seriesFrom(a.annual.fcfToPat, fyRange, { type: "line" }), seriesFrom(a.annual.capexToDepreciation, fyRange, { type: "line" })]} />
        <WaterfallChart title={`Free cash flow use ${L ?? ""}`} steps={[
          { label: "OCF", value: g("cfo"), total: true },
          { label: "Capex", value: g("capexTotal") === null ? null : -g("capexTotal")! },
          { label: "FCF", value: a.annual.fcf?.byPeriod[L ?? ""]?.value ?? null, total: true },
          { label: "Dividends", value: g("dividendsPaid") === null ? null : -g("dividendsPaid")! },
          { label: "Interest paid", value: g("interestPaid") === null ? null : -g("interestPaid")! },
          { label: "Net borrowing", value: a.annual.netBorrowing?.byPeriod[L ?? ""]?.value ?? null },
        ]} />
      </div>
      <MetricTable title="Cash-flow metrics" series={a.annual} keys={["cfo", "cfi", "cff", "capex", "fcf", "ocfToPat", "fcfToPat", "ocfToEbitda", "ocfToRevenue", "capexToRevenue", "capexToDepreciation", "dividendsToFcf", "fcfAfterDividends", "netBorrowing", "payoutRatio"]} periods={fyRange} />
      <Card>
        <CardHeader title="Interpretation guide" />
        <CardBody className="text-sm text-ink-soft">
          Negative free cash flow during a disclosed expansion (capex/depreciation well above 1x, rising CWIP, commissioning timelines in the MD&A) differs from persistent structural weakness (low OCF/PAT with modest capex). Interest paid is presented in financing activities by most Indian companies, so it is not deducted in OCF; “cash available for shareholders” = FCF − interest − debt repayment + new borrowing.
        </CardBody>
      </Card>
      {flags.length ? <div className="space-y-2">{flags.map((f) => <FlagCard key={f.id} f={f} />)}</div> : <Callout tone="green">No cash-flow warning sign triggered.</Callout>}
    </div>
  );
}
