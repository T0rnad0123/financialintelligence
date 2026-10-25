import { readdirSync } from "node:fs";
import type { DocMeta, Project } from "@/lib/types";
import { FIXTURES, runFixture, meta } from "./pdf";
import { mergeFacts, mergeSegments } from "@/lib/engine/merge";
import { newProject } from "@/lib/project";

/** Process every synthetic fixture and build a project, exactly as the browser does. */
export async function buildSyntheticProject(): Promise<{ project: Project; docs: DocMeta[] }> {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".pdf") && !f.includes("scanned"));
  const docs: DocMeta[] = [];
  const inputs: { doc: DocMeta; facts: any[]; segments: any[] }[] = [];
  const project = newProject({ name: "Simulated Steel & Power Ltd (SYNTHETIC)", sector: "metals" });
  let t = 1;
  for (const f of files) {
    const annualM = f.match(/AnnualReport_FY(\d{4})-(\d{2})/);
    const kind = annualM ? "annual" : "quarterly";
    const extra = annualM ? { declaredFy: Number(annualM[1]) + 1 } : {};
    const r = await runFixture(f, kind, extra);
    const d: DocMeta = { ...meta(f, kind, extra), ...r.meta, uploadedAt: t++ } as DocMeta;
    docs.push(d);
    inputs.push({ doc: d, facts: r.facts, segments: r.segments });
    project.excerpts.push(...r.excerpts);
    project.strategy.push(...r.strategyCandidates);
  }
  project.facts = mergeFacts(inputs, undefined);
  project.segments = mergeSegments(inputs);
  return { project, docs };
}
