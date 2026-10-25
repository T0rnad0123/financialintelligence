// Copies the pdf.js worker into /public so the browser can load it from the same origin.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdf.worker.min.mjs");
if (!existsSync(src)) {
  console.warn("[copy-pdf-worker] pdfjs-dist not installed yet; skipping.");
} else {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("[copy-pdf-worker] copied pdf.worker.min.mjs to public/");
}
