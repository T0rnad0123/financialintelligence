"use client";
// Browser-side document pipeline: validation -> client-side PDF extraction
// (optionally OCR) -> local storage -> re-merge of all project facts.
import type { DocKind, DocMeta, Project } from "../types";
import { processPdf, type PdfJsLike, type OcrFn } from "../extraction/processor";
import { quickHash } from "../extraction/parseUtils";
import { mergeFacts, mergeSegments } from "../engine/merge";
import { getBlob, getDocData, listDocs, saveBlob, saveDoc, saveDocData, getProject, saveProject } from "./db";
import { uid } from "../project";
import type { TextItem } from "../extraction/layout";

export const MAX_FILE_MB = 80;
export const OCR_PREF_KEY = "fil.ocrEnabled";
export const STORE_PDF_PREF_KEY = "fil.storePdfs";

let pdfjsPromise: Promise<PdfJsLike & { GlobalWorkerOptions: { workerSrc: string } }> | null = null;

export async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      const mod = m as unknown as PdfJsLike & { GlobalWorkerOptions: { workerSrc: string } };
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

export function prefs() {
  const read = (k: string, d: boolean) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : v === "1";
    } catch {
      return d;
    }
  };
  return { ocr: read(OCR_PREF_KEY, false), storePdfs: read(STORE_PDF_PREF_KEY, true) };
}

