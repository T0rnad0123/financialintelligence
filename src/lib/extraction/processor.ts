// End-to-end document processing: PDF -> text -> classification -> facts + evidence.
// Runs in the browser (client-side extraction keeps large PDFs off serverless
// functions) and in Node for tests. pdf.js is injected so both work.
import type {
  AuditFinding,
  Basis,
  DocMeta,
  DocWarning,
  Excerpt,
  ExtractedFact,
  PageInfo,
  StatementType,
  StrategyItem,
  UnitKey,
} from "../types";
import { buildLines, type Line, type TextItem } from "./layout";
import { classifyPage, NUMERIC_STATEMENT_TYPES, parseStatementPage, type PageClassification } from "./statementParser";
import { extractExcerpts, findAuditFindings, detectStrategyCandidates } from "./narrative";
import { periodSortKey, sortPeriodIds } from "./parseUtils";

/** Minimal subset of the pdf.js API we rely on. */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; disableFontFace?: boolean; isEvalSupported?: boolean; useSystemFonts?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: unknown[] }>;
        getViewport(o: { scale: number }): { width: number; height: number };
        render?: unknown;
        cleanup?: () => void;
      }>;
      destroy(): Promise<void>;
    }>;
  };
}

/** Optional OCR hook: returns positioned words for a page (PDF coordinates). */
export type OcrFn = (pageNumber: number) => Promise<TextItem[]>;

export interface ProcessOptions {
  pdfjs: PdfJsLike;
  fyEndMonth: number;
  defaultBasis: Basis;
  ocr?: OcrFn;
  onProgress?: (pct: number, stage: string) => void;
  signal?: { cancelled: boolean };
}

export interface ProcessResult {
  meta: Partial<DocMeta>;
  pages: PageInfo[];
  facts: ExtractedFact[];
  segments: { basis: Basis; periodId: string; segment: string; metric: "revenue" | "result" | "assets" | "liabilities" | "capex"; value: number; page: number; rawText: string; rawValue: string }[];
  excerpts: Excerpt[];
  auditFindings: AuditFinding[];
  strategyCandidates: StrategyItem[];
}

function toTextItems(items: unknown[]): TextItem[] {
  const out: TextItem[] = [];
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!it || typeof it.str !== "string" || !it.transform) continue;
    out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, h: it.height || Math.abs(it.transform[3]) || 8 });
  }
  return out;
}

function mostCommon<T>(arr: T[]): T | undefined {
  const m = new Map<T, number>();
  arr.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1));
  let best: T | undefined;
  let bc = 0;
  m.forEach((c, k) => {
    if (c > bc) {
      bc = c;
      best = k;
    }
  });
  return best;
}

