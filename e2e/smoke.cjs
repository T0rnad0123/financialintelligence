// Optional browser smoke test (not part of `npm test`).
// Requires: npm i -D playwright && npx playwright install chromium
// Run against a server started with an AI provider pointing at e2e/mock-llm.cjs (see README).
const { chromium } = require('playwright');
const path = require('path');
const S = path.join(__dirname, '..', 'fixtures', 'synthetic') + path.sep;
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  // 1. Manual project with real uploads through the file inputs
  await page.goto(BASE + '/');
  await page.fill('#n', 'Upload Test Co (synthetic)');
  await page.selectOption('#sec', 'metals');
  await page.getByText('Create project & upload documents').click();
  await page.waitForURL(/documents$/);
  const inputs = page.locator('input[data-testid="annual-input"]');
  await inputs.first().waitFor({ state: 'attached' });
  await inputs.nth(3).setInputFiles(S + 'SYNTHETIC_AnnualReport_FY2023-24.pdf'); // slot FY4
  await page.locator('input[data-testid="quarterly-input"]').setInputFiles([S + 'SYNTHETIC_Q3_FY2023-24_Results.pdf', S + 'SYNTHETIC_Q4_FY2023-24_Results.pdf', S + 'SYNTHETIC_scanned_no_text_layer.pdf']);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="doc-card"]').length === 4 && ![...document.querySelectorAll('[data-testid="doc-card"]')].some(e => /processing|uploading|Queued/.test(e.textContent)), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const cards = await page.locator('[data-testid="doc-card"]').allInnerTexts();
  cards.forEach(c => console.log('CARD:', c.split('\n').slice(0, 3).join(' | ')));
  await page.screenshot({ path: OUT + '/upload.png', fullPage: true });
  // 2. Valuation: enter price
  const base = page.url().replace(/\/documents$/, '');
  await page.goto(base + '/valuation');
  await page.fill('#price', '1500');
  await page.waitForTimeout(1200);
  const val = await page.locator('main').innerText();
  console.log('valuation has fair value:', /FAIR VALUE \/ SHARE\s*₹\d/i.test(val), 'verdict:', (val.match(/Potentially \w+|Approximately fairly valued|Insufficient data for a reliable conclusion/) || [])[0]);
  await page.screenshot({ path: OUT + '/valuation.png', fullPage: true });
  // 3. Data review: correct a value
  await page.goto(base + '/data');
  await page.waitForTimeout(800);
  // 4. AI summary with mock provider
  await page.goto(base);
  await page.getByRole('button', { name: /Generate/ }).click();
  await page.waitForSelector('text=verified citation', { timeout: 20000 });
  console.log('AI panel:', (await page.locator('text=unverifiable citation').count()) > 0 ? 'invalid citation flagged' : 'no flag');
  // 5. Chat
  await page.goto(base + '/chat');
  await page.getByText('Is debt becoming a concern?').click();
  await page.waitForSelector('text=Thinking…', { state: 'detached', timeout: 20000 });
  console.log('chat ok:', (await page.locator('text=unverifiable citation').count()) > 0 ? 'invented citation flagged' : 'no flag');
  // 6. Report exports
  await page.goto(base + '/report');
  for (const label of ['Download PDF', 'Excel', 'Metrics CSV', 'Project backup']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: label }).click()]);
    const p = OUT + '/' + dl.suggestedFilename();
    await dl.saveAs(p);
    console.log('download', label, dl.suggestedFilename(), require('fs').statSync(p).size);
  }
  // 7. Basis switch to standalone shows insufficient data gracefully
  await page.goto(base + '/profitability');
  await page.selectOption('header select >> nth=0', 'standalone');
  await page.waitForTimeout(800);
  console.log('standalone insufficient shown:', (await page.locator('text=Insufficient data').count()) > 0);
  await page.selectOption('header select >> nth=0', 'consolidated');
  console.log('ERRORS', JSON.stringify(errors.slice(0, 20), null, 1));
  await browser.close();
})().catch(e => { console.error('E2E FAILED', e); process.exit(1); });
