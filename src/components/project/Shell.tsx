"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, BadgeIndianRupee, BarChart3, BookOpen, Bot, Building2, CalendarRange, ChevronLeft, ChevronRight, ClipboardCheck, Coins, FileText,
  Gauge, Landmark, Layers, LineChart, PieChart, Scale, Search, Settings, ShieldAlert, Target, TrendingUp, Upload, Wallet, Waves,
} from "lucide-react";
import { useProject } from "./ProjectProvider";
import { Badge, cn, Select } from "../ui";
import { SECTOR_PROFILES } from "@/lib/sector/profiles";

export const NAV: { group: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  { group: "Project", items: [
    { href: "", label: "Executive summary", icon: <Gauge className="h-4 w-4" /> },
    { href: "documents", label: "Document centre", icon: <Upload className="h-4 w-4" /> },
    { href: "data", label: "Data review", icon: <ClipboardCheck className="h-4 w-4" /> },
    { href: "data-quality", label: "Data quality", icon: <Search className="h-4 w-4" /> },
  ] },
  { group: "Financial analysis", items: [
    { href: "revenue", label: "Revenue & growth", icon: <TrendingUp className="h-4 w-4" /> },
    { href: "profitability", label: "Profitability", icon: <BarChart3 className="h-4 w-4" /> },
    { href: "balance-sheet", label: "Balance sheet", icon: <Scale className="h-4 w-4" /> },
    { href: "cash-flow", label: "Cash flow", icon: <Waves className="h-4 w-4" /> },
    { href: "working-capital", label: "Working capital", icon: <Activity className="h-4 w-4" /> },
    { href: "returns", label: "Returns & efficiency", icon: <Target className="h-4 w-4" /> },
    { href: "quarterly", label: "Quarterly", icon: <CalendarRange className="h-4 w-4" /> },
    { href: "segments", label: "Segments", icon: <PieChart className="h-4 w-4" /> },
    { href: "sector", label: "Sector lens", icon: <Building2 className="h-4 w-4" /> },
  ] },
  { group: "Judgement", items: [
    { href: "forensics", label: "Earnings quality", icon: <ShieldAlert className="h-4 w-4" /> },
    { href: "management", label: "Management & strategy", icon: <Landmark className="h-4 w-4" /> },
    { href: "capital-allocation", label: "Capital allocation", icon: <Coins className="h-4 w-4" /> },
    { href: "risk", label: "Risk dashboard", icon: <AlertTriangle className="h-4 w-4" /> },
  ] },
  { group: "Valuation", items: [
    { href: "valuation", label: "Valuation", icon: <BadgeIndianRupee className="h-4 w-4" /> },
    { href: "projections", label: "Projections", icon: <LineChart className="h-4 w-4" /> },
  ] },
  { group: "Output", items: [
    { href: "chat", label: "AI analyst chat", icon: <Bot className="h-4 w-4" /> },
    { href: "report", label: "Report & export", icon: <FileText className="h-4 w-4" /> },
    { href: "settings", label: "Settings & methods", icon: <Settings className="h-4 w-4" /> },
  ] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { project, analysis, update, saving, ai, docs } = useProject();
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  const base = `/projects/${project.id}`;
  const active = (href: string) => (href === "" ? path === base || path === `${base}/` : path.startsWith(`${base}/${href}`));
  const processing = docs.some((d) => d.status === "processing" || d.status === "uploading");
  return (
    <div className="flex min-h-screen">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-white md:flex", collapsed ? "w-14" : "w-60")}>
        <div className="flex items-center justify-between border-b border-line px-3 py-3">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-brand" />
              <span className="text-sm font-semibold leading-tight">Financial Intelligence Lab</span>
            </Link>
          )}
          <button aria-label="Toggle sidebar" onClick={() => setCollapsed((c) => !c)} className="rounded p-1 text-ink-soft hover:bg-slate-100">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
          {NAV.map((g) => (
            <div key={g.group} className="mb-2">
              {!collapsed && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>}
              {g.items.map((it) => (
                <Link key={it.href} href={it.href ? `${base}/${it.href}` : base} title={it.label} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]", active(it.href) ? "bg-brand-soft font-medium text-brand" : "text-ink-soft hover:bg-slate-50 hover:text-ink")}>
                  {it.icon}
                  {!collapsed && it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {!collapsed && <div className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">Data stays in this browser. <Link className="underline" href="/privacy">Privacy</Link></div>}
      </aside>
      <div className="min-w-0 flex-1">
        <header className="app-header sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link href="/" className="text-xs text-ink-soft hover:underline md:hidden">Projects</Link>
                <span className="truncate text-[15px] font-semibold">{project.name}</span>
                {project.nseSymbol && <Badge tone="blue">NSE: {project.nseSymbol}</Badge>}
                {project.bseCode && <Badge tone="slate">BSE: {project.bseCode}</Badge>}
              </div>
              <div className="text-[11px] text-ink-soft">
                {SECTOR_PROFILES[project.sector].label} · {analysis.fys.length} FY · {analysis.quarters.length} quarters · {docs.length} documents
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs no-print">
              <label className="flex items-center gap-1 text-ink-soft">
                Basis
                <Select value={project.ui.basis} onChange={(v) => update((p) => ({ ...p, ui: { ...p.ui, basis: v as "consolidated" | "standalone" } }))} options={[{ value: "consolidated", label: "Consolidated" }, { value: "standalone", label: "Standalone" }]} />
              </label>
              {analysis.fys.length > 1 && (
                <label className="flex items-center gap-1 text-ink-soft">
                  FY
                  <Select value={project.ui.fyFrom ?? analysis.fys[0]} onChange={(v) => update((p) => ({ ...p, ui: { ...p.ui, fyFrom: v } }))} options={analysis.fys.map((f) => ({ value: f, label: f }))} />
                  →
                  <Select value={project.ui.fyTo ?? analysis.fys[analysis.fys.length - 1]} onChange={(v) => update((p) => ({ ...p, ui: { ...p.ui, fyTo: v } }))} options={analysis.fys.map((f) => ({ value: f, label: f }))} />
                </label>
              )}
              <Link href={`${base}/valuation`} className="rounded-lg border border-line px-2 py-1 hover:border-brand">
                Price: {project.price ? <b className="num">₹{project.price.toLocaleString("en-IN")}</b> : <span className="text-warn">not entered</span>}
              </Link>
              <Badge tone={ai?.configured ? "green" : "slate"} title={ai?.configured ? `AI: ${ai.provider} (${ai.model})` : "No AI key configured on the server — deterministic mode"}>
                <Bot className="h-3 w-3" /> {ai?.configured ? "AI on" : "AI off"}
              </Badge>
              {processing && <Badge tone="amber">Processing…</Badge>}
              <span className="w-12 text-[11px] text-ink-soft">{saving ? "Saving…" : "Saved"}</span>
            </div>
          </div>
          <nav className="scroll-thin flex gap-1 overflow-x-auto px-2 pb-2 md:hidden">
            {NAV.flatMap((g) => g.items).map((it) => (
              <Link key={it.href} href={it.href ? `${base}/${it.href}` : base} className={cn("whitespace-nowrap rounded-md px-2 py-1 text-xs", active(it.href) ? "bg-brand text-white" : "bg-slate-100 text-ink-soft")}>
                {it.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function useBase() {
  const { project } = useProject();
  return `/projects/${project.id}`;
}

export { BookOpen, Wallet };
