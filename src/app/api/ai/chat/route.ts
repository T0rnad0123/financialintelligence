import { z } from "zod";
import { AiError, callLlm, checkAccess, getAiConfig, rateLimit } from "@/lib/ai/server";
import { GROUNDING_RULES, TASK_PROMPTS } from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  task: z.enum(["chat", "summary", "management", "risks", "valuation"]),
  question: z.string().max(4000).optional().default(""),
  context: z.string().min(1).max(500_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(12).optional().default([]),
});

export async function POST(req: Request) {
  const cfg = getAiConfig();
  if (cfg.provider === "none") return Response.json({ error: "AI is not configured on this server (no ANTHROPIC_API_KEY or OPENAI_API_KEY). All calculations still work in deterministic mode." }, { status: 503 });
  if (!checkAccess(req)) return Response.json({ error: "Access token required. Enter it in Settings → AI access token." }, { status: 401 });
  if (!rateLimit(req)) return Response.json({ error: "Too many AI requests — wait a minute and retry." }, { status: 429 });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 1_500_000) return Response.json({ error: "Request too large." }, { status: 413 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const context = body.context.slice(0, cfg.maxContextChars);
  const truncated = body.context.length > cfg.maxContextChars;
  const system = `${GROUNDING_RULES}\n\nTASK: ${TASK_PROMPTS[body.task]}`;
  const userMsg = `${context}${truncated ? "\n[Context truncated to server limit]" : ""}\n\n<user_request>${body.task === "chat" ? body.question : TASK_PROMPTS[body.task]}</user_request>`;
  try {
    const content = await callLlm(cfg, system, [...body.history, { role: "user", content: userMsg }], body.task === "chat" ? 1500 : 2200);
    return Response.json({ content, provider: cfg.provider, model: cfg.model, truncated });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("AI request failed.");
    return Response.json({ error: err.message }, { status: err.status });
  }
}