export function setPref(k: string, v: boolean) {
  try {
    localStorage.setItem(k, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function validateFile(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return `${file.name}: only PDF files are accepted.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `${file.name}: larger than ${MAX_FILE_MB} MB. Split the PDF (e.g. keep the financial statements and MD&A sections) and upload again.`;
  return null;
}

async function checkPdfMagic(bytes: Uint8Array): Promise<boolean> {
  const head = new TextDecoder().decode(bytes.slice(0, 1024));
  return head.includes("%PDF-");
}

/** Build an OCR function backed by tesseract.js (loaded on demand; downloads language data from its CDN). */
async function makeOcr(data: Uint8Array): Promise<{ fn: OcrFn; dispose: () => Promise<void> }> {
  const pdfjs = await loadPdfJs();
  const T = await import("tesseract.js");
  const worker = await T.createWorker("eng");
  const doc = await (pdfjs as unknown as { getDocument: (o: { data: Uint8Array }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> }> } }).getDocument({ data: data.slice() }).promise;
  const fn: OcrFn = async (n) => {
    const page = await doc.getPage(n);
    const scale = 2;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const res = (await worker.recognize(canvas, {}, { blocks: true })) as unknown as { data: { words?: OcrWord[]; blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] } };
    let words: OcrWord[] = res.data.words ?? [];
    if (!words.length && res.data.blocks) words = res.data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    const pageH = vp.height / scale;
    const items: TextItem[] = words
      .filter((w) => w.text && w.confidence > 30)
      .map((w) => ({ str: w.text, x: w.bbox.x0 / scale, y: pageH - w.bbox.y1 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: (w.bbox.y1 - w.bbox.y0) / scale }));
    canvas.width = 0;
    canvas.height = 0;
    return items;
  };
  return { fn, dispose: async () => void (await worker.terminate()) };
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export async function createDocument(project: Project, file: File, kind: DocKind, opts: { slot?: string; declaredFy?: number } = {}): Promise<{ doc: DocMeta; bytes: Uint8Array; duplicateOf?: string }> {
  const err = validateFile(file);
  if (err) throw new Error(err);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(await checkPdfMagic(bytes))) throw new Error(`${file.name}: file content is not a valid PDF.`);
  const hash = quickHash(bytes);
  const existing = await listDocs(project.id);
  const dup = existing.find((d) => d.hash === hash);
  const doc: DocMeta = {
    id: uid("doc"),
    projectId: project.id,
    kind,
    slot: opts.slot,
    declaredFy: opts.declaredFy,
    fileName: file.name.replace(/[^\w.\-() &]/g, "_").slice(0, 160),
    size: file.size,
    hash,
    uploadedAt: Date.now(),
    status: "uploading",
    progress: 0,
    warnings: dup ? [{ level: "warning", message: `Same content as already uploaded “${dup.fileName}”.` }] : [],
  };
  await saveDoc(doc);
  if (prefs().storePdfs) {
    try {
      await saveBlob(doc.id, new Blob([bytes], { type: "application/pdf" }));
      doc.blobStored = true;
      await saveDoc(doc);
    } catch {
      doc.warnings.push({ level: "info", message: "Original PDF not stored (browser storage quota). Re-upload to reprocess." });
    }
  }
  return { doc, bytes, duplicateOf: dup?.fileName };
}

export async function processDocument(project: Project, doc: DocMeta, bytes: Uint8Array | null, onUpdate: (d: DocMeta) => void, signal?: { cancelled: boolean }): Promise<DocMeta> {
  let data = bytes;
  if (!data) {
    const blob = await getBlob(doc.id);
    if (!blob) throw new Error("Original PDF is not stored in this browser — use ‘Replace’ to upload it again.");
    data = new Uint8Array(await blob.arrayBuffer());
  }
  let cur: DocMeta = { ...doc, status: "processing", progress: 1, stage: "Starting", error: undefined, warnings: doc.warnings.filter((w) => w.message.startsWith("Same content")) };
  await saveDoc(cur);
  onUpdate(cur);
  let ocr: Awaited<ReturnType<typeof makeOcr>> | null = null;
  try {
    const pdfjs = await loadPdfJs();
    if (prefs().ocr) {
      try {
        ocr = await makeOcr(data);
      } catch (e) {
        cur.warnings.push({ level: "warning", message: `OCR engine could not be loaded (${e instanceof Error ? e.message : String(e)}). Continuing without OCR.` });
      }
    }
    let last = 0;
    const result = await processPdf(data, cur, {
      pdfjs,
      fyEndMonth: project.fyEndMonth,
      defaultBasis: project.preferredBasis,
      ocr: ocr?.fn,
      signal,
      onProgress: (pct, stage) => {
        if (pct - last >= 3 || pct === 100) {
          last = pct;
          cur = { ...cur, progress: pct, stage };
          onUpdate(cur);
        }
      },
    });
    await saveDocData({ docId: doc.id, pages: result.pages, facts: result.facts, segments: result.segments, excerpts: result.excerpts, strategyCandidates: result.strategyCandidates });
    cur = { ...cur, ...result.meta, warnings: [...cur.warnings, ...(result.meta.warnings ?? [])], progress: 100, stage: undefined } as DocMeta;
  } catch (e) {
    cur = { ...cur, status: "failed", progress: 0, stage: undefined, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await ocr?.dispose().catch(() => undefined);
  }
  await saveDoc(cur);
  onUpdate(cur);
  return cur;
}

/** Rebuild project-level facts, segments and evidence from all processed documents. */
export async function remergeProject(projectId: string): Promise<Project | undefined> {
  const project = await getProject(projectId);
  if (!project) return undefined;
  const docs = await listDocs(projectId);
  const inputs = [];
  const excerpts = [];
  const candidates = [];
  for (const d of docs) {
    const dd = await getDocData(d.id);
    if (!dd) continue;
    inputs.push({ doc: d, facts: dd.facts, segments: dd.segments });
    if (d.status === "success" || d.status === "partial") {
      excerpts.push(...dd.excerpts);
      candidates.push(...dd.strategyCandidates);
    }
  }
  project.facts = mergeFacts(inputs, project.facts);
  project.segments = mergeSegments(inputs);
  project.excerpts = excerpts;
  // keep user/confirmed strategy items, refresh auto-detected candidates from current docs
  const keep = project.strategy.filter((s) => s.confirmed || s.origin !== "auto-detected");
  const keepIds = new Set(keep.map((s) => s.id));
  const docIds = new Set(docs.map((d) => d.id));
  project.strategy = [...keep.filter((s) => !s.docId || docIds.has(s.docId) || s.origin !== "auto-detected"), ...candidates.filter((c) => !keepIds.has(c.id))];
  project.lastMergedAt = Date.now();
  await saveProject(project);
  return project;
}
