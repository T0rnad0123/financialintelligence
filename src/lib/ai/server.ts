// SERVER-ONLY: AI provider calls. API keys are read from environment variables
// and never sent to the browser.
import "server-only";

export type Provider = "anthropic" | "openai" | "none";

export interface AiConfig {
  provider: Provider;
  model: string;
  maxContextChars: number;
  tokenRequired: boolean;
}

export function getAiConfig(): AiConfig {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  const hasA = !!process.env.ANTHROPIC_API_KEY;
  const hasO = !!process.env.OPENAI_API_KEY;
  let provider: Provider = "none";
  if (explicit === "anthropic" && hasA) provider = "anthropic";
  else if (explicit === "openai" && hasO) provider = "openai";
  else if (explicit === "none") provider = "none";
  else if (hasA) provider = "anthropic";
  else if (hasO) provider = "openai";
  const model = provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5" : provider === "openai" ? process.env.OPENAI_MODEL || "gpt-4o-mini" : "";
  const maxContextChars = Math.max(5000, Math.min(400000, Number(process.env.AI_MAX_CONTEXT_CHARS) || 60000));
  return { provider, model, maxContextChars, tokenRequired: !!process.env.APP_ACCESS_TOKEN };
}

export function checkAccess(req: Request): boolean {
  const required = process.env.APP_ACCESS_TOKEN;
  if (!required) return true;
  return req.headers.get("x-app-token") === required;
}

// Best-effort per-instance rate limiting (serverless instances do not share memory).
const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(req: Request, perMinute = 20): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class AiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function callLlm(cfg: AiConfig, system: string, messages: ChatMessage[], maxTokens = 2000): Promise<string> {
  if (cfg.provider === "none") throw new AiError("No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    if (cfg.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0.2, system, messages }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new AiError(`AI provider returned ${res.status}${res.status === 401 ? " (invalid API key)" : res.status === 429 ? " (rate limited)" : ""}. ${t.slice(0, 200)}`, res.status === 429 ? 429 : 502);
      }
      const j = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    }
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "system", content: system }, ...messages] }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new AiError(`AI provider returned ${res.status}${res.status === 401 ? " (invalid API key)" : ""}. ${t.slice(0, 200)}`, res.status === 429 ? 429 : 502);
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error).name === "AbortError") throw new AiError("The AI service timed out. Try a shorter question or less context.", 504);
    throw new AiError("The external AI service is unavailable.", 502);
  } finally {
    clearTimeout(timer);
  }
}
