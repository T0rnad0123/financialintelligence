// Project factory and defaults.
import type { Project, SectorKey } from "./types";
import { defaultValuationSettings } from "./engine/valuation";
import { emptyFactStore } from "./engine/merge";
import { SECTOR_PROFILES } from "./sector/profiles";

export function uid(prefix = "id"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${r}`;
}

export function newProject(input: { name: string; sector: SectorKey; nseSymbol?: string; bseCode?: string; preferredBasis?: "consolidated" | "standalone"; fyEndMonth?: number; price?: number | null; priceDate?: string; sharesOutstanding?: number | null; dilutedShares?: number | null; notes?: string }): Project {
  const now = Date.now();
  const basis = input.preferredBasis ?? "consolidated";
  return {
    id: uid("prj"),
    name: input.name.trim(),
    nseSymbol: input.nseSymbol?.trim().toUpperCase() || undefined,
    bseCode: input.bseCode?.trim() || undefined,
    sector: input.sector,
    currency: "INR",
    fyEndMonth: input.fyEndMonth ?? 3,
    preferredBasis: basis,
    price: input.price ?? null,
    priceDate: input.priceDate,
    sharesOutstanding: input.sharesOutstanding ?? null,
    dilutedShares: input.dilutedShares ?? null,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    facts: emptyFactStore(),
    segments: [],
    excerpts: [],
    strategy: [],
    guidance: [],
    aiOutputs: [],
    settings: {
      scoreWeights: { ...SECTOR_PROFILES[input.sector].weights },
      beneishUseOtherExpensesAsSga: false,
      altmanUseOtherEquityAsRetainedEarnings: false,
      valuation: defaultValuationSettings(),
      projection: { interestRateOnDebt: null, netBorrowingPctRevenue: 0, payoutRatio: null, useFcfToRepayDebt: true },
    },
    ui: { basis, quarterCount: 16 },
  };
}

/** Fill settings added in newer versions so older saved projects keep working. */
export function migrateProject(p: Project): Project {
  const d = newProject({ name: p.name || "Untitled", sector: p.sector || "general" });
  return {
    ...d,
    ...p,
    settings: {
      ...d.settings,
      ...p.settings,
      valuation: { ...d.settings.valuation, ...(p.settings?.valuation ?? {}), methodWeights: { ...d.settings.valuation.methodWeights, ...(p.settings?.valuation?.methodWeights ?? {}) } },
      projection: { ...d.settings.projection, ...(p.settings?.projection ?? {}) },
      scoreWeights: { ...d.settings.scoreWeights, ...(p.settings?.scoreWeights ?? {}) },
    },
    ui: { ...d.ui, ...(p.ui ?? {}) },
    facts: p.facts ?? d.facts,
  };
}
