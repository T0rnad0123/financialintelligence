import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocMeta, DocKind } from "@/lib/types";
import { processPdf, type PdfJsLike } from "@/lib/extraction/processor";

export const FIXTURES = join(process.cwd(), "fixtures", "synthetic");

let pdfjsPromise: Promise<PdfJsLike> | null = null;
export function loadPdfjs(): Promise<PdfJsLike> {
  if (!pdfjsPromise) {
    // The legacy build runs in Node without a DOM.
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => m as unknown as PdfJsLike);
  }
  return pdfjsPromise;
}

export function meta(fileName: string, kind: DocKind, extra: Partial<DocMeta> = {}): DocMeta {
  return {
    id: `doc-${fileName}`,
    projectId: "p1",
    kind,
    fileName,
    size: 0,
    hash: fileName,
    uploadedAt: Date.now(),
    status: "processing",
    progress: 0,
    warnings: [],
    ...extra,
  };
}

export async function runFixture(fileName: string, kind: DocKind, extra: Partial<DocMeta> = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(readFileSync(join(FIXTURES, fileName)));
  return processPdf(data, meta(fileName, kind, extra), { pdfjs, fyEndMonth: 3, defaultBasis: "consolidated" });
}
