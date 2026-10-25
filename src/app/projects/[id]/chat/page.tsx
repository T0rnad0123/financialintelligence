"use client";
import { useRef, useState } from "react";
import { Bot, Send, Trash2, User } from "lucide-react";
import { useProject } from "@/components/project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader, PageTitle } from "@/components/ui";
import { AiText } from "@/components/AiPanel";
import { SourceTag } from "@/components/analysis";
import { askAi, buildContext, checkCitations, retrieve, tokenize } from "@/lib/ai/client";
import { fmtNum } from "@/lib/engine/core";
import { uid } from "@/lib/project";
import type { Analysis } from "@/lib/engine/analyze";
import type { Excerpt } from "@/lib/types";

const EXAMPLES = [
  "Why has this company's ROCE changed?",
  "Why is PAT growing faster or slower than operating cash flow?",
  "What are the five biggest financial risks?",
  "Is debt becoming a concern?",
  "What is management planning over the next three years?",
  "Which of management's earlier commitments have been achieved?",
  "What revenue growth is implied by my entered share price?",
  "What is the strongest evidence against investing in this company?",
  "What additional disclosures should I investigate?",
];

const KEYWORDS: [RegExp, string[]][] = [
  [/roce|capital employed|return on capital/i, ["roce", "roic", "assetTurnover", "ebitMargin"]],
  [/roe|return on equity|dupont/i, ["roe", "dupontNpm", "dupontAt", "dupontEm"]],
  [/cash|ocf|operating cash|conversion/i, ["cfo", "ocfToPat", "fcf", "accrualsRatio", "changeInOperatingWc"]],
  [/debt|leverage|borrow|interest/i, ["totalDebt", "netDebt", "debtToEquity", "netDebtToEbitda", "interestCoverage"]],
  [/margin|profit/i, ["ebitdaMargin", "patMargin", "otherIncomeToPbt", "exceptionalToPbt"]],
  [/revenue|growth|sales/i, ["revenue", "revenueGrowth", "patGrowth"]],
  [/working capital|receivable|inventor|payable/i, ["receivableDays", "inventoryDays", "payableDays", "ccc"]],
  [/risk|concern|against/i, ["netDebtToEbitda", "interestCoverage", "ocfToPat", "receivableDays"]],
];

interface Msg { id: string; role: "user" | "assistant"; content: string; mode: "ai" | "deterministic"; invalid?: string[]; excerpts?: Excerpt[]; metrics?: { name: string; values: string }[] }

function deterministicAnswer(q: string, a: Analysis, excerpts: Excerpt[]): Msg {
  const keys = new Set<string>();
  for (const [re, ks] of KEYWORDS) if (re.test(q)) ks.forEach((k) => keys.add(k));
  if (!keys.size) ["revenueGrowth", "ebitdaMargin", "roce", "ocfToPat", "netDebtToEbitda"].forEach((k) => keys.add(k));
  const metrics = [...keys].filter((k) => a.annual[k]).map((k) => ({ name: a.annual[k].def.name, values: a.fys.slice(-4).map((p) => `${p}: ${fmtNum(a.annual[k].byPeriod[p]?.value ?? null, a.annual[k].def.unit)}`).join(" · ") }));
  const lines: string[] = [];
  if (/implied|reverse|price/i.test(q) && a.valuation.reverse) lines.push(`Reverse DCF: the entered price implies constant revenue growth of ${a.valuation.reverse.impliedGrowth?.toFixed(1) ?? "n/a"}% p.a. or a constant EBIT margin of ${a.valuation.reverse.impliedMargin?.toFixed(1) ?? "n/a"}% (other assumptions held).`);
  const flags = a.flags.filter((f) => tokenize(q).some((t) => f.title.toLowerCase().includes(t) || f.observation.toLowerCase().includes(t))).slice(0, 4);
  if (/risk|concern|against|red flag|worry/i.test(q)) a.flags.filter((f) => f.severity !== "informational").slice(0, 5).forEach((f) => flags.includes(f) || flags.push(f));
  flags.forEach((f) => lines.push(`[${f.severity}] ${f.title}: ${f.observation}`));
  if (/commitment|achiev|guidance|promise/i.test(q)) a.guidance.forEach((g) => lines.push(`Guidance ${g.item.metric} FY${g.item.targetFy}: ${g.eval.status} — ${g.eval.explanation}`));
  return { id: uid("m"), role: "assistant", mode: "deterministic", content: lines.length ? lines.join("\n") : "Relevant calculated metrics and document passages are listed below.", metrics, excerpts: retrieve(excerpts, q, 5) };
}

