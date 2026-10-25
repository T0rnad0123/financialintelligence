import Link from "next/link";

export const metadata = { title: "Privacy & data handling — Financial Intelligence Lab" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-[14px] leading-relaxed text-ink">
      <Link href="/" className="text-sm text-brand underline">← Back to projects</Link>
      <h1 className="text-2xl font-semibold">Privacy & data handling</h1>
      <h2 className="text-lg font-semibold">What stays in your browser</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Uploaded PDFs are read and processed <b>inside your browser</b> (pdf.js). They are not uploaded to this application's server.</li>
        <li>Extracted text, figures, corrections, assumptions and (optionally) the original PDFs are stored in your browser's IndexedDB on this device only. Nothing syncs across devices or browsers.</li>
        <li>Clearing site data, using private browsing, or browser storage eviction can delete projects. Use “Project backup” to export a JSON copy (it excludes the PDF files).</li>
      </ul>
      <h2 className="text-lg font-semibold">What may leave your browser</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><b>AI features (optional).</b> Only when the server operator has configured an AI key and you click an AI action: calculated metrics, flags, your valuation assumptions and selected <b>text excerpts</b> from your documents are sent to this application's server, which forwards them to the configured AI provider (Anthropic or an OpenAI-compatible service). That provider receives and processes this text under its own terms. The PDF files themselves are never sent.</li>
        <li><b>AI-assisted extraction (optional, per document).</b> Sends the text of identified statement pages to the AI provider after you confirm.</li>
        <li><b>OCR (optional).</b> When enabled, the tesseract.js engine and English language data are downloaded from the tesseract.js CDN. Recognition runs locally; page images are not uploaded.</li>
        <li>The application never fetches share prices or any market data.</li>
      </ul>
      <h2 className="text-lg font-semibold">Security measures</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>API keys are read from server environment variables only and are never exposed to the browser.</li>
        <li>File type (PDF signature), size limits and request-size limits are enforced; documents are parsed as data, never executed (pdf.js eval disabled).</li>
        <li>Document text is treated as untrusted: AI prompts mark it as data and instruct the model to ignore instructions inside it. AI citations are verified against the evidence sent.</li>
        <li>Optional <code>APP_ACCESS_TOKEN</code> protects the AI routes of a public deployment; basic per-instance rate limiting is applied.</li>
      </ul>
      <p className="text-sm text-ink-soft">This tool provides analysis, not investment advice.</p>
    </main>
  );
}
