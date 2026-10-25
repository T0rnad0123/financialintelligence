"use client";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Info, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export const cn = (...a: (string | false | null | undefined)[]) => twMerge(clsx(a));

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(15,27,51,0.04)] print-avoid", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, right, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2 no-print">{right}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

type BadgeTone = "neutral" | "blue" | "green" | "red" | "amber" | "gold" | "slate" | "purple";
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  slate: "bg-slate-50 text-slate-600 border-slate-200",
  blue: "bg-brand-soft text-brand border-blue-200",
  green: "bg-pos-soft text-pos border-green-200",
  red: "bg-neg-soft text-neg border-red-200",
  amber: "bg-warn-soft text-warn border-amber-200",
  gold: "bg-gold-soft text-gold border-yellow-200",
  purple: "bg-violet-50 text-violet-700 border-violet-200",
};

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: BadgeTone; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function severityTone(s: string): BadgeTone {
  return s === "critical" ? "red" : s === "high" ? "red" : s === "medium" ? "amber" : s === "low" ? "blue" : s === "informational" ? "slate" : "neutral";
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export function Button({ children, onClick, variant = "secondary", disabled, className, type = "button", title, size = "md", loading }: { children: ReactNode; onClick?: () => void; variant?: BtnVariant; disabled?: boolean; className?: string; type?: "button" | "submit"; title?: string; size?: "sm" | "md"; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-brand text-white hover:bg-blue-800 border-brand",
    secondary: "bg-white text-ink hover:bg-slate-50 border-line",
    ghost: "bg-transparent text-ink-soft hover:bg-slate-100 border-transparent",
    danger: "bg-white text-neg hover:bg-neg-soft border-red-200",
    gold: "bg-gold text-white hover:bg-yellow-800 border-gold",
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || loading} className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm", v[variant], className)}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-soft">
      {children}
      {hint && <Hint text={hint} />}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50", props.className)} />;
}

export function Select({ value, onChange, options, className, id, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; id?: string; disabled?: boolean }) {
  return (
    <select id={id} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={cn("rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-brand", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Numeric input that keeps a local text buffer and commits valid numbers (or null when empty). */
export function NumberField({ value, onChange, step = 0.1, min, max, suffix, className, allowEmpty = true, id, placeholder }: { value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; suffix?: string; className?: string; allowEmpty?: boolean; id?: string; placeholder?: string }) {
  const [txt, setTxt] = useState(value === null || value === undefined ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setTxt(value === null || value === undefined ? "" : String(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Input
        id={id}
        inputMode="decimal"
        value={txt}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value;
          setTxt(t);
          if (t.trim() === "") {
            if (allowEmpty) {
              last.current = null;
              onChange(null);
            }
            return;
          }
          const n = Number(t.replace(/,/g, ""));
          if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) {
            last.current = n;
            onChange(n);
          }
        }}
        step={step}
        className="num text-right"
      />
      {suffix && <span className="text-xs text-ink-soft">{suffix}</span>}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step, label, suffix = "%", hint }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; suffix?: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
        <div className="w-24">
          <NumberField value={value} onChange={(v) => v !== null && onChange(v)} allowEmpty={false} suffix={suffix} />
        </div>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#1d4ed8]" />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1d4ed8]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 cursor-help text-slate-400" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-50 hidden w-72 -translate-x-1/2 rounded-lg border border-line bg-white p-2 text-xs font-normal leading-snug text-ink shadow-lg group-hover:block">{text}</span>
    </span>
  );
}

export function Callout({ tone = "blue", title, children, className }: { tone?: "blue" | "amber" | "red" | "green" | "slate" | "gold"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = { blue: "border-blue-200 bg-brand-soft", amber: "border-amber-200 bg-warn-soft", red: "border-red-200 bg-neg-soft", green: "border-green-200 bg-pos-soft", slate: "border-line bg-slate-50", gold: "border-yellow-200 bg-gold-soft" }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm text-ink", t, className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title ? "mt-0.5" : "", "text-[13px] leading-relaxed")}>{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, hint, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | "neutral"; hint?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cn("w-full rounded-xl border border-line bg-white p-3 text-left transition", onClick && "hover:border-brand hover:shadow-sm")}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className={cn("num mt-1 text-lg font-semibold", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </button>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
      {icon}
      <div className="mt-2 font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-xl text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2 no-print">{right}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-0.5 no-print">
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", value === t.value ? "bg-brand text-white" : "text-ink-soft hover:bg-slate-100")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 no-print" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <div className="font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function ScoreBar({ score, higherIsBetter = true }: { score: number | null; higherIsBetter?: boolean }) {
  if (score === null) return <div className="h-2 w-full rounded bg-slate-100" />;
  const good = higherIsBetter ? score : 100 - score;
  const color = good >= 70 ? "bg-pos" : good >= 50 ? "bg-gold" : good >= 35 ? "bg-warn" : "bg-neg";
  return (
    <div className="h-2 w-full rounded bg-slate-100">
      <div className={cn("h-2 rounded", color)} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
    </div>
  );
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          if (c === null || c === undefined) return "";
          const s = String(c);
          // neutralise spreadsheet formula injection
          const safe = /^[=+\-@]/.test(s) && isNaN(Number(s)) ? `'${s}` : s;
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(","),
    )
    .join("\n");
}
