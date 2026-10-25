"use client";
import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { useProject } from "./project/ProjectProvider";
import { Badge, Button, Callout, Card, CardBody, CardHeader } from "./ui";
import { askAi, buildContext, checkCitations } from "@/lib/ai/client";
import { uid } from "@/lib/project";

/** Renders AI text with inline citation tags highlighted. Plain text only (no HTML injection). */
export function AiText({ content, invalid }: { content: string; invalid?: string[] }) {
  const parts = content.split(/(\[(?:M|E):[^\]\s]+\])/g);
  return (
    <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
      {parts.map((p, i) =>
        /^\[(M|E):/.test(p) ? (
          <span key={i} className={invalid?.includes(p) ? "rounded bg-neg-soft px-1 text-[10px] text-neg line-through" : "rounded bg-brand-soft px-1 text-[10px] text-brand"} title={invalid?.includes(p) ? "Citation not found in the provided evidence" : "Cited evidence"}>
            {p}
          </span>
        ) : (
          <span key={i}>{p.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "")}</span>
        ),
      )}
    </div>
  );
}

export function AiPanel({ task, title, question }: { task: "summary" | "management" | "risks" | "valuation"; title: string; question?: string }) {
  const { project, analysis, ai, update } = useProject();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saved = [...project.aiOutputs].filter((o) => o.task === task).sort((a, b) => b.createdAt - a.createdAt)[0];
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ctx = buildContext(analysis, project, question ?? task, Math.min(ai?.maxContextChars || 60000, 60000));
      const r = await askAi(task, question ?? "", ctx.text, [], project.settings.aiAccessToken);
      const cites = checkCitations(r.content, analysis, ctx.excerptIds);
      update((p) => ({ ...p, aiOutputs: [...p.aiOutputs.filter((o) => o.task !== task), { id: uid("ai"), task, createdAt: Date.now(), provider: r.provider, model: r.model, content: r.content, citationsChecked: cites }] }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={title}
        icon={<Bot className="h-4 w-4 text-brand" />}
        subtitle={ai?.configured ? `AI-generated interpretation (${ai.provider}: ${ai.model}). Calculations come from the deterministic engine; the AI only explains them.` : "AI not configured — deterministic analysis shown elsewhere on this page."}
        right={ai?.configured ? <Button size="sm" variant="primary" onClick={run} loading={busy}><Sparkles className="h-3.5 w-3.5" /> {saved ? "Regenerate" : "Generate"}</Button> : undefined}
      />
      <CardBody>
        {!ai?.configured && <Callout tone="slate">To enable AI narratives, set <code>ANTHROPIC_API_KEY</code> (or <code>OPENAI_API_KEY</code>) as a server environment variable and restart/redeploy. Only extracted text snippets and calculated figures are sent — never the PDF files.</Callout>}
        {err && <Callout tone="red">{err}</Callout>}
        {saved ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1 text-[11px]">
              <Badge tone="purple">AI-generated</Badge>
              <Badge tone="slate">{new Date(saved.createdAt).toLocaleString("en-IN")}</Badge>
              <Badge tone="green">{saved.citationsChecked.valid.length} verified citation(s)</Badge>
              {saved.citationsChecked.invalid.length > 0 && <Badge tone="red">{saved.citationsChecked.invalid.length} unverifiable citation(s)</Badge>}
            </div>
            <AiText content={saved.content} invalid={saved.citationsChecked.invalid} />
          </div>
        ) : (
          ai?.configured && <div className="text-sm text-ink-soft">No AI analysis generated yet.</div>
        )}
      </CardBody>
    </Card>
  );
}
