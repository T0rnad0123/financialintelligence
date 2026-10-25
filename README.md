# Financial Intelligence Lab

**AI-Powered Financial Health, Fundamental Analysis & Valuation of Indian Listed Companies**

Upload up to four annual reports and sixteen quarters of results (PDF) for an NSE/BSE-listed company, enter the current share price by hand, and get a traceable financial analysis: 80+ deterministic metrics, forensic checks, sector-aware scores, management-strategy tracking, a full valuation engine (multiples, FCFF DCF, sensitivity, reverse DCF, DDM, residual income, asset-based) and exportable reports. AI is optional and only *interprets* the calculated figures, with verified citations.

> Analytical tool only — not investment advice.

---

## Contents

1. [What's inside](#1-whats-inside)
2. [Architecture](#2-architecture)
3. A. [Running locally](#a-running-locally) · B. [VS Code](#b-opening-the-project-in-vs-code) · C. [Dependencies](#c-installing-dependencies) · D. [AI keys](#d-configuring-ai-api-keys) · E. [Testing uploads](#e-testing-document-uploads) · F. [GitHub](#f-uploading-the-project-to-github) · G. [Vercel import](#g-importing-the-repository-into-vercel) · H. [Vercel env vars](#h-configuring-environment-variables-in-vercel) · I. [Deploy](#i-deploying) · J. [Troubleshooting](#j-troubleshooting)
4. [Testing](#4-testing)
5. [Methodology](#5-methodology)
6. [Privacy & security](#6-privacy--security)
7. [Known limitations](#7-known-limitations)
8. [Project structure](#8-project-structure)

---

## 1. What's inside

| Area | What works |
|---|---|
| Projects | Multiple company projects, saved in the browser (IndexedDB); progressive uploads; reopen, export/import JSON backup, delete with all local data |
| Document centre | 4 annual-report slots (assign the reporting year), multi-file quarterly upload, drag & drop, progress, status (uploading / processing / success / partially completed / failed), retry, replace, remove, unit/basis overrides, period-hint fallback, duplicate detection |
| Extraction (client-side) | pdf.js text with positions → line reconstruction → statement classification (BS, P&L, cash flow, SEBI results, auditor's report, MD&A, Chairman/MD letters, Board's report, related parties, contingent liabilities, segments) → period detection from column headers (Q1–Q4, FY, "as at", 9M/half-year ignored) → units (₹ / Rs / INR; thousand, lakh, crore, million, billion) → normalisation to ₹ crore with the printed value, unit and page preserved |
| OCR | Optional tesseract.js (browser) for scanned pages; scanned PDFs without OCR fail with a precise message |
| AI-assisted extraction | Optional per document: sends statement-page *text* to your AI provider; values are kept only if their printed text literally appears on the page |
| Data review | Every figure with source document/page/printed value; edit, enter missing values, choose between conflicting sources, revert; corrections survive reprocessing |
| Data quality | Balance-sheet identity, P&L/cash-flow identities, cash reconciliation, EPS-based unit check, unit jumps, missing years/quarters, basis mismatches, quarter-vs-annual reconciliation, conflicts, duplicates, share-count checks, coverage, transparent score |
| Analysis pages | Executive summary · Revenue & growth · Profitability · Balance sheet · Cash flow · Working capital · Returns & DuPont · Quarterly (16 quarters, TTM, heatmaps, seasonality, reconciliation) · Segments · Sector lens · Earnings quality (red flags, Beneish, Altman Z / Z'') · Management & strategy tracker · Capital allocation · Risk dashboard & heatmap |
| Scores | Financial Health (8 configurable components), Earnings Quality, Balance-Sheet Risk, Capital Allocation, Management Delivery, Valuation Attractiveness — kept separate, with bands, coverage-based confidence and explanations |
| Valuation | Manual price only. Market cap, diluted equity value, EV bridge (leases, NCI, other claims, non-operating assets toggles), 14 multiples with applicability rules, FCFF DCF (5–10 yrs, bear/base/bull, validation incl. g < WACC), WACC builder (CAPM), 2-D sensitivity heatmap, tornado, reverse DCF (bisection), earnings-based grid with *your* P/E, two-stage DDM, residual income, BVPS/TBVPS/adjusted NAV, user-weighted conclusion with configurable thresholds |
| Projections | 5-year bear/base/bull P&L, cash flow, debt, ROCE/ROIC; guidance kept separate from model output |
| AI | Provider-agnostic server route (Anthropic or any OpenAI-compatible API); executive summary, management assessment, risk narrative, valuation interpretation, grounded chat; citations verified; deterministic fallback when no key |
| Exports | Print-friendly report (28 sections), PDF (text tables via jsPDF), Excel workbook (extracted data with sources, all metrics, report tables, metric definitions), CSV per table, JSON backup |

A **synthetic demo** (fictional "Simulated Steel & Power Ltd", every page stamped *SYNTHETIC TEST DATA*) runs the real pipeline on generated PDFs: 4 annual reports (one in ₹ lakh), 20 quarters, one scanned-style PDF.

## 2. Architecture

```
Browser (Next.js client components)                       Server (Next.js route handlers, Node runtime)
┌──────────────────────────────────────────────┐         ┌──────────────────────────────────────────┐
│ PDF → pdf.js (web worker) → layout → parser   │         │ GET  /api/ai/status   (no secrets)       │
│      (+ optional tesseract.js OCR)            │         │ POST /api/ai/chat     grounded prompts   │
│ IndexedDB: projects, docs, extracted text,    │  text   │ POST /api/ai/extract  page-text → JSON   │
│            facts, PDFs (optional)             │ ──────► │   keys from env only, rate-limit,        │
│ Deterministic engine (TypeScript):            │ snippets│   optional APP_ACCESS_TOKEN              │
│  merge → derive → metrics → forensics →       │         └──────────────────────────────────────────┘
│  scores → valuation → projections → DQ        │                     │ (only if configured)
│ UI: Tailwind + Recharts; exports jsPDF/exceljs│                     ▼ Anthropic / OpenAI-compatible API
└──────────────────────────────────────────────┘
```

**Why this design (Vercel constraints):** annual reports are often 20–80 MB and 300+ pages. Parsing them in a serverless function would hit request-size (4.5 MB) and duration limits, so extraction runs **in the browser**. No database, object storage or background job service is required; the only optional external service is the AI provider. The app is a single Next.js project.

## A. Running locally

Requirements: **Node.js 20.9+** (22 LTS recommended) and npm.

Windows PowerShell:
```powershell
Expand-Archive financial-intelligence-lab.zip -DestinationPath .
cd financial-intelligence-lab
npm install
Copy-Item .env.example .env.local   # optional – only for AI
npm run dev
```
macOS / Linux:
```bash
unzip financial-intelligence-lab.zip && cd financial-intelligence-lab
npm install
cp .env.example .env.local          # optional – only for AI
npm run dev
```
Open http://localhost:3000. Production mode: `npm run build` then `npm start`.

## B. Opening the project in VS Code

`File → Open Folder… → financial-intelligence-lab` (or run `code .` in the folder). Recommended extensions: ESLint, Tailwind CSS IntelliSense, Vitest. Use the integrated terminal (`` Ctrl+` ``) for the commands below.

## C. Installing dependencies

```bash
npm install          # installs packages and copies the pdf.js worker into /public (postinstall)
```
If `public/pdf.worker.min.mjs` is ever missing, run `node scripts/copy-pdf-worker.mjs`. Use `npm ci` in CI for a reproducible install from `package-lock.json`.

## D. Configuring AI API keys

AI is **optional**. Without a key the app runs in *deterministic mode*: every calculation, chart, flag, score, valuation and export works; AI narratives are disabled and chat answers with metrics + matching passages instead.

Edit `.env.local` (never commit it):
```ini
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5        # any model id available to your account

# or OpenAI / any OpenAI-compatible endpoint
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1

AI_PROVIDER=                # optional: anthropic | openai | none (auto-detect if blank)
AI_MAX_CONTEXT_CHARS=60000  # cap on text sent per request
APP_ACCESS_TOKEN=           # optional shared secret for public deployments
```
Restart `npm run dev` after editing. The header badge shows **AI on/off**. If you set `APP_ACCESS_TOKEN`, enter the same value in *Settings → AI access token* in each project.

## E. Testing document uploads

1. Home → **Create synthetic demo project** (processes the bundled synthetic PDFs through the real pipeline), or
2. Create a project → *Document centre* → drop PDFs from `fixtures/synthetic/` (also served at `/samples/…`).
   - Put annual reports into slots and set each slot's reporting year.
   - Drop quarterly PDFs into the quarterly zone (multiple at once).
   - Try `SYNTHETIC_scanned_no_text_layer.pdf` to see the scanned-PDF failure path.
3. Check *Data review* (figures + pages) and *Data quality*. Enter a share price on *Valuation*.

Regenerate the samples with `npm run fixtures`.

With real reports: text-based PDFs from the company website / exchange filings work best. Check the per-document messages; use **Unit override**, **Basis override** or **Period hint** when detection fails, and correct any figure in *Data review*.

## F. Uploading the project to GitHub

```bash
git init
git add .
git commit -m "Financial Intelligence Lab"
git branch -M main
git remote add origin https://github.com/<you>/financial-intelligence-lab.git
git push -u origin main
```
(PowerShell uses the same commands.) `.gitignore` excludes `node_modules`, `.next`, `.env*` and the generated pdf worker. Never commit `.env.local`.

## G. Importing the repository into Vercel

A ZIP cannot be deployed to Vercel directly — the extracted source must be in a Git repository (or deployed with the Vercel CLI).

1. https://vercel.com/new → **Import Git Repository** → choose the repo.
2. Framework preset: **Next.js** (auto-detected). Build command `npm run build`, install `npm ci` (also set in `vercel.json`). Root directory: the project folder.

## H. Configuring environment variables in Vercel

Project → **Settings → Environment Variables** → add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`), optionally `ANTHROPIC_MODEL`, `AI_PROVIDER`, `AI_MAX_CONTEXT_CHARS`, `APP_ACCESS_TOKEN`. Apply to Production (and Preview if wanted). Do **not** prefix keys with `NEXT_PUBLIC_`. Redeploy after changing variables.

## I. Deploying

Push to `main` → Vercel builds and deploys automatically. Or with the CLI:
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```
AI routes declare `maxDuration = 60` s (Hobby plans may cap lower; long AI answers can time out — reduce `AI_MAX_CONTEXT_CHARS`).

Self-hosting alternative: `docker compose up --build` (uses `.env.local`).

## J. Troubleshooting

| Symptom | Fix |
|---|---|
| "Setting up fake worker" / PDF won't open | `public/pdf.worker.min.mjs` missing → `node scripts/copy-pdf-worker.mjs`, rebuild |
| "PDF appears to be scanned" | Enable OCR in *Document centre → Processing options* and Reprocess (slow; verify numbers), or use a text PDF |
| "Reporting unit … could not be detected" | Set *Unit override* on the document card |
| "Reporting periods could not be identified" | Annual: confirm the slot year. Quarterly: set *Period hint*; or use AI-assisted extraction; or enter figures in Data review |
| Wrong standalone/consolidated | *Basis override* on the document; switch basis in the header |
| Values 100× off | Unit misread (lakh vs crore) → Data quality shows a unit error → set Unit override |
| Few figures extracted from a real report | Unusual layouts (multi-column statements, images of tables). Use AI-assisted extraction (if configured) and/or Data review |
| Missing share count | Enter it on *Valuation* (absolute number of shares) |
| AI badge "off" on Vercel | Env var not set for that environment, or not redeployed |
| AI 401 / 429 / timeout | Invalid key / rate limit / reduce context |
| Projects vanished | Browser storage was cleared or a different browser/profile is used — import your JSON backup |
| Large PDFs slow | Normal for 300+ pages (text extraction happens on your machine). Split the PDF to statements + MD&A if needed |
| Build fails on Node 18 | Upgrade to Node 20.9+ |

## 4. Testing

```bash
npm test            # 127 unit/integration tests (vitest)
npm run typecheck   # TypeScript, strict
npm run build       # production build
```
Tests cover: Indian number/unit/date/period parsing; line-item recognition; hand-checked ratios (margins, ROE/ROA/ROCE on average balances, DSO/DIO/DPO/CCC, cash conversion, net debt, coverage, DuPont identity); growth & CAGR; missing-data handling (never zero), division-by-zero, negative PAT/EBITDA, zero debt/cash, negative FCF, missing years and quarters; banks; market cap, EV bridge, P/E, EV/EBITDA, PEG rules; DCF (hand-computed: EV 236.25), terminal value, g ≥ WACC rejection, extreme assumptions, mid-year; sensitivity grid; reverse DCF recovering the input growth; DDM (Gordon equivalence); residual income; margin of safety & classification; TTM, Q4 derivation, quarter–annual reconciliation, seasonality; fact merging, conflict retention, user corrections; data-quality checks (unbalanced BS, unit mismatch, unit jumps); Beneish (exact intercept case, no invented SG&A), Altman Z''; full PDF extraction of the synthetic annual reports (crore and lakh), Q1/Q3/Q4 layouts, 8-quarter PDF, scanned PDF, unknown units, non-PDF bytes; end-to-end analysis against generator ground truth; secrets only in server modules; citation verification; CSV formula-injection guard.

Optional browser smoke test (`e2e/smoke.cjs`, needs `npm i -D playwright`): start `node e2e/mock-llm.cjs` (a local OpenAI-compatible **test mock**), then `OPENAI_API_KEY=test OPENAI_BASE_URL=http://127.0.0.1:4011/v1 npm start`, then `BASE_URL=http://localhost:3000 node e2e/smoke.cjs`. It uploads files through the UI, enters a price, generates AI output (checking that an invented citation is flagged), chats, downloads PDF/Excel/CSV/JSON and switches basis.

## 5. Methodology

- **Units:** everything is normalised to ₹ crore; per-share values in ₹; printed values and units are kept for every figure.
- **Selection rule when documents disagree:** user correction → figure from the document whose own period it is (annual report before quarterly result) → most recent document's comparative. All candidates are retained and conflicts flagged.
- **Derived values** (always labelled): total tax = current + deferred; Q4 = FY − 9M if not reported; total debt = non-current + current borrowings; exceptional impact = PBT − profit before exceptional items; shares = paid-up capital ÷ face value; common balance-sheet lines treated as nil only when that period's balance sheet was captured.
- **EBITDA** = revenue − (total expenses − finance costs − D&A) — excludes other income and exceptional items; not a reported Ind AS line.
- **ROCE** = PBIT (pre-exceptional) ÷ average (equity + NCI + debt). **ROIC** = operating EBIT × (1 − tax) ÷ average (equity + NCI + debt − cash). Averages use opening/closing; closing-only fallback is flagged.
- **Scores** map each input linearly between disclosed worst/best bands (per sector profile) and combine with editable weights; components without data are excluded and confidence reduced. Valuation attractiveness is never merged with quality.
- **Valuation** uses only the user-entered price. Bank/NBFC/insurer profiles disable FCFF DCF and EV multiples. Defaults are seeded from history with the basis disclosed; WACC inputs are user assumptions (defaults are placeholders, not market data).

## 6. Privacy & security

- PDFs are processed in the browser and stored only in local IndexedDB (optional). Nothing is uploaded unless you use AI features.
- AI requests send calculated metrics, flags, assumptions and selected **text excerpts** (never files) to the configured provider through the server route; the provider processes them under its own terms.
- Keys live only in server env vars (`import "server-only"`), are never returned by `/api/ai/status`, and tests assert no client module reads them.
- PDF signature + size validation, pdf.js with `isEvalSupported: false`, request-size limits, zod validation, safe error messages, security headers, optional access token, basic rate limiting, CSV formula-injection guard.
- Prompt-injection hardening: document text is wrapped as untrusted data; the model is instructed to ignore embedded instructions; citations are verified; AI extraction keeps only values literally present on the page.

See `/privacy` in the app for the user-facing notice.

## 7. Known limitations

- **Extraction accuracy on real reports varies.** The parser handles standard Schedule III / SEBI LODR layouts (validated on synthetic PDFs that mimic them). Unusual layouts, statements rendered as images, two statements side by side, or wrapped labels may be missed — the app reports what failed and lets you correct values, use AI-assisted extraction, or enter figures manually. It has **not** been validated across a corpus of real Indian annual reports in this build.
- Notes (receivable ageing, debt maturities, related-party amounts, contingent liability totals, retained earnings, SG&A, R&D, order book, NPA amounts) are generally not on the statement face; they are captured as text excerpts and can be entered manually in Data review.
- Segment figures cannot yet be edited manually (only extracted).
- OCR is slow and less accurate; it downloads tesseract language data from its CDN.
- Browser storage is per browser/device; large reports with "keep PDFs" enabled consume quota.
- Sector bands are heuristic, not peer statistics; there is no comparable-company data, so no peer multiples are shown.
- The AI features were tested against a local mock provider in this build, not a live Anthropic/OpenAI key.
- Rate limiting is per serverless instance (best effort).

## 8. Project structure

```
src/
  app/                      Next.js App Router pages and API routes
    page.tsx                projects home, new project, demo, import
    privacy/                privacy notice
    projects/[id]/…         21 analysis pages (summary, documents, data, …, report, settings)
    api/ai/{status,chat,extract}/route.ts
  components/               UI primitives, charts, metric tables, AI panel, project shell/provider
  lib/
    types.ts                domain model
    lineItems.ts            line-item catalogue & label patterns
    extraction/             parseUtils, layout, statementParser, narrative, processor
    engine/                 core, derive, merge, metrics, quarterly, forensics, scores,
                            valuation, projections, dataQuality, risks, management, analyze
    sector/profiles.ts      sector profiles, bands, weights
    store/                  IndexedDB persistence & browser pipeline
    ai/                     server provider, prompts, client context/citations
    export/report.ts        report model, PDF & Excel export
scripts/                    synthetic data + PDF generator, pdf worker copy
fixtures/synthetic/         synthetic test PDFs (also in public/samples)
tests/                      vitest suites
e2e/                        optional Playwright smoke test + mock LLM (testing only)
```
