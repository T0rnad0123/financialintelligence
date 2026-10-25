"use client";
import { useProject } from "@/components/project/ProjectProvider";
import { Callout, Card, CardBody, CardHeader, PageTitle } from "@/components/ui";
import { FlagCard, MetricTable, seriesFrom, TrendChart } from "@/components/analysis";
import { fmtNum } from "@/lib/engine/core";

export default function WorkingCapitalPage() {
  const { analysis: a, fyRange } = useProject();
  const L = a.latestFy;
  const P = a.fys.length > 1 ? a.fys[a.fys.length - 2] : null;
  const m = (k: string, p: string | null) => (p ? a.annual[k]?.byPeriod[p]?.value ?? null : null);
  const d = (k: string) => (m(k, L) !== null && m(k, P) !== null ? (m(k, L) as number) - (m(k, P) as number) : null);
  const first = fyRange[0];
  const firstUsesClosing = first ? a.annual.receivableDays?.byPeriod[first]?.notes.some((n) => n.includes("closing")) : false;
  const flags = a.flags.filter((f) => ["receivables-vs-revenue", "inventory-vs-revenue"].includes(f.id));
  const lines: string[] = [];
  if (d("receivableDays") !== null) lines.push(d("receivableDays")! > 3 ? `Customers are paying more slowly: receivable days up ${fmtNum(d("receivableDays"), "days")}.` : d("receivableDays")! < -3 ? `Collections improved: receivable days down ${fmtNum(-d("receivableDays")!, "days")}.` : "Collection period broadly stable.");
  if (d("inventoryDays") !== null) lines.push(d("inventoryDays")! > 3 ? `Inventory is accumulating: inventory days up ${fmtNum(d("inventoryDays"), "days")}.` : d("inventoryDays")! < -3 ? `Inventory turned faster: down ${fmtNum(-d("inventoryDays")!, "days")}.` : "Inventory holding broadly stable.");
  if (d("payableDays") !== null) lines.push(d("payableDays")! > 3 ? `Supplier credit increased by ${fmtNum(d("payableDays"), "days")} — check whether this reflects stretched payments or supplier financing.` : d("payableDays")! < -3 ? `Supplier credit fell by ${fmtNum(-d("payableDays")!, "days")}.` : "Supplier credit broadly stable.");
  const dwc = m("changeInOperatingWc", L);
  if (dwc !== null) lines.push(dwc > 0 ? `Working capital absorbed ₹${dwc.toFixed(0)} cr of cash in ${L}.` : `Working capital released ₹${(-dwc).toFixed(0)} cr of cash in ${L}.`);
  return (
    <div className="space-y-5">
      <PageTitle title="Working-capital analysis" subtitle="Day counts use average of opening and closing balances; receivable days on revenue, inventory and payable days on cost of goods sold (materials + purchases + inventory change)." />
      {firstUsesClosing && <Callout tone="slate">For the earliest year ({first}) the opening balance sheet is not available, so closing balances are used — this is flagged on each affected value.</Callout>}
      {a.financial && <Callout tone="amber">Trade working-capital metrics are not applicable to banks/NBFCs/insurers.</Callout>}
      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart title="Working-capital days" periods={fyRange} selectable series={[seriesFrom(a.annual.receivableDays, fyRange, { type: "line" }), seriesFrom(a.annual.inventoryDays, fyRange, { type: "line" }), seriesFrom(a.annual.payableDays, fyRange, { type: "line" }), seriesFrom(a.annual.ccc, fyRange, { type: "bar", color: "#cbd5e1" })]} />
        <TrendChart title="Working capital relative to revenue" periods={fyRange} selectable series={[seriesFrom(a.annual.nwcToRevenue, fyRange, { type: "line" }), seriesFrom(a.annual.receivablesToRevenue, fyRange, { type: "line" }), seriesFrom(a.annual.inventoryToRevenue, fyRange, { type: "line" }), seriesFrom(a.annual.changeInOperatingWc, fyRange, { type: "bar", axis: "right" })]} />
      </div>
      <Card>
        <CardHeader title={`What changed in ${L ?? "the latest year"}`} />
        <CardBody>{lines.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <div className="text-sm text-ink-soft">Needs two consecutive years of balance sheets.</div>}</CardBody>
      </Card>
      <MetricTable title="Working-capital metrics" series={a.annual} keys={["receivableDays", "inventoryDays", "payableDays", "ccc", "wcTurnover", "receivablesToRevenue", "inventoryToRevenue", "nwcToRevenue", "changeInOperatingWc", "netWorkingCapital", "currentRatio"]} periods={fyRange} />
      {flags.map((f) => <FlagCard key={f.id} f={f} />)}
      <Callout tone="slate">Overdue receivables and supplier-financing (reverse factoring) arrangements are disclosed in notes (receivables ageing, MSME dues) and are not extracted numerically. Industry context matters: EPC and government suppliers structurally carry higher receivable days than FMCG companies.</Callout>
    </div>
  );
}