export default function ChatPage() {
  const { project, analysis: a, ai } = useProject();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setErr(null);
    const userMsg: Msg = { id: uid("m"), role: "user", content: question, mode: "ai" };
    setMsgs((m) => [...m, userMsg]);
    setQ("");
    if (!ai?.configured) {
      setMsgs((m) => [...m, deterministicAnswer(question, a, project.excerpts)]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      return;
    }
    setBusy(true);
    try {
      const ctx = buildContext(a, project, question, Math.min(ai.maxContextChars || 60000, 60000));
      const history = msgs.filter((m) => m.mode === "ai").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      const r = await askAi("chat", question, ctx.text, history, project.settings.aiAccessToken);
      const cites = checkCitations(r.content, a, ctx.excerptIds);
      const exMap = new Map(project.excerpts.map((e) => [e.id, e]));
      const used = cites.valid.filter((c) => c.startsWith("[E:")).map((c) => exMap.get(c.slice(3, -1))).filter((e): e is Excerpt => !!e);
      setMsgs((m) => [...m, { id: uid("m"), role: "assistant", content: r.content, mode: "ai", invalid: cites.invalid, excerpts: used }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs((m) => [...m, { ...deterministicAnswer(question, a, project.excerpts), content: `AI request failed — showing deterministic evidence instead.\n${deterministicAnswer(question, a, project.excerpts).content}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };
  return (
    <div className="space-y-4">
      <PageTitle title="AI analyst chat" subtitle="Answers are grounded in the uploaded documents and calculated metrics, with citations. Report text is treated as untrusted data." right={msgs.length ? <Button size="sm" onClick={() => setMsgs([])}><Trash2 className="h-3.5 w-3.5" /> Clear</Button> : undefined} />
      {!ai?.configured && <Callout tone="slate" title="Deterministic mode (no AI key configured)">You can still ask questions: the app answers with the relevant calculated metrics, triggered flags and the best-matching document passages (keyword retrieval) — but without AI-written explanations. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY on the server to enable AI answers.</Callout>}
      {ai?.configured && <Callout tone="blue">AI requests send: calculated metrics, flags, valuation summary and up to ~40 relevant text excerpts (not the PDFs) to {ai.provider} ({ai.model}). Citations are checked against the evidence actually sent; unverifiable citations are struck through.</Callout>}
      {err && <Callout tone="red">{err}</Callout>}
      <Card>
        <CardHeader title="Conversation" icon={<Bot className="h-4 w-4 text-brand" />} />
        <CardBody className="space-y-3">
          {msgs.length === 0 && <div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs hover:border-brand hover:text-brand">{e}</button>)}</div>}
          {msgs.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className={m.role === "user" ? "max-w-[80%] rounded-xl bg-brand px-3 py-2 text-sm text-white" : "w-full rounded-xl border border-line bg-white p-3"}>
                {m.role === "user" ? <div className="flex items-start gap-2"><User className="mt-0.5 h-4 w-4" />{m.content}</div> : (
                  <div className="space-y-2">
                    <div className="flex gap-1"><Badge tone={m.mode === "ai" ? "purple" : "slate"}>{m.mode === "ai" ? "AI-generated" : "Deterministic evidence"}</Badge>{m.invalid && m.invalid.length > 0 && <Badge tone="red">{m.invalid.length} unverifiable citation(s)</Badge>}</div>
                    <AiText content={m.content} invalid={m.invalid} />
                    {m.metrics && m.metrics.length > 0 && <table className="fin text-xs"><tbody>{m.metrics.map((x) => <tr key={x.name}><td className="pr-3 font-medium">{x.name}</td><td className="num text-ink-soft">{x.values}</td></tr>)}</tbody></table>}
                    {m.excerpts && m.excerpts.length > 0 && <div className="space-y-1">{m.excerpts.map((e) => <div key={e.id} className="rounded bg-slate-50 p-2 text-xs"><span className="mr-1 rounded bg-brand-soft px-1 text-[10px] text-brand">[E:{e.id}]</span><SourceTag name={e.docName} page={e.page} /><div className="mt-0.5 italic text-ink-soft">“{e.text.slice(0, 350)}”</div></div>)}</div>}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-ink-soft">Thinking…</div>}
          <div ref={endRef} />
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this company's financials, strategy, risks or valuation…" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" maxLength={2000} />
            <Button type="submit" variant="primary" loading={busy}><Send className="h-4 w-4" /> Ask</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
