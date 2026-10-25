"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle } from "@/components/ui";
import { FlagCard, Heatmap, MetricTable, seriesFrom, TrendChart, WaterfallChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function ProfitabilityPage() {
  const { analysis: a, fyRange } = useProject();
  const L = a.latestFy;
  const g = (k: string) => (L ? a.view.get(L, k)?.value ?? null : null);
  const q16 = a.quarters.slice(-16);
  const fysQ = [...new Set(q16.map((q) => q.slice(2)))];
  const ebitda = L ? a.annual.ebitda?.byPeriod[L]?.value ?? null : null;
  const cogs = [g("materialsCost"), g("purchasesStockInTrade"), g("changesInInventories")];
  const cogsV = cogs.every((x) => x !== null) ? (cogs as number[]).reduce((s, x) => s + x, 0) : null;
  const opexOther = ebitda !== null && g("revenue") !== null && cogsV !== null && g("employeeCost") !== null ? g("revenue")! - ebitda - cogsV - g("employeeCost")! : null;
  const flags = a.flags.filter((f) => ["other-income-dependence", "exceptional-items", "tax-rate", "depreciation-drop"].includes(f.id));
  // operating leverage commentary
  const rg = L ? a.annual.revenueGrowth?.byPeriod[L]?.value ?? null : null;
  const eg = L ? a.annual.ebitdaGrowth?.byPeriod[L]?.value ?? null : null;
  const pg = L ? a.annual.patGrowth?.byPeriod[L]?.value ?? null : null;
  return (
    <div className="space-y-5">
      <PageTitle title="Profitability & margins" subtitle="EBITDA and EBIT are calculated from reported P&L lines (excluding other income and exceptional items). Reported vs adjusted figures are labelled separately." />
      {a.financial && <Callout tone="amber">EBITDA-based margins are not applicable to financial institutions; see the Sector lens for NII, cost-to-income and credit cost.</Callout>}
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Annual margins" periods={fyRange} selectable series={[seriesFrom(a.annual.grossMargin, fyRange, { type: "line" }), seriesFrom(a.annual.ebitdaMargin, fyRange, { type: "line" }), seriesFrom(a.annual.ebitMargin, fyRange, { type: "line" }), seriesFrom(a.annual.pbtMargin, fyRange, { type: "line" }), seriesFrom(a.annual.patMargin, fyRange, { type: "line" })]} />
        <TrendChart title="Quarterly margins (16 quarters)" periods={q16} selectable series={[seriesFrom(a.quarterly.ebitdaMargin, q16, { type: "line" }), seriesFrom(a.quarterly.ebitMargin, q16, { type: "line" }), seriesFrom(a.quarterly.patMargin, q16, { type: "line" })]} />
        <TrendChart title="Cost structure (% of revenue)" periods={fyRange} selectable series={[seriesFrom(a.annual.materialCostPct, fyRange, { type: "line" }), seriesFrom(a.annual.employeeCostPct, fyRange, { type: "line" }), seriesFrom(a.annual.powerFuelPct, fyRange, { type: "line" }), seriesFrom(a.annual.financeCostPct, fyRange, { type: "line" })]} />
        <WaterfallChart title={`Profit bridge ${L ?? ""}`} steps={[
          { label: "Revenue", value: g("revenue"), total: true },
          { label: "COGS", value: cogsV === null ? null : -cogsV },
          { label: "Employee", value: g("employeeCost") === null ? null : -g("employeeCost")! },
          { label: "Other opex", value: opexOther === null ? null : -opexOther },
          { label: "EBITDA", value: ebitda, total: true },
          { label: "D&A", value: g("depreciation") === null ? null : -g("depreciation")! },
          { label: "Other income", value: g("otherIncome") },
          { label: "Finance", value: g("financeCost") === null ? null : -g("financeCost")! },
          { label: "Exceptional", value: g("exceptionalEffect") },
          { label: "PBT", value: g("pbt"), total: true },
          { label: "Tax", value: g("totalTax") === null ? null : -g("totalTax")! },
          { label: "PAT", value: g("pat"), total: true },
        ]} />
      </div>
      {fysQ.length > 0 && <Heatmap title="Quarterly EBITDA margin heatmap" subtitle="Rows = financial year, columns = quarter. Darker green = higher margin." rows={fysQ} cols={["Q1", "Q2", "Q3", "Q4"]} value={(r, c) => a.quarterly.ebitdaMargin?.byPeriod[`${c}${r}`]?.value ?? null} />}
      <MetricTable title="Profitability metrics" series={a.annual} keys={["revenue", "grossProfit", "grossMargin", "ebitda", "ebitdaMargin", "ebit", "ebitMargin", "pbtMargin", "pat", "patMargin", "adjustedPat", "effectiveTaxRate", "otherIncomeToPbt", "exceptionalToPbt", "incrementalEbitdaMargin", "interestCoverage", "employeeCostPct", "materialCostPct", "powerFuelPct", "financeCostPct"]} periods={fyRange} />
      <Card>
        <CardHeader title="Operating leverage & sustainability" subtitle="Deterministic reading of the latest year." />
        <CardBody className="space-y-2 text-sm">
          {rg === null ? <div className="text-ink-soft">Insufficient data for growth comparison.</div> : (
            <ul className="list-disc space-y-1 pl-5">
              <li>Revenue grew {fmtNum(rg, "pct")}, EBITDA {fmtNum(eg, "pct")} and PAT (owners) {fmtNum(pg, "pct")} in {L}.</li>
              {eg !== null && rg !== null && <li>{eg > rg + 2 ? "EBITDA grew faster than revenue — positive operating leverage (fixed costs spread over higher sales, or lower input costs)." : eg < rg - 2 ? "EBITDA lagged revenue — margin compression (cost inflation, pricing pressure or mix)." : "EBITDA moved broadly in line with revenue."}</li>}
              {pg !== null && eg !== null && pg > eg + 5 && <li>PAT grew materially faster than EBITDA — check other income, lower finance costs, tax rate and exceptional items (see adjusted PAT).</li>}
              <li>Adjusted PAT removes only disclosed exceptional items at the effective tax rate; it is labelled “adjusted” and never replaces reported PAT.</li>
            </ul>
          )}
        </CardBody>
      </Card>
      {flags.length > 0 && <div className="space-y-2">{flags.map((f) => <FlagCard key={f.id} f={f} />)}</div>}
    </div>
  );
}
