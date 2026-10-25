// Forensic accounting module: rule-based warning signs, Beneish M-Score and
// Altman Z-Score variants. Language is deliberately cautious — these are
// prompts for investigation, never conclusions of wrongdoing.
import type { AuditFinding, Excerpt, SectorKey } from "../types";
import { isFinancial, type FactView, type MetricUnit } from "./core";
import type { MetricSeries } from "./metrics";
import { cogsOp, ebitOp } from "./metrics";
import { prevFy } from "./derive";

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export interface FlagNumber {
  label: string;
  value: number | null;
  unit: MetricUnit;
  period?: string;
}

export interface RedFlag {
  id: string;
  severity: Severity;
  category: "earnings-quality" | "cash-flow" | "working-capital" | "leverage" | "liquidity" | "audit" | "disclosure" | "model" | "data";
  title: string;
  observation: string;
  numbers: FlagNumber[];
  history: string;
  whyItMatters: string;
  alternatives: string;
  verify: string;
  sources: { docName: string; page?: number; text?: string }[];
  kind: "confirmed-disclosure" | "potential-warning";
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "informational"];

const val = (s: Record<string, MetricSeries>, key: string, p: string | undefined) => (p ? s[key]?.byPeriod[p]?.value ?? null : null);
const hist = (s: Record<string, MetricSeries>, key: string, fys: string[], unit: MetricUnit) =>
  fys
    .map((p) => {
      const v = val(s, key, p);
      return `${p}: ${v === null ? "n/a" : unit === "pct" ? `${v.toFixed(1)}%` : unit === "x" ? `${v.toFixed(2)}x` : unit === "days" ? `${v.toFixed(0)}d` : v.toFixed(0)}`;
    })
    .join(" · ");

export interface ForensicInputs {
  view: FactView;
  fys: string[];
  annual: Record<string, MetricSeries>;
  sector: SectorKey;
  auditFindings: AuditFinding[];
  excerpts: Excerpt[];
  conflicts: { label: string; periodId: string; values: { value: number; docName: string; page?: number }[] }[];
  beneishUseOtherExpensesAsSga: boolean;
  altmanUseOtherEquityAsRetainedEarnings: boolean;
  marketCap: number | null;
}

