"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader, cn, Input, Label, NumberField, PageTitle, Select, Slider, Stat, Tabs, Toggle } from "@/components/ui";
import { AiPanel } from "@/components/AiPanel";
import { fmtNum } from "@/lib/engine/core";
import { capmCostOfEquity, seedScenarios, waccFromInputs } from "@/lib/engine/valuation";
import type { DcfScenario, ValuationSettings } from "@/lib/types";

export default function ValuationPage() {
  const { project, analysis: a, update } = useProject();
  const s = project.settings.valuation;
  const v = a.valuation;
  const [tab, setTab] = useState<"bear" | "base" | "bull">(s.activeScenario);
  const setV = (patch: Partial<ValuationSettings>) => update((p) => ({ ...p, settings: { ...p.settings, valuation: { ...p.settings.valuation, ...patch } } }));
  const setSc = (k: "bear" | "base" | "bull", patch: Partial<DcfScenario>) => update((p) => ({ ...p, settings: { ...p.settings, valuation: { ...p.settings.valuation, scenarios: { ...p.settings.valuation.scenarios, [k]: { ...p.settings.valuation.scenarios[k], ...patch } } } } }));
  const seed = useMemo(() => (a.fys.length ? seedScenarios(a.view, a.fys) : null), [a.view, a.fys]);
  const ke = capmCostOfEquity(s.riskFree, s.beta, s.equityRiskPremium);
  const builtWacc = v.marketCap !== null && v.bridge ? waccFromInputs(ke, s.preTaxCostOfDebt, s.scenarios.base.taxRate, v.marketCap, (v.bridge.debt || 0) + v.bridge.leases) : null;
  const sc = s.scenarios[tab];
  const dcf = v.dcf[tab];
  const price = project.price;

  return (
    <div className="space-y-5">
      <PageTitle title="Valuation" subtitle="The only market input is the current share price you enter. No historical or live prices are fetched, and no technical signals are produced. All valuation outputs are model estimates driven by your assumptions." />
      <Card>
        <CardHeader title="Market inputs" subtitle="Manual entry only." />
        <CardBody className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div><Label htmlFor="price" hint="Required for market cap, multiples, upside and reverse DCF.">Enter Current Share Price (₹)</Label><NumberField id="price" value={project.price} onChange={(x) => update((p) => ({ ...p, price: x !== null && x > 0 ? x : null }))} placeholder="e.g. 1250.50" /></div>
          <div><Label>Price date</Label><Input type="date" value={project.priceDate ?? ""} onChange={(e) => update((p) => ({ ...p, priceDate: e.target.value || undefined }))} /></div>
          <div><Label hint={a.shares.source}>Basic shares outstanding</Label><NumberField value={project.sharesOutstanding ?? (a.shares.basic ? Math.round(a.shares.basic) : null)} step={1} onChange={(x) => update((p) => ({ ...p, sharesOutstanding: x !== null && x > 0 ? x : null, sharesSource: "Entered/confirmed by user" }))} /><div className="mt-0.5 text-[10px] text-ink-soft">{project.sharesOutstanding ? "Confirmed by you" : a.shares.source}</div></div>
          <div><Label>Diluted shares (optional)</Label><NumberField value={project.dilutedShares} step={1} onChange={(x) => update((p) => ({ ...p, dilutedShares: x !== null && x > 0 ? x : null }))} /></div>
          <div><Label>Per-share basis</Label><Select className="w-full" value={s.shareBasis} onChange={(x) => setV({ shareBasis: x as "basic" | "diluted" })} options={[{ value: "basic", label: "Basic" }, { value: "diluted", label: "Diluted" }]} /></div>
          <div><Label hint="TTM requires four consecutive quarters for the selected basis.">Earnings base for multiples</Label><Select className="w-full" value={s.earningsBase} onChange={(x) => setV({ earningsBase: x as "latestFY" | "ttm" })} options={[{ value: "latestFY", label: "Latest financial year" }, { value: "ttm", label: "Trailing 12 months" }]} /></div>
        </CardBody>
      </Card>
      {v.warnings.map((w, i) => <Callout key={i} tone="amber">{w}</Callout>)}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Market capitalisation & enterprise value" subtitle={v.bridgeNotes[0]} />
          <CardBody className="space-y-1 text-sm">
            <Row l="Basic market capitalisation" r={fmtNum(v.marketCap)} sub={v.marketCapReason} />
            <Row l="Diluted equity value" r={fmtNum(v.dilutedEquityValue)} sub={project.dilutedShares ? "" : "Enter diluted shares"} />
            {v.bridge && !a.financial && (<>
              <Row l="+ Borrowings" r={fmtNum(Number.isFinite(v.bridge.debt) ? v.bridge.debt : null)} />
              <Row l="+ Lease liabilities" r={fmtNum(v.bridge.leases)} />
              <Row l="+ Non-controlling interest" r={fmtNum(v.bridge.minorityInterest)} />
              <Row l="+ Other debt-like claims" r={fmtNum(v.bridge.otherDebtLike)} />
              <Row l="− Cash & cash-like" r={fmtNum(v.bridge.cash)} />
              <Row l="− Non-operating assets" r={fmtNum(v.bridge.nonOperatingAssets)} />
              <Row l="= Enterprise value" r={fmtNum(v.ev)} bold />
            </>)}
            {a.financial && <Callout tone="slate">Enterprise value is not meaningful for financial institutions.</Callout>}
            <div className="space-y-2 border-t border-line pt-2">
              <Toggle checked={s.includeLeasesInDebt} onChange={(x) => setV({ includeLeasesInDebt: x })} label="Treat lease liabilities as debt" />
              <Toggle checked={s.includeCurrentInvestmentsInCash} onChange={(x) => setV({ includeCurrentInvestmentsInCash: x })} label="Treat current investments as cash" hint="Only if they are liquid (e.g. liquid mutual funds) — verify in the notes." />
              <Toggle checked={s.includeMinorityInterest} onChange={(x) => setV({ includeMinorityInterest: x })} label="Add non-controlling interest" />
              <div className="grid grid-cols-2 gap-2">
                <div><Label hint="e.g. unfunded pension, preference shares, deferred spectrum payments">Other debt-like (₹ cr)</Label><NumberField value={s.otherDebtLikeClaims} onChange={(x) => setV({ otherDebtLikeClaims: x ?? 0 })} /></div>
                <div><Label hint="e.g. surplus land, listed stakes — your estimate">Non-operating assets (₹ cr)</Label><NumberField value={s.otherNonOperatingAssets} onChange={(x) => setV({ otherNonOperatingAssets: x ?? 0 })} /></div>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Relative valuation" subtitle={`Earnings base: ${v.earningsLabel}. Multiples that are not meaningful or not applicable are labelled — never shown as conventional values.`} />
          <div className="scroll-thin overflow-x-auto">
            <table className="fin w-full text-[13px]">
              <thead><tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase text-ink-soft"><th className="px-3 py-2">Metric</th><th className="text-right">Value</th><th className="px-3">Formula</th><th>Inputs</th><th className="px-3">Note</th></tr></thead>
              <tbody>
                {v.multiples.map((m) => (
                  <tr key={m.key} className="border-b border-line align-top">
                    <td className="px-3 py-1 font-medium">{m.name}</td>
                    <td className="num text-right">{m.status === "ok" ? fmtNum(m.value, m.unit, 2) : <Badge tone={m.status === "not-applicable" ? "slate" : "amber"}>{m.status}</Badge>}</td>
                    <td className="whitespace-normal px-3 text-xs text-ink-soft">{m.formula}</td>
                    <td className="whitespace-normal text-xs text-ink-soft">{m.numerator.label}: {m.numerator.value === null ? "—" : m.numerator.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}<br />{m.denominator.label}: {m.denominator.value === null ? "—" : m.denominator.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="whitespace-normal px-3 text-xs text-ink-soft">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-ink-soft">No industry-average or peer multiples are shown: the app has no comparable-company data and does not invent it. Forward P/E is not shown because no defensible forward-earnings estimate exists in the documents.</div>
        </Card>
      </div>

      {/* DCF */}
      <Card>
        <CardHeader title="Discounted cash flow (FCFF)" subtitle={v.dcfNote} right={<>
          <Tabs value={tab} onChange={(x) => { setTab(x); setV({ activeScenario: x }); }} tabs={[{ value: "bear", label: "Conservative" }, { value: "base", label: "Base" }, { value: "bull", label: "Optimistic" }]} />
          {seed && <Button size="sm" onClick={() => setV({ scenarios: seed.scenarios, seeded: true })} title="Re-seed all scenarios from historical data"><RotateCcw className="h-3.5 w-3.5" /> Re-seed from history</Button>}
        </>} />
        {v.dcfApplicable ? (
          <CardBody className="grid gap-6 xl:grid-cols-[380px_1fr]">
            <div className="space-y-3">
              <Callout tone="gold" title="Assumptions are yours">Defaults were seeded from history (see basis below) and are not forecasts. Historical growth is not assumed to continue automatically.</Callout>
              <Slider label="Revenue growth – year 1" value={sc.revenueGrowthStart} min={-20} max={50} step={0.5} onChange={(x) => setSc(tab, { revenueGrowthStart: x })} />
              <Slider label="Revenue growth – final year" value={sc.revenueGrowthEnd} min={-10} max={30} step={0.5} onChange={(x) => setSc(tab, { revenueGrowthEnd: x })} />
              <Slider label="EBIT margin – year 1" value={sc.ebitMarginStart} min={-10} max={60} step={0.5} onChange={(x) => setSc(tab, { ebitMarginStart: x })} />
              <Slider label="EBIT margin – final year" value={sc.ebitMarginEnd} min={-10} max={60} step={0.5} onChange={(x) => setSc(tab, { ebitMarginEnd: x })} />
              <Slider label="Tax rate" value={sc.taxRate} min={0} max={40} step={0.5} onChange={(x) => setSc(tab, { taxRate: x })} />
              <Slider label="D&A (% of revenue)" value={sc.daPctRevenue} min={0} max={25} step={0.1} onChange={(x) => setSc(tab, { daPctRevenue: x })} />
              <Slider label="Capex (% of revenue)" value={sc.capexPctRevenue} min={0} max={40} step={0.1} onChange={(x) => setSc(tab, { capexPctRevenue: x })} />
              <Slider label="Working capital (% of Δrevenue)" value={sc.nwcPctIncrementalRevenue} min={-30} max={80} step={0.5} onChange={(x) => setSc(tab, { nwcPctIncrementalRevenue: x })} />
              <div className="border-t border-line pt-3" />
              <Slider label="WACC" value={s.wacc} min={5} max={25} step={0.1} onChange={(x) => setV({ wacc: x })} hint="Applies to all scenarios." />
              <Slider label="Terminal growth" value={s.terminalGrowth} min={-2} max={10} step={0.1} onChange={(x) => setV({ terminalGrowth: x })} hint="Must be below WACC." />
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Forecast years</Label><Select className="w-full" value={String(s.forecastYears)} onChange={(x) => setV({ forecastYears: Number(x) })} options={[5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: `${n} years` }))} /></div>
                <div className="pt-5"><Toggle checked={s.midYear} onChange={(x) => setV({ midYear: x })} label="Mid-year discounting" /></div>
              </div>
              <details className="rounded-lg border border-line p-2 text-xs">
                <summary className="cursor-pointer font-medium">WACC builder (CAPM) — all inputs are your assumptions</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div><Label hint="e.g. current 10-year Government of India bond yield — enter the value you observe">Risk-free rate %</Label><NumberField value={s.riskFree} onChange={(x) => x !== null && setV({ riskFree: x })} /></div>
                  <div><Label>Beta</Label><NumberField value={s.beta} onChange={(x) => x !== null && setV({ beta: x })} /></div>
                  <div><Label>Equity risk premium %</Label><NumberField value={s.equityRiskPremium} onChange={(x) => x !== null && setV({ equityRiskPremium: x })} /></div>
                  <div><Label>Pre-tax cost of debt %</Label><NumberField value={s.preTaxCostOfDebt} onChange={(x) => x !== null && setV({ preTaxCostOfDebt: x })} /></div>
                </div>
                <div className="mt-2">Cost of equity = {s.riskFree} + {s.beta} × {s.equityRiskPremium} = <b>{ke.toFixed(2)}%</b>. WACC at market-value weights (equity {fmtNum(v.marketCap)}, debt {fmtNum(v.bridge ? (v.bridge.debt || 0) + v.bridge.leases : null)}): <b>{builtWacc === null ? "needs price & debt" : `${builtWacc.toFixed(2)}%`}</b></div>
                <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => setV({ costOfEquity: Math.round(ke * 100) / 100 })}>Use as cost of equity</Button>{builtWacc !== null && <Button size="sm" onClick={() => setV({ wacc: Math.round(builtWacc * 10) / 10, costOfEquity: Math.round(ke * 100) / 100 })}>Apply WACC</Button>}</div>
                <div className="mt-1 text-ink-soft">Current cost of equity used by DDM/RI: {s.costOfEquity}%</div>
              </details>
              {seed && <details className="text-xs text-ink-soft"><summary className="cursor-pointer">How the defaults were seeded</summary><ul className="mt-1 list-disc pl-4">{seed.basis.map((b, i) => <li key={i}>{b}</li>)}</ul></details>}
            </div>
            <div className="min-w-0 space-y-3">
              {dcf.result.check.errors.map((e, i) => <Callout key={i} tone="red">{e}</Callout>)}
              {dcf.result.check.warnings.map((e, i) => <Callout key={i} tone="amber">{e}</Callout>)}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Enterprise value" value={dcf.result.check.ok ? fmtNum(dcf.result.enterpriseValue) : "—"} sub={dcf.result.check.ok ? `TV = ${(dcf.result.terminalShare * 100).toFixed(0)}% of EV` : ""} />
                <Stat label="Equity value" value={fmtNum(dcf.perShare?.equity ?? null)} />
                <Stat label="Fair value / share" value={dcf.perShare ? `₹${dcf.perShare.perShare.toFixed(2)}` : "—"} sub={v.shareNote} />
                <Stat label="vs entered price" value={dcf.perShare?.upside === null || !dcf.perShare ? "—" : `${dcf.perShare.upside >= 0 ? "+" : ""}${dcf.perShare.upside.toFixed(1)}%`} tone={dcf.perShare?.upside != null ? (dcf.perShare.upside >= 0 ? "pos" : "neg") : undefined} sub={price ? `Price ₹${price}` : "Enter price"} />
              </div>
              {dcf.result.rows.length > 0 && (
                <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
                  <table className="fin w-full text-xs">
                    <thead><tr className="bg-slate-50 text-right text-[10px] uppercase text-ink-soft"><th className="px-2 py-1 text-left">Year</th><th>Revenue</th><th>Growth</th><th>EBIT %</th><th>EBIT</th><th>NOPAT</th><th>+D&A</th><th>−Capex</th><th>−ΔNWC</th><th>FCFF</th><th>DF</th><th className="px-2">PV</th></tr></thead>
                    <tbody>{dcf.result.rows.map((r) => <tr key={r.year} className="num border-t border-line text-right"><td className="px-2 text-left">Y{r.year}</td><td>{r.revenue.toFixed(0)}</td><td>{r.growth.toFixed(1)}%</td><td>{r.ebitMargin.toFixed(1)}%</td><td>{r.ebit.toFixed(0)}</td><td>{r.nopat.toFixed(0)}</td><td>{r.da.toFixed(0)}</td><td>{r.capex.toFixed(0)}</td><td>{r.deltaNwc.toFixed(0)}</td><td className="font-medium">{r.fcff.toFixed(0)}</td><td>{r.discountFactor.toFixed(3)}</td><td className="px-2">{r.pv.toFixed(0)}</td></tr>)}
                      <tr className="num border-t border-line text-right font-medium"><td className="px-2 text-left" colSpan={9}>Terminal value (Gordon growth on final FCFF) → PV</td><td>{dcf.result.terminalValue.toFixed(0)}</td><td /><td className="px-2">{dcf.result.pvTerminal.toFixed(0)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-[11px] text-ink-soft">FCFF = EBIT × (1 − tax) + D&A − capex − ΔNWC; ΔNWC = working-capital % × increase in revenue. Base revenue = {a.latestFy} reported revenue. EV → equity: − borrowings − leases (if enabled) − NCI − other claims + cash-like + non-operating assets. Values in ₹ crore.</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(["bear", "base", "bull"] as const).map((k) => <Stat key={k} label={k === "bear" ? "Conservative" : k === "base" ? "Base" : "Optimistic"} value={v.dcf[k].perShare ? `₹${v.dcf[k].perShare!.perShare.toFixed(0)}` : "—"} sub={v.dcf[k].result.check.errors[0] ?? (v.dcf[k].perShare?.upside != null ? `${v.dcf[k].perShare!.upside! >= 0 ? "+" : ""}${v.dcf[k].perShare!.upside!.toFixed(0)}% vs price` : "")} />)}
              </div>
            </div>
          </CardBody>
        ) : <CardBody><Callout tone="amber">{v.dcfNote}</Callout></CardBody>}
      </Card>

      {v.sensitivity && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title={`Sensitivity: fair value per share (${tab} scenario)`} subtitle="Rows: WACC · Columns: terminal growth. Colour = upside/downside vs entered price." />
            <CardBody className="scroll-thin overflow-x-auto">
              <table className="fin w-full text-xs">
                <thead><tr><th className="p-1 text-left text-ink-soft">WACC \ g</th>{v.sensitivityAxes.gs.map((g) => <th key={g} className="p-1 text-ink-soft">{g.toFixed(2)}%</th>)}</tr></thead>
                <tbody>{v.sensitivity.map((row, i) => <tr key={i}><td className="p-1 font-medium">{v.sensitivityAxes.waccs[i].toFixed(1)}%</td>{row.map((c, j) => <td key={j} title={c.error} className={cn("num p-2 text-center", c.value === null ? "bg-slate-50 text-slate-400" : c.upside === null ? "bg-slate-50" : c.upside > 20 ? "bg-green-200" : c.upside > 0 ? "bg-green-50" : c.upside > -20 ? "bg-red-50" : "bg-red-200", i === 2 && j === 2 && "ring-2 ring-brand")}>{c.value === null ? "n/a" : `₹${c.value.toFixed(0)}`}{c.upside !== null && <div className="text-[10px] text-ink-soft">{c.upside >= 0 ? "+" : ""}{c.upside.toFixed(0)}%</div>}</td>)}</tr>)}</tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Assumptions most responsible for the result" subtitle="Fair value per share when each driver is moved (others held)." />
            <div className="p-2" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={v.tornado.map((t) => ({ driver: t.driver, low: t.low, high: t.high, range: [Math.min(t.low ?? 0, t.high ?? 0), Math.max(t.low ?? 0, t.high ?? 0)] }))} margin={{ left: 40, right: 20 }}>
                  <CartesianGrid stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(x) => `₹${Math.round(x)}`} domain={["auto", "auto"]} />
                  <YAxis type="category" dataKey="driver" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(x) => (Array.isArray(x) ? `₹${Number(x[0]).toFixed(0)} – ₹${Number(x[1]).toFixed(0)}` : String(x))} contentStyle={{ fontSize: 12 }} />
                  {price && <ReferenceLine x={price} stroke="#b91c1c" strokeDasharray="4 2" label={{ value: "Price", fontSize: 10, fill: "#b91c1c" }} />}
                  {v.baseDcfPerShare !== null && <ReferenceLine x={v.dcf[tab].perShare?.perShare ?? 0} stroke="#1d4ed8" />}
                  <Bar dataKey="range" fill="#1d4ed8" fillOpacity={0.6} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Reverse DCF — what the entered price implies" subtitle="Solved numerically (bisection) with all other assumptions at the active scenario's values." />
        <CardBody>
          {!v.reverse ? <Callout tone="slate">Needs the share price, share count, a valid DCF and an equity bridge (debt and cash).</Callout> : (
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label="Implied constant revenue growth" value={v.reverse.impliedGrowth === null ? "No solution" : `${v.reverse.impliedGrowth.toFixed(1)}% p.a.`} sub={`for ${s.forecastYears} years, then ${s.terminalGrowth}% forever`} />
              <Stat label="Implied constant EBIT margin" value={v.reverse.impliedMargin === null ? "No solution" : `${v.reverse.impliedMargin.toFixed(1)}%`} sub={`vs latest ${fmtNum(a.latestFy ? a.annual.ebitMargin?.byPeriod[a.latestFy]?.value ?? null : null, "pct")}`} />
              <Stat label="EV / year-1 FCFF" value={v.reverse.impliedFcffYear1Multiple === null ? "—" : `${v.reverse.impliedFcffYear1Multiple.toFixed(1)}x`} />
              <div className="md:col-span-3 text-xs text-ink-soft">{v.reverse.notes.join(" ")} If the implied growth or margin is well above what the company has historically delivered, much future success is already reflected in the price; if well below, the price embeds pessimistic expectations.</div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Earnings-based valuation" subtitle="Enter your own fair P/E — no industry average is assumed." />
          <CardBody className="space-y-3">
            <div className="flex items-end gap-2"><div className="w-40"><Label>Your fair P/E (x)</Label><NumberField value={s.fairPe} onChange={(x) => setV({ fairPe: x !== null && x > 0 ? x : null })} /></div><div className="pb-1 text-sm">Value on normalised EPS: <b className="num">{v.earningsValue === null ? "—" : `₹${v.earningsValue.toFixed(0)}`}</b></div></div>
            <div className="scroll-thin overflow-x-auto"><table className="fin w-full text-xs [&_td]:px-2 [&_th]:px-2">
              <thead><tr className="text-ink-soft"><th className="text-left">EPS basis</th><th className="text-right">EPS</th>{v.earningsGrid[0]?.values.map((c) => <th key={c.pe} className="text-right">{c.pe}x</th>)}</tr></thead>
              <tbody>{v.earningsGrid.map((r) => <tr key={r.label} className="border-t border-line"><td className="min-w-[180px] whitespace-normal py-1 pr-2">{r.label}</td><td className="num text-right">{r.eps === null ? "—" : r.eps.toFixed(2)}</td>{r.values.map((c) => <td key={c.pe} className={cn("num text-right", price && c.value !== null ? (c.value > price ? "text-pos" : "text-neg") : "")}>{c.value === null ? "n/m" : c.value.toFixed(0)}</td>)}</tr>)}</tbody>
            </table></div>
            <div className="text-[11px] text-ink-soft">“n/m” = EPS not positive (P/E not meaningful). Without a fair P/E entered, the grid shows illustrative multiples only.</div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Dividend discount & residual income" subtitle={`Cost of equity: ${s.costOfEquity}% (your assumption; set via WACC builder)`} />
          <CardBody className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div><Label>DPS growth (stage 1) %</Label><NumberField value={s.ddmGrowth1} onChange={(x) => x !== null && setV({ ddmGrowth1: x })} /></div>
              <div><Label>Stage-1 years</Label><NumberField value={s.ddmYears} step={1} onChange={(x) => x !== null && setV({ ddmYears: Math.max(1, Math.min(20, Math.round(x))) })} /></div>
              <div><Label>Terminal growth %</Label><NumberField value={s.ddmTerminalGrowth} onChange={(x) => x !== null && setV({ ddmTerminalGrowth: x })} /></div>
            </div>
            <div>DDM value: <b className="num">{v.ddm.value === null ? "—" : `₹${v.ddm.value.toFixed(0)}`}</b> <span className="text-xs text-ink-soft">· {v.ddm.suitability}</span></div>
            {[...v.ddm.check.errors, ...v.ddm.check.warnings].map((e, i) => <Callout key={i} tone={v.ddm.check.errors.includes(e) ? "red" : "amber"}>{e}</Callout>)}
            <div className="border-t border-line pt-2" />
            <div className="grid grid-cols-4 gap-2">
              <div><Label hint={`Default: 3-yr average ROE (${v.riInputs.roe?.toFixed(1) ?? "n/a"}%)`}>ROE %</Label><NumberField value={s.riRoe} placeholder={v.riInputs.roe?.toFixed(1)} onChange={(x) => setV({ riRoe: x })} /></div>
              <div><Label hint={`Default: average cash payout (${v.riInputs.payout?.toFixed(0) ?? "n/a"}%)`}>Payout %</Label><NumberField value={s.riPayout} placeholder={v.riInputs.payout?.toFixed(0)} onChange={(x) => setV({ riPayout: x })} /></div>
              <div><Label>Years</Label><NumberField value={s.riYears} step={1} onChange={(x) => x !== null && setV({ riYears: Math.max(1, Math.min(30, Math.round(x))) })} /></div>
              <div><Label>Terminal g %</Label><NumberField value={s.riTerminalGrowth} onChange={(x) => x !== null && setV({ riTerminalGrowth: x })} /></div>
            </div>
            <div>Book value/share B₀ = {v.riInputs.b0 === null ? "—" : `₹${v.riInputs.b0.toFixed(2)}`}; residual income value: <b className="num">{v.ri.value === null ? "—" : `₹${v.ri.value.toFixed(0)}`}</b></div>
            {[...v.ri.check.errors, ...v.ri.check.warnings].map((e, i) => <Callout key={i} tone={v.ri.check.errors.includes(e) ? "red" : "amber"}>{e}</Callout>)}
            <div className="text-[11px] text-ink-soft">RI: V = B₀ + Σ (ROE − kₑ) × Bₜ₋₁ ÷ (1+kₑ)ᵗ + terminal RI. Preferred for banks/NBFCs where FCFF is undefined.</div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Asset-based view" subtitle={v.asset.note} />
        <CardBody className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
          <Stat label="Book value per share" value={v.asset.bvps === null ? "—" : `₹${v.asset.bvps.toFixed(2)}`} sub="Accounting value, not realisable value" />
          <Stat label="Tangible book value per share" value={v.asset.tbvps === null ? "—" : `₹${v.asset.tbvps.toFixed(2)}`} />
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between"><b>Your NAV adjustments (₹ cr)</b><Button size="sm" onClick={() => setV({ navAdjustments: [...s.navAdjustments, { label: "Adjustment", amount: 0 }] })}><Plus className="h-3.5 w-3.5" /> Add</Button></div>
            {s.navAdjustments.map((n, i) => <div key={i} className="flex gap-2"><Input value={n.label} onChange={(e) => setV({ navAdjustments: s.navAdjustments.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /><NumberField className="w-32" value={n.amount} onChange={(x) => setV({ navAdjustments: s.navAdjustments.map((y, j) => (j === i ? { ...y, amount: x ?? 0 } : y)) })} /><Button size="sm" variant="ghost" onClick={() => setV({ navAdjustments: s.navAdjustments.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}
            {v.asset.adjustedNavPerShare !== null && <div>Adjusted NAV per share: <b className="num">₹{v.asset.adjustedNavPerShare.toFixed(2)}</b></div>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Valuation conclusion" subtitle="Methods are NOT averaged automatically: the weighted value uses only the weights you set. Incompatible methods can be excluded with weight 0." />
        <CardBody className="grid gap-5 lg:grid-cols-2">
          <table className="fin w-full text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase text-ink-soft"><th>Method</th><th className="text-right">Value/share</th><th className="text-right">vs price</th><th className="text-right">Weight</th></tr></thead>
            <tbody>
              {v.methods.map((m) => (
                <tr key={m.key} className="border-t border-line">
                  <td className="py-1">{m.label}{(!m.applicable || m.reason) && <div className="text-[11px] text-ink-soft">{!m.applicable ? "Not applicable" : m.reason}</div>}</td>
                  <td className="num text-right">{m.value === null ? "—" : `₹${m.value.toFixed(0)}`}</td>
                  <td className="num text-right">{m.value !== null && price ? `${((m.value / price - 1) * 100).toFixed(0)}%` : "—"}</td>
                  <td className="w-20"><NumberField value={s.methodWeights[m.key] ?? 0} allowEmpty={false} onChange={(x) => setV({ methodWeights: { ...s.methodWeights, [m.key]: Math.max(0, x ?? 0) } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Entered price" value={price ? `₹${price}` : "—"} sub={project.priceDate} />
              <Stat label="Weighted fair value" value={v.weighted === null ? "—" : `₹${v.weighted.toFixed(0)}`} />
              <Stat label="Valuation range" value={v.range.low === null ? "—" : `₹${v.range.low.toFixed(0)} – ₹${v.range.high!.toFixed(0)}`} sub="Weighted methods + DCF conservative/optimistic" />
              <Stat label="Margin of safety" value={fmtNum(v.marginOfSafety, "pct")} sub={`Implied upside ${fmtNum(v.upside, "pct")}`} tone={v.marginOfSafety === null ? undefined : v.marginOfSafety >= 0 ? "pos" : "neg"} />
            </div>
            <div className={cn("rounded-xl border p-3 text-center text-lg font-semibold", v.verdict.startsWith("Potentially under") ? "border-green-300 bg-pos-soft text-pos" : v.verdict.startsWith("Potentially over") ? "border-red-300 bg-neg-soft text-neg" : v.verdict.startsWith("Approx") ? "border-yellow-300 bg-gold-soft text-gold" : "border-line bg-slate-50 text-ink-soft")}>{v.verdict}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><Label>“Undervalued” if margin of safety ≥ (%)</Label><NumberField value={s.undervaluedThreshold} allowEmpty={false} onChange={(x) => x !== null && setV({ undervaluedThreshold: x })} /></div>
              <div><Label>“Overvalued” if price exceeds fair value by ≥ (%)</Label><NumberField value={s.overvaluedThreshold} allowEmpty={false} onChange={(x) => x !== null && setV({ overvaluedThreshold: x })} /></div>
            </div>
            <p className="text-[11px] text-ink-soft">{v.weightNote} Classification is a model output under your assumptions — not a prediction or an investment recommendation.</p>
          </div>
        </CardBody>
      </Card>
      <AiPanel task="valuation" title="AI interpretation of the valuation (optional)" question="valuation assumptions implied growth margin of safety" />
    </div>
  );
}

function Row({ l, r, sub, bold }: { l: string; r: string; sub?: string; bold?: boolean }) {
  return <div className={cn("flex justify-between gap-2", bold && "border-t border-line pt-1 font-semibold")}><span className="text-ink-soft">{l}{sub && <span className="block text-[10px]">{sub}</span>}</span><span className="num">{r}</span></div>;
}
