"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle } from "@/components/ui";
import { FlagCard, MetricTable, seriesFrom, TrendChart, type ChartSeries } from "@/components/analysis";
import { itemLabel } from "@/lib/lineItems";

export default function BalanceSheetPage() {
  const { analysis: a, fyRange, project } = useProject();
  const v = (p: string, k: string) => a.view.get(p, k)?.value ?? null;
  const comp = (keys: string[]): ChartSeries[] => keys.map((k) => ({ key: k, label: itemLabel(k), unit: "cr", type: "bar", values: Object.fromEntries(fyRange.map((p) => [p, v(p, k)])) }));
  const flags = a.flags.filter((f) => ["high-leverage", "rising-leverage", "weak-coverage", "weak-liquidity", "intangibles-heavy"].includes(f.id));
  return (
    <div className="space-y-5">
      <PageTitle title="Balance-sheet analysis" subtitle={`Debt treatment: borrowings ${project.settings.valuation.includeLeasesInDebt ? "+ lease liabilities" : "only (leases excluded)"}; cash-like: cash + other bank balances${project.settings.valuation.includeCurrentInvestmentsInCash ? " + current investments" : ""}. Change in Settings.`} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Debt, cash and net debt" periods={fyRange} series={[seriesFrom(a.annual.totalDebt, fyRange, { type: "bar" }), seriesFrom(a.annual.cashLike, fyRange, { type: "bar", color: "#15803d" }), seriesFrom(a.annual.netDebt, fyRange, { type: "line", color: "#b91c1c" })]} />
        <TrendChart title="Leverage ratios" periods={fyRange} selectable series={[seriesFrom(a.annual.debtToEquity, fyRange, { type: "line" }), seriesFrom(a.annual.netDebtToEbitda, fyRange, { type: "line" }), seriesFrom(a.annual.interestCoverage, fyRange, { type: "line", axis: "right" })]} />
        <TrendChart title="Asset composition" periods={fyRange} selectable series={comp(["ppe", "cwip", "goodwill", "intangibles", "inventories", "tradeReceivables", "cash"])} />
        <TrendChart title="Funding composition" periods={fyRange} selectable series={comp(["totalEquity", "longTermBorrowings", "shortTermBorrowings", "leaseLiabilities", "tradePayables"])} />
      </div>
      <MetricTable title="Balance-sheet metrics" series={a.annual} keys={["totalDebt", "cashLike", "netDebt", "debtToEquity", "netDebtToEquity", "debtToAssets", "equityRatio", "currentRatio", "quickRatio", "cashRatio", "netWorkingCapital", "netDebtToEbitda", "interestCoverage", "ebitdaInterestCover", "tangibleNetWorth", "goodwillToAssets", "intangiblesToAssets", "capitalEmployed", "shortTermDebtShare", "assetTurnover"]} periods={fyRange} />
      <Card>
        <CardHeader title="Reading the balance sheet" />
        <CardBody className="text-sm text-ink-soft">
          Debt is not automatically bad: judge it against earnings stability, cash generation, maturity profile and capex. Utilities and infrastructure companies with contracted cash flows typically carry more leverage than consumer businesses. Restricted cash, maturity schedules and covenants are disclosed in notes that are not extracted numerically — read them before concluding.
        </CardBody>
      </Card>
      {flags.length ? <div className="space-y-2">{flags.map((f) => <FlagCard key={f.id} f={f} />)}</div> : <Callout tone="green">No leverage, liquidity or intangibles warning sign was triggered for the latest year.</Callout>}
    </div>
  );
}
