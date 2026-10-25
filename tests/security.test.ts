import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkCitations, retrieve } from "@/lib/ai/client";
import { toCsv } from "@/components/ui";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

describe("secrets and AI safety", () => {
  it("API keys are only read in server-only modules", () => {
    const files = walk(join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/process\.env\.(ANTHROPIC_API_KEY|OPENAI_API_KEY|APP_ACCESS_TOKEN)/.test(src)) expect(src.includes('import "server-only"') || f.includes(join("app", "api")), f).toBe(true);
      expect(src.includes("NEXT_PUBLIC_ANTHROPIC") || src.includes("NEXT_PUBLIC_OPENAI"), f).toBe(false);
    }
  });
  it(".env.example contains no real keys", () => {
    const env = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(env).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(env).toMatch(/^ANTHROPIC_API_KEY=$/m);
  });
  it("citation checker rejects invented evidence", () => {
    const a = { annual: { roe: { byPeriod: { FY2024: {} } } } } as never;
    const r = checkCitations("ROE rose [M:roe:FY2024] per [E:abc] and [E:fake] [M:made:FY2024]", a, new Set(["abc"]));
    expect(r.valid).toEqual(["[M:roe:FY2024]", "[E:abc]"]);
    expect(r.invalid).toEqual(["[E:fake]", "[M:made:FY2024]"]);
  });
  it("retrieval ranks relevant passages", () => {
    const ex = [{ id: "1", text: "We plan to reduce net debt by FY26", category: "debt", score: 1 }, { id: "2", text: "The weather was pleasant", category: "other", score: 1 }] as never[];
    expect(retrieve(ex, "net debt reduction", 1)[0]).toMatchObject({ id: "1" });
  });
  it("CSV export neutralises formula injection", () => expect(toCsv([["=HYPERLINK(1)", "-5", "a,b"]])).toBe(`'=HYPERLINK(1),-5,"a,b"`));
});