export function forensicFlags(inp: ForensicInputs): RedFlag[] {
  const { view, fys, annual: m, sector } = inp;
  const flags: RedFlag[] = [];
  const latest = fys[fys.length - 1];
  const prev = fys.length > 1 ? fys[fys.length - 2] : undefined;
  const fin = isFinancial(sector);

  if (!fin && latest) {
    // 1. Cumulative cash conversion
    let sumCfo = 0;
    let sumPat = 0;
    let n = 0;
    for (const p of fys) {
      const c = view.get(p, "cfo")?.value;
      const pat = view.get(p, "pat")?.value;
      if (c != null && pat != null) {
        sumCfo += c;
        sumPat += pat;
        n++;
      }
    }
    if (n >= 2 && sumPat > 0) {
      const r = sumCfo / sumPat;
      if (r < 0.8) {
        flags.push({
          id: "cum-cash-conversion",
          severity: r < 0.5 ? "high" : "medium",
          category: "cash-flow",
          title: "Profits are not fully converting into operating cash",
          observation: `Cumulative operating cash flow over ${n} years is ${(r * 100).toFixed(0)}% of cumulative PAT.`,
          numbers: [
            { label: "Cumulative OCF", value: sumCfo, unit: "cr" },
            { label: "Cumulative PAT", value: sumPat, unit: "cr" },
            { label: "OCF / PAT", value: r, unit: "x" },
          ],
          history: hist(m, "ocfToPat", fys, "x"),
          whyItMatters: "Persistent gaps between accounting profit and cash can indicate aggressive revenue recognition, capitalisation of costs or working-capital stress.",
          alternatives: "Rapid growth (working-capital build-up), large advance tax payments, or timing of customer collections at year-end.",
          verify: "Cash flow statement working-capital lines, trade receivables ageing note, revenue recognition policy.",
          sources: [],
          kind: "potential-warning",
        });
      }
    }
    // 2. Receivables vs revenue
    if (prev) {
      const rg = val(m, "revenueGrowth", latest);
      const recNow = view.get(latest, "tradeReceivables")?.value;
      const recPrev = view.get(prev, "tradeReceivables")?.value;
      if (rg !== null && recNow != null && recPrev != null && recPrev > 0) {
        const recG = (recNow / recPrev - 1) * 100;
        if (recG - rg > 10) {
          const dso = val(m, "receivableDays", latest);
          const dsoPrev = val(m, "receivableDays", prev);
          flags.push({
            id: "receivables-vs-revenue",
            severity: recG - rg > 25 ? "high" : "medium",
            category: "working-capital",
            title: "Receivables growing faster than revenue",
            observation: `Trade receivables grew ${recG.toFixed(1)}% vs revenue growth of ${rg.toFixed(1)}% in ${latest}.`,
            numbers: [
              { label: "Receivables growth", value: recG, unit: "pct", period: latest },
              { label: "Revenue growth", value: rg, unit: "pct", period: latest },
              { label: "Receivable days", value: dso, unit: "days", period: latest },
              { label: "Receivable days (prior)", value: dsoPrev, unit: "days", period: prev },
            ],
            history: hist(m, "receivableDays", fys, "days"),
            whyItMatters: "Slower collections tie up cash and can signal channel stuffing, weaker customers or relaxed credit terms.",
            alternatives: "Year-end sales concentration, a shift to customers with longer terms (e.g. government), or acquisitions consolidated near year-end.",
            verify: "Receivables ageing (> 6 months), expected credit loss allowance, related-party receivables, unbilled revenue.",
            sources: [],
            kind: "potential-warning",
          });
        }
      }
      // 3. Inventory vs revenue
      const invNow = view.get(latest, "inventories")?.value;
      const invPrev = view.get(prev, "inventories")?.value;
      if (rg !== null && invNow != null && invPrev != null && invPrev > 0) {
        const ig = (invNow / invPrev - 1) * 100;
        if (ig - rg > 15) {
          flags.push({
            id: "inventory-vs-revenue",
            severity: "medium",
            category: "working-capital",
            title: "Inventory growing faster than sales",
            observation: `Inventories grew ${ig.toFixed(1)}% vs revenue growth of ${rg.toFixed(1)}% in ${latest}.`,
            numbers: [
              { label: "Inventory growth", value: ig, unit: "pct", period: latest },
              { label: "Revenue growth", value: rg, unit: "pct", period: latest },
              { label: "Inventory days", value: val(m, "inventoryDays", latest), unit: "days", period: latest },
            ],
            history: hist(m, "inventoryDays", fys, "days"),
            whyItMatters: "Inventory build-up can precede write-downs or indicate weakening demand; it also absorbs cash.",
            alternatives: "Planned stocking ahead of capacity ramp-up, commodity price increases, or strategic raw-material buying.",
            verify: "Inventory note (raw material vs finished goods split), write-down disclosures, MD&A commentary on demand.",
            sources: [],
            kind: "potential-warning",
          });
        }
      }
      // Revenue up, OCF down
      const cfoNow = view.get(latest, "cfo")?.value;
      const cfoPrev = view.get(prev, "cfo")?.value;
      if (rg !== null && rg > 5 && cfoNow != null && cfoPrev != null && cfoNow < cfoPrev * 0.85) {
        flags.push({
          id: "revenue-up-ocf-down",
          severity: "medium",
          category: "cash-flow",
          title: "Revenue rose while operating cash flow fell",
          observation: `Revenue grew ${rg.toFixed(1)}% but operating cash flow fell from ₹${cfoPrev.toFixed(0)} cr to ₹${cfoNow.toFixed(0)} cr.`,
          numbers: [
            { label: "Revenue growth", value: rg, unit: "pct", period: latest },
            { label: "OCF", value: cfoNow, unit: "cr", period: latest },
            { label: "OCF (prior)", value: cfoPrev, unit: "cr", period: prev },
          ],
          history: hist(m, "cfo", fys, "cr"),
          whyItMatters: "Growth that consumes cash must be financed and may not be sustainable.",
          alternatives: "Working-capital investment for new capacity or contracts; one-off tax or settlement payments.",
          verify: "Working-capital movements in the cash flow statement and MD&A explanation.",
          sources: [],
          kind: "potential-warning",
        });
      }
    }
    // 4. Other income dependence
    const oi = val(m, "otherIncomeToPbt", latest);
    if (oi !== null && oi > 25) {
      flags.push({
        id: "other-income-dependence",
        severity: oi > 40 ? "high" : "medium",
        category: "earnings-quality",
        title: "Profits rely heavily on other income",
        observation: `Other income equals ${oi.toFixed(1)}% of PBT in ${latest}.`,
        numbers: [{ label: "Other income / PBT", value: oi, unit: "pct", period: latest }],
        history: hist(m, "otherIncomeToPbt", fys, "pct"),
        whyItMatters: "Treasury income, gains on investments or one-off receipts are less durable than operating profit.",
        alternatives: "Large cash balances legitimately earning interest; dividend income from subsidiaries (standalone accounts).",
        verify: "Other income note: composition (interest, dividends, fair-value gains, write-backs, export incentives).",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 5. Exceptional items: size and recurrence
    const excYears = fys.filter((p) => {
      const e = view.get(p, "exceptionalEffect")?.value;
      return e != null && Math.abs(e) > 0.01;
    });
    const excL = val(m, "exceptionalToPbt", latest);
    if ((excL !== null && Math.abs(excL) > 10) || excYears.length >= 2) {
      flags.push({
        id: "exceptional-items",
        severity: excYears.length >= 3 ? "medium" : excL !== null && Math.abs(excL) > 20 ? "medium" : "low",
        category: "earnings-quality",
        title: excYears.length >= 2 ? "Recurring 'exceptional' items" : "Material exceptional item",
        observation: excYears.length >= 2 ? `Exceptional items reported in ${excYears.length} of ${fys.length} years (${excYears.join(", ")}).` : `Exceptional items equal ${excL!.toFixed(1)}% of PBT in ${latest}.`,
        numbers: excYears.map((p) => ({ label: `Exceptional impact ${p}`, value: view.get(p, "exceptionalEffect")?.value ?? null, unit: "cr" as MetricUnit, period: p })),
        history: hist(m, "exceptionalToPbt", fys, "pct"),
        whyItMatters: "Items labelled exceptional are excluded from 'core' profit by many investors; if they recur they are arguably part of normal business.",
        alternatives: "Genuine one-offs (restructuring, impairments, asset sales) can cluster during transformation periods.",
        verify: "Exceptional items note for nature and recurrence; compare with prior years.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 6. Negative FCF
    const fcfs = fys.slice(-3).map((p) => val(m, "fcf", p));
    const negYears = fcfs.filter((x) => x !== null && x < 0).length;
    if (negYears >= 2) {
      const ndNow = val(m, "netDebt", latest);
      const ndFirst = val(m, "netDebt", fys[Math.max(0, fys.length - 3)]);
      const rising = ndNow !== null && ndFirst !== null && ndNow > ndFirst;
      flags.push({
        id: "negative-fcf",
        severity: rising ? "high" : "medium",
        category: "cash-flow",
        title: "Repeated negative free cash flow",
        observation: `Free cash flow was negative in ${negYears} of the last ${fcfs.length} years${rising ? " and net debt increased" : ""}.`,
        numbers: fys.slice(-3).map((p) => ({ label: `FCF ${p}`, value: val(m, "fcf", p), unit: "cr" as MetricUnit, period: p })),
        history: hist(m, "fcf", fys, "cr"),
        whyItMatters: "Persistent cash burn requires external funding (debt or equity) and increases financial risk.",
        alternatives: "A deliberate expansion phase: check whether capex is growth capex with disclosed commissioning timelines.",
        verify: "Capex plans and commissioning status in MD&A; funding plan; CWIP ageing schedule.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 7. Dividends possibly debt-funded
    const fcfL = val(m, "fcf", latest);
    const divL = view.get(latest, "dividendsPaid")?.value;
    const nbL = val(m, "netBorrowing", latest);
    if (fcfL !== null && divL != null && divL > 0 && fcfL < divL && nbL !== null && nbL > 0) {
      flags.push({
        id: "dividends-debt-funded",
        severity: "medium",
        category: "cash-flow",
        title: "Dividends exceeded free cash flow while net borrowing increased",
        observation: `In ${latest}, dividends of ₹${divL.toFixed(0)} cr exceeded FCF of ₹${fcfL.toFixed(0)} cr, while net new borrowing was ₹${nbL.toFixed(0)} cr.`,
        numbers: [
          { label: "Dividends paid", value: divL, unit: "cr", period: latest },
          { label: "Free cash flow", value: fcfL, unit: "cr", period: latest },
          { label: "Net borrowing", value: nbL, unit: "cr", period: latest },
        ],
        history: hist(m, "fcfAfterDividends", fys, "cr"),
        whyItMatters: "Paying dividends from borrowed money is not sustainable and weakens the balance sheet.",
        alternatives: "Cash is fungible: borrowing may finance capex while dividends come from existing cash balances.",
        verify: "Cash flow statement financing section; dividend policy; cash balances at year-end.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 8. Leverage & coverage
    const nde = val(m, "netDebtToEbitda", latest);
    if (nde !== null && nde > 3.5) {
      flags.push({
        id: "high-leverage",
        severity: nde > 5 ? "high" : "medium",
        category: "leverage",
        title: "High leverage relative to EBITDA",
        observation: `Net debt is ${nde.toFixed(1)}x EBITDA in ${latest}.`,
        numbers: [{ label: "Net debt / EBITDA", value: nde, unit: "x", period: latest }, { label: "Net debt", value: val(m, "netDebt", latest), unit: "cr", period: latest }],
        history: hist(m, "netDebtToEbitda", fys, "x"),
        whyItMatters: "High leverage reduces flexibility and magnifies the impact of an earnings downturn.",
        alternatives: "Utilities and infrastructure assets with regulated, contracted cash flows can sustain higher leverage; projects under construction have debt before EBITDA.",
        verify: "Debt maturity profile, covenants, credit rating, interest rate mix and project commissioning timelines.",
        sources: [],
        kind: "potential-warning",
      });
    }
    const ic = val(m, "interestCoverage", latest);
    if (ic !== null && ic < 2) {
      flags.push({
        id: "weak-coverage",
        severity: ic < 1.5 ? "critical" : "high",
        category: "leverage",
        title: "Weak interest coverage",
        observation: `PBIT covers finance costs only ${ic.toFixed(2)}x in ${latest}.`,
        numbers: [{ label: "Interest coverage", value: ic, unit: "x", period: latest }],
        history: hist(m, "interestCoverage", fys, "x"),
        whyItMatters: "Low coverage leaves little room before earnings fail to cover interest — a classic distress indicator.",
        alternatives: "Temporary earnings dip in a cyclical trough; capitalised interest on projects not yet earning.",
        verify: "Finance cost note, capitalised borrowing costs, debt restructuring disclosures.",
        sources: [],
        kind: "potential-warning",
      });
    }
    const de = val(m, "debtToEquity", latest);
    const dePrev = val(m, "debtToEquity", prev);
    if (de !== null && dePrev !== null && de - dePrev > 0.3) {
      flags.push({
        id: "rising-leverage",
        severity: "medium",
        category: "leverage",
        title: "Leverage rising quickly",
        observation: `Debt/equity rose from ${dePrev.toFixed(2)}x to ${de.toFixed(2)}x.`,
        numbers: [{ label: "Debt/equity", value: de, unit: "x", period: latest }, { label: "Debt/equity (prior)", value: dePrev, unit: "x", period: prev }],
        history: hist(m, "debtToEquity", fys, "x"),
        whyItMatters: "Rapid increases in leverage raise refinancing and solvency risk.",
        alternatives: "Debt-funded acquisition or capex with clear payback; temporary bridge financing.",
        verify: "Purpose of new borrowings (MD&A, board's report), repayment schedule.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 9. Liquidity / refinancing
    const cr = val(m, "currentRatio", latest);
    const sts = val(m, "shortTermDebtShare", latest);
    if (cr !== null && cr < 1) {
      flags.push({
        id: "weak-liquidity",
        severity: cr < 0.8 ? "high" : "medium",
        category: "liquidity",
        title: "Current liabilities exceed current assets",
        observation: `Current ratio of ${cr.toFixed(2)}x in ${latest}${sts !== null ? `; ${sts.toFixed(0)}% of borrowings are short-term` : ""}.`,
        numbers: [{ label: "Current ratio", value: cr, unit: "x", period: latest }, { label: "Short-term share of debt", value: sts, unit: "pct", period: latest }],
        history: hist(m, "currentRatio", fys, "x"),
        whyItMatters: "Short-term obligations may need refinancing or operating cash to be met on time.",
        alternatives: "Businesses with negative working capital (FMCG, retail, telecom) routinely run current ratios below 1.",
        verify: "Liquidity discussion, undrawn credit lines, maturity profile.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 10. Intangibles
    const eq = view.get(latest, "totalEquity")?.value;
    const gw = (view.get(latest, "goodwill")?.value ?? 0) + (view.get(latest, "intangibles")?.value ?? 0);
    if (eq != null && eq > 0 && gw / eq > 0.3) {
      flags.push({
        id: "intangibles-heavy",
        severity: "medium",
        category: "earnings-quality",
        title: "Goodwill and intangibles are large relative to equity",
        observation: `Goodwill + intangibles are ${((gw / eq) * 100).toFixed(0)}% of equity in ${latest}.`,
        numbers: [{ label: "Goodwill + intangibles", value: gw, unit: "cr", period: latest }, { label: "Equity", value: eq, unit: "cr", period: latest }],
        history: hist(m, "intangiblesToAssets", fys, "pct"),
        whyItMatters: "Impairments can wipe out book value; acquisition accounting involves judgement.",
        alternatives: "Brand-led or acquisitive businesses legitimately carry intangibles.",
        verify: "Impairment testing note (assumptions, headroom), acquisition history.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 11. Depreciation rate drop
    const dr = val(m, "depreciationRate", latest);
    const drPrev = val(m, "depreciationRate", prev);
    if (dr !== null && drPrev !== null && drPrev > 0 && dr < drPrev * 0.8) {
      flags.push({
        id: "depreciation-drop",
        severity: "low",
        category: "earnings-quality",
        title: "Depreciation rate fell noticeably",
        observation: `D&A relative to average net PPE fell from ${drPrev.toFixed(1)}% to ${dr.toFixed(1)}%.`,
        numbers: [{ label: "Depreciation rate", value: dr, unit: "pct", period: latest }, { label: "Prior", value: drPrev, unit: "pct", period: prev }],
        history: hist(m, "depreciationRate", fys, "pct"),
        whyItMatters: "Extending useful lives or changing methods boosts reported profit without improving cash flow.",
        alternatives: "Large new assets capitalised late in the year (low first-year charge) or assets fully depreciated.",
        verify: "Accounting policy note on useful lives; any change in estimates disclosure.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 12. Accruals
    const acc = val(m, "accrualsRatio", latest);
    if (acc !== null && acc > 10) {
      flags.push({
        id: "high-accruals",
        severity: "medium",
        category: "earnings-quality",
        title: "High accruals",
        observation: `PAT exceeded operating cash flow by ${acc.toFixed(1)}% of average assets in ${latest}.`,
        numbers: [{ label: "Accruals ratio", value: acc, unit: "pct", period: latest }],
        history: hist(m, "accrualsRatio", fys, "pct"),
        whyItMatters: "Research links high accruals to lower future earnings persistence.",
        alternatives: "Working-capital build during rapid growth.",
        verify: "Working-capital changes and revenue recognition notes.",
        sources: [],
        kind: "potential-warning",
      });
    }
    // 13. Tax rate anomalies
    const etr = val(m, "effectiveTaxRate", latest);
    const etrPrev = val(m, "effectiveTaxRate", prev);
    if (etr !== null && (etr < 15 || (etrPrev !== null && Math.abs(etr - etrPrev) > 10))) {
      flags.push({
        id: "tax-rate",
        severity: "low",
        category: "earnings-quality",
        title: "Unusual or volatile effective tax rate",
        observation: `Effective tax rate of ${etr.toFixed(1)}% in ${latest}${etrPrev !== null ? ` (prior ${etrPrev.toFixed(1)}%)` : ""}.`,
        numbers: [{ label: "Effective tax rate", value: etr, unit: "pct", period: latest }],
        history: hist(m, "effectiveTaxRate", fys, "pct"),
        whyItMatters: "Low or swinging tax rates may reflect one-off benefits that will not recur.",
        alternatives: "Tax holidays (SEZ/80-IA), transition to the new tax regime, deferred tax remeasurement, MAT credit.",
        verify: "Tax expense reconciliation note.",
        sources: [],
        kind: "potential-warning",
      });
    }
  }

  // Auditor findings (confirmed disclosures)
  for (const a of inp.auditFindings) {
    const sev: Severity = a.severity === "informational" ? "informational" : a.severity;
    flags.push({
      id: `audit-${a.key}-${a.docId}`,
      severity: sev,
      category: "audit",
      title: a.title + (a.fy ? ` (FY${a.fy - 1}-${String(a.fy).slice(2)})` : ""),
      observation: `Detected in ${a.docName}, page ${a.page}.`,
      numbers: [],
      history: "",
      whyItMatters:
        a.key === "kam"
          ? "Key audit matters show where auditors applied the most judgement; they are not modifications of the opinion."
          : a.key === "eom"
            ? "An emphasis of matter does not modify the opinion but highlights an issue the auditor considers fundamental to understanding the accounts."
            : "Auditor modifications and control weaknesses directly affect reliance on the reported numbers.",
      alternatives: a.key === "kam" ? "Routine — most listed companies report KAMs." : "Read the full paragraph: matters can be technical or already resolved.",
      verify: "Read the full auditor's report paragraph and the referenced note.",
      sources: [{ docName: a.docName, page: a.page, text: a.text }],
      kind: "confirmed-disclosure",
    });
  }
  // Related party disclosures (informational, with pages)
  const rpt = inp.excerpts.filter((e) => e.category === "related-party").slice(0, 3);
  if (rpt.length) {
    flags.push({
      id: "rpt-review",
      severity: "informational",
      category: "disclosure",
      title: "Related-party transactions disclosed — review materiality",
      observation: `${inp.excerpts.filter((e) => e.category === "related-party").length} related-party passages found.`,
      numbers: [],
      history: "",
      whyItMatters: "Material related-party transactions can transfer value away from minority shareholders.",
      alternatives: "Most groups have routine, arm's-length related-party transactions.",
      verify: "Related-party note: amounts, nature, outstanding balances, approvals; compare with revenue and net worth.",
      sources: rpt.map((e) => ({ docName: e.docName, page: e.page, text: e.text })),
      kind: "confirmed-disclosure",
    });
  }
  const cont = view.get(latest ?? "", "contingentLiabilities")?.value;
  const eqL = view.get(latest ?? "", "totalEquity")?.value;
  if (cont != null && eqL != null && eqL > 0 && cont / eqL > 0.2) {
    flags.push({
      id: "contingent-large",
      severity: cont / eqL > 0.5 ? "high" : "medium",
      category: "disclosure",
      title: "Large contingent liabilities relative to net worth",
      observation: `Contingent liabilities of ₹${cont.toFixed(0)} cr equal ${((cont / eqL) * 100).toFixed(0)}% of equity.`,
      numbers: [{ label: "Contingent liabilities", value: cont, unit: "cr", period: latest }],
      history: "",
      whyItMatters: "Adverse outcomes of disputes would hit profit and cash.",
      alternatives: "Many tax demands in India are routinely disputed and often reduced on appeal.",
      verify: "Contingent liabilities note: nature, forum, management's assessment.",
      sources: [],
      kind: "potential-warning",
    });
  } else {
    const ce = inp.excerpts.filter((e) => e.category === "contingent").slice(0, 2);
    if (ce.length)
      flags.push({
        id: "contingent-review",
        severity: "informational",
        category: "disclosure",
        title: "Contingent liabilities disclosed (amount not captured)",
        observation: "Contingent liability disclosures were found; enter the total in Data Review to size them against net worth.",
        numbers: [],
        history: "",
        whyItMatters: "Unprovided claims could crystallise into losses.",
        alternatives: "Often routine tax and legal disputes.",
        verify: "Contingent liabilities note.",
        sources: ce.map((e) => ({ docName: e.docName, page: e.page, text: e.text })),
        kind: "confirmed-disclosure",
      });
  }
  // Conflicting values between documents (possible restatements)
  const restate = inp.conflicts.filter((c) => c.periodId.startsWith("FY")).slice(0, 8);
  if (restate.length) {
    flags.push({
      id: "restatements",
      severity: "medium",
      category: "data",
      title: "Figures differ between documents (possible restatement or regrouping)",
      observation: `${inp.conflicts.length} value(s) differ across uploaded documents.`,
      numbers: restate.map((c) => ({ label: `${c.label} ${c.periodId}`, value: c.values[0]?.value ?? null, unit: "cr" as MetricUnit, period: c.periodId })),
      history: restate.map((c) => `${c.label} ${c.periodId}: ${c.values.map((v) => `${v.value.toFixed(2)} (${v.docName}${v.page ? ` p${v.page}` : ""})`).join(" vs ")}`).join(" | "),
      whyItMatters: "Restated comparatives can change trends; large restatements may indicate errors in prior reporting.",
      alternatives: "Routine regrouping, Ind AS transitions, discontinued operations, or extraction errors in one document.",
      verify: "Notes on restatement/regrouping in the later report; check extraction on the Data Quality page.",
      sources: restate.flatMap((c) => c.values.map((v) => ({ docName: v.docName, page: v.page }))).slice(0, 6),
      kind: "potential-warning",
    });
  }
  return flags.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

// ---------------- Beneish M-Score ----------------
export interface ModelResult {
  name: string;
  applicable: boolean;
  computed: boolean;
  value: number | null;
  period?: string;
  zone?: string;
  inputs: { label: string; value: number | null }[];
  components: { label: string; value: number | null; weight?: number }[];
  formula: string;
  limitations: string[];
  missing: string[];
  interpretation: string;
}

export function beneish(view: FactView, fys: string[], sector: SectorKey, useOtherExpAsSga: boolean): ModelResult {
  const base: ModelResult = {
    name: "Beneish M-Score (8-variable)",
    applicable: !isFinancial(sector),
    computed: false,
    value: null,
    inputs: [],
    components: [],
    formula: "M = −4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI",
    limitations: [
      "Estimated on US manufacturing firms (1982–1992); thresholds may not transfer to Indian companies.",
      "A high score is a statistical signal of earnings-manipulation risk, not evidence of fraud.",
      "High growth alone raises SGI and can push the score up.",
    ],
    missing: [],
    interpretation: "",
  };
  if (!base.applicable) return { ...base, interpretation: "Not applicable to financial institutions." };
  const t = fys[fys.length - 1];
  if (!t) return { ...base, interpretation: "No annual data." };
  const p = prevFy(t);
  const g = (pid: string, k: string) => view.get(pid, k)?.value ?? null;
  const sga = (pid: string) => g(pid, "sgaExpense") ?? (useOtherExpAsSga ? g(pid, "otherExpenses") : null);
  const req: [string, string, number | null][] = [];
  const add = (label: string, pid: string, v: number | null) => {
    req.push([label, pid, v]);
    return v;
  };
  const S = add("Revenue", t, g(t, "revenue")), S0 = add("Revenue", p, g(p, "revenue"));
  const REC = add("Trade receivables", t, g(t, "tradeReceivables")), REC0 = add("Trade receivables", p, g(p, "tradeReceivables"));
  const C = add("COGS", t, cogsOp(view, t).value), C0 = add("COGS", p, cogsOp(view, p).value);
  const CA = add("Current assets", t, g(t, "totalCurrentAssets")), CA0 = add("Current assets", p, g(p, "totalCurrentAssets"));
  const PPE = add("Net PPE", t, g(t, "ppe")), PPE0 = add("Net PPE", p, g(p, "ppe"));
  const INV = (pid: string) => {
    const a = g(pid, "nonCurrentInvestments");
    const b = g(pid, "currentInvestments");
    return a === null || b === null ? null : a + b;
  };
  const SEC = add("Investments (securities)", t, INV(t)), SEC0 = add("Investments (securities)", p, INV(p));
  const TA = add("Total assets", t, g(t, "totalAssets")), TA0 = add("Total assets", p, g(p, "totalAssets"));
  const DEP = add("Depreciation", t, g(t, "depreciation")), DEP0 = add("Depreciation", p, g(p, "depreciation"));
  const SG = add(useOtherExpAsSga ? "SG&A (proxy: other expenses)" : "SG&A expense", t, sga(t)), SG0 = add(useOtherExpAsSga ? "SG&A (proxy: other expenses)" : "SG&A expense", p, sga(p));
  const CL = add("Current liabilities", t, g(t, "totalCurrentLiabilities")), CL0 = add("Current liabilities", p, g(p, "totalCurrentLiabilities"));
  const LTD = add("Long-term debt", t, g(t, "longTermBorrowings")), LTD0 = add("Long-term debt", p, g(p, "longTermBorrowings"));
  const NI = add("PAT (continuing)", t, g(t, "pat"));
  const CFO = add("Operating cash flow", t, g(t, "cfo"));
  base.inputs = req.map(([l, pid, v]) => ({ label: `${l} (${pid})`, value: v }));
  base.period = t;
  const missing = req.filter((r) => r[2] === null).map((r) => `${r[0]} (${r[1]})`);
  if (missing.length) return { ...base, missing, interpretation: `Not calculated — missing inputs: ${missing.join(", ")}. The model is not computed with substituted values.${!useOtherExpAsSga && !g(t, "sgaExpense") ? " Indian P&Ls rarely show SG&A separately: enter it in Data Review, or enable the disclosed 'other expenses' proxy in Settings." : ""}` };
  const n = (x: number | null) => x as number;
  const gm = (s: number, c: number) => (s - c) / s;
  const DSRI = n(REC) / n(S) / (n(REC0) / n(S0));
  const GMI = gm(n(S0), n(C0)) / gm(n(S), n(C));
  const AQI = (1 - (n(CA) + n(PPE) + n(SEC)) / n(TA)) / (1 - (n(CA0) + n(PPE0) + n(SEC0)) / n(TA0));
  const SGI = n(S) / n(S0);
  const DEPI = n(DEP0) / (n(DEP0) + n(PPE0)) / (n(DEP) / (n(DEP) + n(PPE)));
  const SGAI = n(SG) / n(S) / (n(SG0) / n(S0));
  const LVGI = (n(CL) + n(LTD)) / n(TA) / ((n(CL0) + n(LTD0)) / n(TA0));
  const TATA = (n(NI) - n(CFO)) / n(TA);
  const comps = [
    { label: "DSRI (receivables index)", value: DSRI, weight: 0.92 },
    { label: "GMI (gross margin index)", value: GMI, weight: 0.528 },
    { label: "AQI (asset quality index)", value: AQI, weight: 0.404 },
    { label: "SGI (sales growth index)", value: SGI, weight: 0.892 },
    { label: "DEPI (depreciation index)", value: DEPI, weight: 0.115 },
    { label: "SGAI (SG&A index)", value: SGAI, weight: -0.172 },
    { label: "TATA (total accruals / assets)", value: TATA, weight: 4.679 },
    { label: "LVGI (leverage index)", value: LVGI, weight: -0.327 },
  ];
  if (comps.some((c) => !Number.isFinite(c.value))) return { ...base, components: comps, interpretation: "Not calculated — a component is undefined (division by zero in the inputs)." };
  const M = -4.84 + comps.reduce((s, c) => s + c.value * c.weight, 0);
  const limitations = useOtherExpAsSga ? [...base.limitations, "SG&A proxied by 'other expenses' (user-enabled) — includes non-SG&A costs."] : base.limitations;
  return {
    ...base,
    computed: true,
    value: M,
    components: comps,
    limitations,
    zone: M > -1.78 ? "Above −1.78 threshold" : "Below −1.78 threshold",
    interpretation:
      M > -1.78
        ? `M-Score of ${M.toFixed(2)} is above −1.78: statistically associated with higher manipulation risk in the original study. Treat as a prompt to examine receivables, margins and accruals — not as proof.`
        : `M-Score of ${M.toFixed(2)} is below −1.78: no statistical warning signal from this model.`,
  };
}

// ---------------- Altman Z ----------------
export function altman(view: FactView, fys: string[], sector: SectorKey, marketCap: number | null, useOtherEquityAsRE: boolean): ModelResult[] {
  const t = fys[fys.length - 1];
  const res: ModelResult[] = [];
  const notApplicable = isFinancial(sector);
  const g = (k: string) => (t ? view.get(t, k)?.value ?? null : null);
  const TA = g("totalAssets");
  const WC = g("totalCurrentAssets") !== null && g("totalCurrentLiabilities") !== null ? (g("totalCurrentAssets") as number) - (g("totalCurrentLiabilities") as number) : null;
  const RE = g("retainedEarnings") ?? (useOtherEquityAsRE ? g("otherEquity") : null);
  const EBIT = t ? ebitOp(view, t).value : null;
  const TL = g("totalLiabilities");
  const BE = g("totalEquity");
  const S = g("revenue");
  const reLabel = g("retainedEarnings") !== null ? "Retained earnings" : useOtherEquityAsRE ? "Retained earnings (proxy: other equity)" : "Retained earnings";
  const common = { limitations: ["Developed on US firms; zone cut-offs are indicative only for Indian companies.", "Uses book values from the latest annual balance sheet."], components: [] as ModelResult["components"] };

  // Z'' (emerging market / non-manufacturer)
  {
    const inputs = [
      { label: "Working capital", value: WC },
      { label: reLabel, value: RE },
      { label: "EBIT (operating)", value: EBIT },
      { label: "Book equity", value: BE },
      { label: "Total liabilities", value: TL },
      { label: "Total assets", value: TA },
    ];
    const missing = inputs.filter((i) => i.value === null).map((i) => i.label);
    const r: ModelResult = {
      name: "Altman Z''-Score (emerging markets / non-manufacturers)",
      applicable: !notApplicable,
      computed: false,
      value: null,
      period: t,
      inputs,
      formula: "Z'' = 6.56·(WC/TA) + 3.26·(RE/TA) + 6.72·(EBIT/TA) + 1.05·(Book equity/TL)",
      missing,
      interpretation: "",
      ...common,
    };
    if (notApplicable) r.interpretation = "Not applicable to banks, NBFCs and insurers.";
    else if (missing.length || !TA || !TL) r.interpretation = `Not calculated — missing: ${missing.join(", ") || "non-zero assets/liabilities"}.${RE === null ? " Retained earnings are rarely shown on the face of Indian balance sheets: enter them in Data Review or enable the disclosed 'other equity' proxy in Settings." : ""}`;
    else {
      const x = [WC! / TA, RE! / TA, EBIT! / TA, BE! / TL];
      const z = 6.56 * x[0] + 3.26 * x[1] + 6.72 * x[2] + 1.05 * x[3];
      r.computed = true;
      r.value = z;
      r.components = [
        { label: "WC / TA", value: x[0], weight: 6.56 },
        { label: "RE / TA", value: x[1], weight: 3.26 },
        { label: "EBIT / TA", value: x[2], weight: 6.72 },
        { label: "Book equity / TL", value: x[3], weight: 1.05 },
      ];
      r.zone = z > 2.6 ? "Safe zone (> 2.6)" : z >= 1.1 ? "Grey zone (1.1–2.6)" : "Distress zone (< 1.1)";
      r.interpretation = `Z'' of ${z.toFixed(2)} — ${r.zone}. ${useOtherEquityAsRE && g("retainedEarnings") === null ? "Other equity used as retained-earnings proxy (includes securities premium and other reserves), which overstates RE." : ""}`;
    }
    res.push(r);
  }
  // Original Z (public manufacturers) – needs market value of equity
  {
    const inputs = [
      { label: "Working capital", value: WC },
      { label: reLabel, value: RE },
      { label: "EBIT (operating)", value: EBIT },
      { label: "Market value of equity (current price × shares)", value: marketCap },
      { label: "Total liabilities", value: TL },
      { label: "Revenue", value: S },
      { label: "Total assets", value: TA },
    ];
    const missing = inputs.filter((i) => i.value === null).map((i) => i.label);
    const manuf = ["manufacturing", "metals", "auto", "pharma", "fmcg", "energy", "general"].includes(sector);
    const r: ModelResult = {
      name: "Altman Z-Score (original, public manufacturers)",
      applicable: !notApplicable && manuf,
      computed: false,
      value: null,
      period: t,
      inputs,
      formula: "Z = 1.2·(WC/TA) + 1.4·(RE/TA) + 3.3·(EBIT/TA) + 0.6·(MV equity/TL) + 1.0·(Sales/TA)",
      missing,
      interpretation: "",
      ...common,
      limitations: [...common.limitations, "Market value uses today's user-entered price against the latest balance sheet (timing mismatch)."],
    };
    if (!r.applicable) r.interpretation = notApplicable ? "Not applicable to financial institutions." : "Original model is calibrated for manufacturers; use Z'' for this sector.";
    else if (missing.length || !TA || !TL) r.interpretation = `Not calculated — missing: ${missing.join(", ")}.`;
    else {
      const x = [WC! / TA, RE! / TA, EBIT! / TA, marketCap! / TL, S! / TA];
      const z = 1.2 * x[0] + 1.4 * x[1] + 3.3 * x[2] + 0.6 * x[3] + 1.0 * x[4];
      r.computed = true;
      r.value = z;
      r.components = [
        { label: "WC / TA", value: x[0], weight: 1.2 },
        { label: "RE / TA", value: x[1], weight: 1.4 },
        { label: "EBIT / TA", value: x[2], weight: 3.3 },
        { label: "MV equity / TL", value: x[3], weight: 0.6 },
        { label: "Sales / TA", value: x[4], weight: 1.0 },
      ];
      r.zone = z > 2.99 ? "Safe zone (> 2.99)" : z >= 1.81 ? "Grey zone (1.81–2.99)" : "Distress zone (< 1.81)";
      r.interpretation = `Z of ${z.toFixed(2)} — ${r.zone}.`;
    }
    res.push(r);
  }
  return res;
}
