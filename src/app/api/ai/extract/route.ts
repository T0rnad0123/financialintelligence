import { z } from "zod";
import { AiError, callLlm, checkAccess, getAiConfig, rateLimit } from "@/lib/ai/server";
import { EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ pageText: z.string().min(20).max(30_000), pageNumber: z.number().int().positive() });
const Out = z.object({
  unit: z.enum(["crore", "lakh", "million", "thousand", "rupees", "unknown"]).catch("unknown"),
  basis: z.enum(["consolidated", "standalone", "unknown"]).catch("unknown"),
  items: z.array(z.object({ item: z.string(), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodType: z.enum(["quarter", "year", "asAt", "ytd"]), rawValue: z.string(), value: z.number() })).max(400),
});

export async function POST(req: Request) {
  const cfg = getAiConfig();
  if (cfg.provider === "none") return Response.json({ error: "AI is not configured on this server." }, { status: 503 });
  if (!checkAccess(req)) return Response.json({ error: "Access token required." }, { status: 401 });
  if (!rateLimit(req, 30)) return Response.json({ error: "Too many requests." }, { status: 429 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const raw = await callLlm(cfg, EXTRACTION_PROMPT, [{ role: "user", content: `<page number="${body.pageNumber}">\n${body.pageText}\n</page>` }], 4000);
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = Out.safeParse(JSON.parse(json));
    if (!parsed.success) return Response.json({ error: "AI returned an unexpected format; nothing was imported." }, { status: 502 });
    // Anti-hallucination: keep only values whose raw text literally appears on the page.
    const text = body.pageText.replace(/\s+/g, " ");
    const kept = parsed.data.items.filter((i) => i.rawValue.trim().length > 0 && text.includes(i.rawValue.trim()));
    return Response.json({ ...parsed.data, items: kept, rejected: parsed.data.items.length - kept.length, provider: cfg.provider, model: cfg.model });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("AI extraction failed (invalid JSON).");
    return Response.json({ error: err.message }, { status: err.status });
  }
}
