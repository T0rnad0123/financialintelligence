import { getAiConfig } from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const c = getAiConfig();
  // Never return keys — only whether a provider is configured.
  return Response.json({ configured: c.provider !== "none", provider: c.provider, model: c.model, maxContextChars: c.maxContextChars, tokenRequired: c.tokenRequired });
}