export async function processPdf(data: Uint8Array, meta: DocMeta, opts: ProcessOptions): Promise<ProcessResult> {
  const warnings: DocWarning[] = [];
  const progress = (p: number, s: string) => opts.onProgress?.(Math.round(p), s);
  progress(2, "Opening PDF");
  let pdf: Awaited<ReturnType<PdfJsLike["getDocument"]>["promise"]>;
  try {
    // copy: pdf.js may transfer/detach the buffer
    pdf = await opts.pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/password/i.test(msg) ? "The PDF is password-protected. Remove the password and upload again." : `The file could not be opened as a PDF (it may be corrupted or not a PDF): ${msg}`);
  }
  const n = pdf.numPages;
  const pageLines: Line[][] = [];
  const pages: PageInfo[] = [];
  const classes: PageClassification[] = [];
  let scannedPages = 0;
  let ocrPages = 0;

  for (let i = 1; i <= n; i++) {
    if (opts.signal?.cancelled) throw new Error("Processing cancelled.");
    const page = await pdf.getPage(i);
    let items: TextItem[] = [];
    let usedOcr = false;
    try {
      const tc = await page.getTextContent();
      items = toTextItems(tc.items);
    } catch {
      warnings.push({ level: "warning", message: "Text layer could not be read on this page.", page: i });
    }
    const chars = items.reduce((s, it) => s + it.str.replace(/\s/g, "").length, 0);
    if (chars < 25) {
      scannedPages++;
      if (opts.ocr) {
        try {
          progress(5 + (i / n) * 70, `OCR page ${i} of ${n}`);
          items = await opts.ocr(i);
          usedOcr = items.length > 0;
          if (usedOcr) ocrPages++;
        } catch (e) {
          warnings.push({ level: "warning", message: `OCR failed: ${e instanceof Error ? e.message : String(e)}`, page: i });
        }
      }
    }
    page.cleanup?.();
    const lines = buildLines(items);
    const text = lines.map((l) => l.text).join("\n");
    const cls = classifyPage(lines, text);
    pageLines.push(lines);
    classes.push(cls);
    pages.push({ n: i, text, charCount: text.length, types: cls.types, basis: cls.basis, unit: cls.unit ?? undefined, ocr: usedOcr || undefined });
    if (i % 5 === 0 || i === n) progress(5 + (i / n) * 70, `Reading text (${i}/${n} pages)`);
  }
  await pdf.destroy();

  const scanned = scannedPages / Math.max(1, n) > 0.6;
  if (scanned && !opts.ocr) {
    warnings.push({ level: "error", message: `PDF appears to be scanned (${scannedPages} of ${n} pages have no text layer). Enable OCR in Settings and reprocess, or upload a text-based PDF.` });
  } else if (scannedPages > 0 && !opts.ocr) {
    warnings.push({ level: "info", message: `${scannedPages} page(s) have no text layer (images/graphics or scanned pages).` });
  }

  // Document-level defaults for unit and basis
  const statementIdx = classes.map((c, i) => (c.types.some((t) => NUMERIC_STATEMENT_TYPES.includes(t)) ? i : -1)).filter((i) => i >= 0);
  const docUnit: UnitKey | null = meta.unitOverride ?? mostCommon(statementIdx.map((i) => classes[i].unit).filter((u): u is UnitKey => !!u)) ?? null;
  const detectedUnits = [...new Set(statementIdx.map((i) => classes[i].unit).filter((u): u is UnitKey => !!u))];
  if (detectedUnits.length > 1) warnings.push({ level: "info", message: `Multiple reporting units detected (${detectedUnits.join(", ")}); each page's own unit is applied.` });

  progress(78, "Extracting financial statements");
  const facts: ExtractedFact[] = [];
  const segments: ProcessResult["segments"] = [];
  const statementPages: Partial<Record<StatementType, number[]>> = {};
  let lastBasis: Basis | undefined = meta.basisOverride;
  let unknownBasisPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const cls = classes[i];
    cls.types.forEach((t) => {
      (statementPages[t] ??= []).push(i + 1);
    });
    if (cls.basis) lastBasis = cls.basis;
    if (!cls.types.some((t) => NUMERIC_STATEMENT_TYPES.includes(t))) continue;
    let basis = meta.basisOverride ?? cls.basis ?? lastBasis;
    if (!basis) {
      basis = opts.defaultBasis;
      unknownBasisPages++;
    }
    const pageUnit = meta.unitOverride ?? cls.unit ?? docUnit;
    const r = parseStatementPage(pageLines[i], cls, {
      docId: meta.id,
      docName: meta.fileName,
      docKind: meta.kind,
      fyEndMonth: opts.fyEndMonth,
      declaredFy: meta.declaredFy,
      periodHint: meta.periodHint,
      unit: pageUnit,
      basis,
      pageNumber: i + 1,
      method: pages[i].ocr ? "ocr" : "parser",
    });
    r.warnings.forEach((w) => warnings.push({ level: "warning", message: w, page: i + 1 }));
    // keep first occurrence per basis/period/item within the document
    for (const f of r.facts) {
      if (pages[i].ocr && f.confidence === "high") f.confidence = "medium";
      const dup = facts.find((x) => x.basis === f.basis && x.periodId === f.periodId && x.item === f.item);
      if (!dup) facts.push(f);
      else if (Math.abs(dup.value - f.value) > Math.max(0.01, Math.abs(dup.value) * 0.005)) {
        warnings.push({ level: "info", message: `${f.item} for ${f.periodId} (${f.basis}) appears with different values on pages ${dup.source.page} and ${f.source.page}; first occurrence kept.`, page: i + 1 });
      }
    }
    r.segments.forEach((s) => segments.push({ ...s, basis, page: i + 1 }));
  }
  if (unknownBasisPages > 0) {
    warnings.push({ level: "warning", message: `Standalone/consolidated basis not stated on ${unknownBasisPages} statement page(s); assumed "${opts.defaultBasis}". Override the basis for this document if this is wrong.` });
  }
  if (!docUnit && statementIdx.length > 0) {
    warnings.push({ level: "error", message: "Reporting unit (₹ crore / lakh / million) could not be detected. Set the unit for this document and reprocess — no values were imported without a unit." });
  }
  if (statementIdx.length === 0 && !scanned) {
    warnings.push({ level: meta.kind === "quarterly" ? "error" : "warning", message: "No financial statement pages (balance sheet, P&L, cash flow or results table) were identified." });
  }

  // primary period
  const periods = sortPeriodIds([...new Set(facts.map((f) => f.periodId))]);
  let primary: string | undefined;
  if (meta.kind === "annual") {
    const fys = periods.filter((p) => p.startsWith("FY"));
    primary = meta.declaredFy ? `FY${meta.declaredFy}` : fys[fys.length - 1];
    if (meta.declaredFy && fys.length && !fys.includes(`FY${meta.declaredFy}`)) {
      primary = fys[fys.length - 1];
      warnings.push({ level: "warning", message: `You assigned this report to FY${meta.declaredFy - 1}-${String(meta.declaredFy).slice(2)}, but its statements report ${fys.join(", ")}. The figures are organised by the periods printed in the document (primary period ${primary}); change the slot's reporting year if needed.` });
    }
  } else {
    const qs = periods.filter((p) => p.startsWith("Q"));
    primary = qs.sort((a, b) => periodSortKey(a) - periodSortKey(b))[qs.length - 1];
  }
  facts.forEach((f) => {
    f.isPrimaryPeriod = f.periodId === primary || (meta.kind === "quarterly" && primary !== undefined && f.periodId.startsWith("FY") && Number(f.periodId.slice(2)) === Number(primary.split("FY")[1]) && primary.startsWith("Q4"));
  });

  progress(90, "Extracting management commentary & disclosures");
  const fy = meta.declaredFy ?? (primary ? Number(primary.split("FY")[1]) : undefined);
  const narrativePages = pages.map((p) => ({ n: p.n, text: p.text, types: p.types }));
  const excerpts = extractExcerpts(narrativePages, { id: meta.id, name: meta.fileName, kind: meta.kind, fy });
  const auditFindings = findAuditFindings(narrativePages, { id: meta.id, name: meta.fileName, fy });
  const strategyCandidates = meta.kind === "annual" ? detectStrategyCandidates(narrativePages, { id: meta.id, name: meta.fileName, fy }) : [];

  const hasError = warnings.some((w) => w.level === "error");
  const status = facts.length === 0 ? (hasError || meta.kind === "quarterly" ? "failed" : "partial") : hasError ? "partial" : "success";
  progress(100, "Done");
  return {
    meta: {
      pageCount: n,
      scanned,
      ocrApplied: ocrPages > 0,
      detectedUnits,
      detectedBases: [...new Set(facts.map((f) => f.basis))],
      detectedPeriods: periods,
      statementPages,
      warnings,
      factCount: facts.length,
      status,
      error: status === "failed" ? warnings.find((w) => w.level === "error")?.message ?? "No financial figures could be extracted from this document." : undefined,
      auditFindings,
      primaryPeriod: primary,
    },
    pages,
    facts,
    segments,
    excerpts,
    auditFindings,
    strategyCandidates,
  };
}
