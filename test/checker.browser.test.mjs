import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const COLLECT = 'https://gateway.umami.is/api/send';
const TEST_ID = '11111111-1111-4111-8111-111111111111';
const CHECKED = 'https://checked-site.example/pricing';
const shotDir = '/tmp/cwv-qc';
fs.mkdirSync(shotDir, { recursive: true });

const psiFixture = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1800, distributions: [{ proportion: 0.7 }, { proportion: 0.2 }, { proportion: 0.1 }] },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150, distributions: [{ proportion: 0.8 }, { proportion: 0.15 }, { proportion: 0.05 }] },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, distributions: [{ proportion: 0.9 }, { proportion: 0.08 }, { proportion: 0.02 }] }
    }
  },
  lighthouseResult: {
    categories: { performance: { score: 0.92 }, seo: { score: 0.91 } },
    audits: {
      'largest-contentful-paint': { title: 'Largest Contentful Paint', score: 0.95, displayValue: '1.8 s' },
      'cumulative-layout-shift': { title: 'Cumulative Layout Shift', score: 0.99, displayValue: '0.05' },
      'total-blocking-time': { title: 'Total Blocking Time', score: 0.95, displayValue: '80 ms' },
      'first-contentful-paint': { title: 'First Contentful Paint', score: 0.95, displayValue: '1.2 s' },
      'speed-index': { title: 'Speed Index', score: 0.9, displayValue: '2.1 s' },
      'is-crawlable': { title: 'Page isn’t blocked from indexing', score: 1, scoreDisplayMode: 'binary' },
      canonical: { title: 'Document has a valid rel=canonical', score: 1, scoreDisplayMode: 'binary' },
      'http-status-code': { title: 'Page has successful HTTP status code', score: 1, scoreDisplayMode: 'binary' },
      'document-title': { title: 'Document has a title element', score: 1, scoreDisplayMode: 'binary' },
      'meta-description': { title: 'Document has a meta description', score: 1, scoreDisplayMode: 'binary' },
      'robots-txt': { title: 'robots.txt is valid', score: 1, scoreDisplayMode: 'binary' },
      'crawlable-anchors': { title: 'Links are crawlable', score: 1, scoreDisplayMode: 'binary' },
      'link-text': { title: 'Links have descriptive text', score: 1, scoreDisplayMode: 'binary' },
      'image-alt': { title: 'Image elements have alt attributes', score: 1, scoreDisplayMode: 'binary' },
      hreflang: { title: 'Document has a valid hreflang', score: null, scoreDisplayMode: 'notApplicable' }
    }
  }
};

const defaultKey = fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/DEFAULT_KEY='([^']+)'/)[1];

function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.xml': 'application/xml',
    '.txt': 'text/plain'
  };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('..')) {
      res.writeHead(400);
      res.end();
      return;
    }
    let file = path.join(root, pathname);
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    else if (!path.extname(file) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function overflows(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

async function storageSnapshot(page) {
  return page.evaluate(() => ({
    cookie: document.cookie,
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage)
  }));
}

function wire(page, state) {
  const notes = [];
  page.on('request', req => {
    const url = req.url();
    let host = '';
    try { host = new URL(url).hostname; } catch (e) {}
    const record = { url, method: req.method(), body: req.postData() || '', headers: req.headers() };
    const sameOrigin = host === '127.0.0.1';
    const psi = url.includes('pagespeedonline');
    const analytics = url.startsWith(COLLECT) || url.includes('umami.is') || url.includes('plausible.io');
    if (sameOrigin && url.includes('/analytics-config.js') && state.enabled) {
      notes.push('rewrote-config');
      req.respond({
        status: 200,
        contentType: 'application/javascript',
        body: `window.TOBBY_ANALYTICS=${JSON.stringify({
          enabled: true,
          provider: 'umami',
          endpoint: COLLECT,
          websiteId: TEST_ID
        })};`
      });
      return;
    }
    if (psi) {
      state.psi += 1;
      state.psiUrls.push(url);
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      };
      if (req.method() === 'OPTIONS') {
        req.respond({ status: 204, headers });
        return;
      }
      if (state.psiMode === 'network') {
        req.abort('failed');
        return;
      }
      const bodyFor = {
        rate_limit: { status: 429, body: { error: { message: 'Quota exceeded' } } },
        key: { status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } },
        unreachable: { status: 500, body: { error: { message: 'FAILED_DOCUMENT_REQUEST' } } },
        success: { status: 200, body: psiFixture }
      };
      const picked = bodyFor[state.psiMode] || bodyFor.success;
      req.respond({ status: picked.status, headers, body: JSON.stringify(picked.body) });
      return;
    }
    if (analytics) {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
      };
      if (req.method() === 'OPTIONS') {
        req.respond({ status: 204, headers });
        return;
      }
      state.analytics.push(record);
      req.respond({ status: 200, headers, body: '{}' });
      return;
    }
    if (host === 'www.googleapis.com' || host === 'googleapis.com') {
      const leaked = url.includes('checked-site.example') || url.includes(CHECKED) || url.includes(defaultKey);
      if (leaked) state.other.push(record);
      req.abort('failed');
      return;
    }
    if (!sameOrigin) {
      state.other.push(record);
      req.abort('failed');
      return;
    }
    req.continue();
  });
  return notes;
}

async function openPage(browser, base, state, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  wire(page, state);
  page.on('pageerror', err => state.pageErrors.push(String(err)));
  return page;
}

function freshState() {
  return { enabled: false, psiMode: 'success', psi: 0, psiUrls: [], analytics: [], other: [], pageErrors: [] };
}

test('checker and kit pages: privacy, CTA, mocked success and errors', { timeout: 120000 }, async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const mobile = { width: 390, height: 844, deviceScaleFactor: 1 };
    const narrow = { width: 320, height: 700, deviceScaleFactor: 1 };
    const desktop = { width: 1280, height: 900, deviceScaleFactor: 1 };

    const disabled = freshState();
    const page = await openPage(browser, base, disabled, mobile);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    assert.deepEqual(disabled.pageErrors, []);
    assert.equal(disabled.analytics.length, 0);
    assert.equal(disabled.other.length, 0);
    assert.equal(disabled.psi, 0);
    assert.equal(await overflows(page), false);
    assert.deepEqual(await storageSnapshot(page), { cookie: '', local: [], session: [] });
    const cookies = await page.cookies();
    assert.equal(cookies.length, 0);

    await page.focus('#u');
    await page.type('#u', 'not a url');
    await page.click('#go');
    await page.waitForSelector('#status:not([hidden])');
    const invalidText = await page.$eval('#status', el => el.innerText);
    assert.match(invalidText, /valid URL/);
    assert.equal(await page.$eval('#results', el => el.hidden), true);
    assert.equal(await page.$eval('#u', el => document.activeElement === el), true);
    assert.equal(disabled.psi, 0);
    assert.equal(disabled.analytics.length, 0);
    assert.deepEqual(await storageSnapshot(page), { cookie: '', local: [], session: [] });

    await page.$eval('#u', el => { el.value = ''; });
    await page.type('#u', CHECKED);
    await page.click('#go');
    await page.waitForFunction(() => {
      const results = document.getElementById('results');
      return results && !results.hidden && /Passes Core Web Vitals/.test(results.innerText);
    });
    const resultsText = await page.$eval('#results', el => el.innerText);
    assert.match(resultsText, /1\.8 s/);
    assert.match(resultsText, /150 ms/);
    assert.match(resultsText, /0\.05/);
    assert.match(resultsText, /\$29 USD, one-time/);
    assert.match(resultsText, /from \$5 USD/);
    assert.match(resultsText, /does not run PageSpeed or CrUX/);
    assert.match(resultsText, /checklist is a list you complete yourself/);
    const cta = await page.$eval('a[data-track="kit_cta_checker_results"]', el => ({
      text: el.textContent,
      href: el.getAttribute('href'),
      tag: el.tagName
    }));
    assert.equal(cta.tag, 'A');
    assert.equal(cta.href, '/core-web-vitals-audit-kit/');
    assert.match(cta.text, /\$29 USD/);
    assert.equal(await overflows(page), false);
    const ctaCard = await page.evaluateHandle(() => document.getElementById('h-fix').closest('section'));
    await ctaCard.screenshot({ path: path.join(shotDir, 'checker_mobile_success_cta.png') });
    await ctaCard.dispose();
    assert.equal(disabled.psi, 1);
    assert.equal(disabled.analytics.length, 0);
    assert.equal(disabled.psiUrls.some(url => url.includes('checked-site.example')), true);
    assert.equal(disabled.analytics.some(hit => hit.body.includes(CHECKED) || hit.url.includes(CHECKED)), false);
    const store = await storageSnapshot(page);
    assert.deepEqual(store, { cookie: '', local: [], session: [] });
    assert.equal((await page.cookies()).length, 0);

    const desktopState = freshState();
    const desktopLive = await openPage(browser, base, desktopState, desktop);
    await desktopLive.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await desktopLive.type('#u', CHECKED);
    await desktopLive.click('#go');
    await desktopLive.waitForSelector('a[data-track="kit_cta_checker_results"]');
    assert.equal(await overflows(desktopLive), false);
    await desktopLive.screenshot({ path: path.join(shotDir, 'checker_desktop_success_cta.png'), fullPage: false });
    await desktopLive.evaluate(() => document.querySelector('#h-fix').scrollIntoView());
    await desktopLive.screenshot({ path: path.join(shotDir, 'checker_desktop_cta_section.png') });
    assert.equal(desktopState.analytics.length, 0);

    async function errorCase(mode, pattern, file) {
      const state = freshState();
      state.psiMode = mode;
      const errorPage = await openPage(browser, base, state, mobile);
      await errorPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await errorPage.type('#u', CHECKED);
      await errorPage.click('#go');
      await errorPage.waitForFunction(re => new RegExp(re).test(document.getElementById('status').innerText), {}, pattern.source);
      assert.equal(await errorPage.$eval('#results', el => el.hidden), true);
      assert.equal(state.analytics.length, 0);
      assert.equal(state.other.length, 0);
      assert.deepEqual(await storageSnapshot(errorPage), { cookie: '', local: [], session: [] });
      assert.equal((await errorPage.cookies()).length, 0);
      assert.equal(await overflows(errorPage), false);
      if (file) await (await errorPage.$('#status')).screenshot({ path: path.join(shotDir, file) });
      const text = await errorPage.$eval('#status', el => el.innerText);
      assert.equal(state.psiUrls.some(url => url.includes(encodeURIComponent(CHECKED)) || url.includes('checked-site.example')), true);
      assert.equal(text.includes('AIza'), false);
      await errorPage.close();
    }
    await errorCase('rate_limit', /rate-limiting/, 'checker_mobile_rate_limit.png');
    await errorCase('key', /API key was rejected/, null);
    await errorCase('unreachable', /could not load that page/, null);
    await errorCase('network', /Network error/, null);

    const navState = freshState();
    const navPage = await openPage(browser, base, navState, mobile);
    await navPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await navPage.type('#u', CHECKED);
    await navPage.click('#go');
    await navPage.waitForSelector('a[data-track="kit_cta_checker_results"]');
    await navPage.click('a[data-track="kit_cta_checker_results"]');
    await navPage.waitForSelector('h1');
    assert.match(navPage.url(), /\/core-web-vitals-audit-kit\/?$/);
    assert.equal(navState.analytics.length, 0);
    await navPage.close();
    await page.close();

    const kitState = freshState();
    const kit = await openPage(browser, base, kitState, mobile);
    await kit.goto(base + '/core-web-vitals-audit-kit/', { waitUntil: 'domcontentloaded' });
    await kit.waitForSelector('h1');
    const hero = await kit.$eval('.hero p', el => el.textContent);
    const pageText = await kit.evaluate(() => document.body.innerText);
    assert.doesNotMatch(hero, /15/);
    assert.doesNotMatch(pageText, /15\s*minutes/i);
    assert.match(hero, /inside Google Sheets/);
    assert.match(pageText, /\$29 USD, one-time/);
    assert.match(pageText, /from \$5 USD/);
    assert.match(pageText, /spreadsheet and 17-page PDF/);
    const heroCta = await kit.$eval('a[data-track="kit_cta_kit_hero"]', el => el.textContent);
    const priceCta = await kit.$eval('a[data-track="kit_cta_kit_pricing"]', el => el.textContent);
    assert.match(heroCta, /\$29 USD/);
    assert.match(priceCta, /\$29 USD/);
    assert.equal(kitState.analytics.length, 0);
    assert.equal(kitState.other.filter(hit => !hit.url.includes('127.0.0.1')).length, 0);
    assert.equal(await overflows(kit), false);
    assert.deepEqual(await storageSnapshot(kit), { cookie: '', local: [], session: [] });
    await (await kit.$('section.hero')).screenshot({ path: path.join(shotDir, 'kit_mobile_hero.png') });
    await (await kit.$('#pricing')).screenshot({ path: path.join(shotDir, 'kit_mobile_pricing.png') });
    await kit.setViewport(narrow);
    assert.equal(await overflows(kit), false, 'kit page overflows at 320px');
    await kit.setViewport(desktop);
    assert.equal(await overflows(kit), false);
    await kit.close();

    const narrowChecker = freshState();
    const narrowPage = await openPage(browser, base, narrowChecker, narrow);
    await narrowPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await narrowPage.type('#u', CHECKED);
    await narrowPage.click('#go');
    await narrowPage.waitForSelector('a[data-track="kit_cta_checker_results"]');
    assert.equal(await overflows(narrowPage), false, 'checker overflows at 320px');
    await narrowPage.close();

    const enabled = freshState();
    enabled.enabled = true;
    const tracked = await openPage(browser, base, enabled, mobile);
    await tracked.goto(base + '/?url=' + encodeURIComponent(CHECKED), { waitUntil: 'domcontentloaded' });
    await tracked.waitForFunction(() => /Passes Core Web Vitals/.test(document.body.innerText));
    await tracked.click('a[data-track="kit_cta_checker_results"]');
    await tracked.waitForFunction(() => typeof window.tobbyTrack === 'function' && /Audit Core Web Vitals/.test(document.body.innerText));
    assert.deepEqual(await storageSnapshot(tracked), { cookie: '', local: [], session: [] });
    assert.equal((await tracked.cookies()).length, 0);
    assert.equal(enabled.pageErrors.length, 0);
    await tracked.$eval('a[data-track="kit_cta_kit_hero"]', el => el.click()).catch(() => {});
    const until = Date.now() + 4000;
    while (Date.now() < until && !enabled.analytics.some(hit => (hit.body || '').includes('kit_cta_kit_hero'))) {
      await new Promise(r => setTimeout(r, 50));
    }
    const names = enabled.analytics.map(hit => {
      const body = JSON.parse(hit.body);
      return body.payload.name || 'pageview';
    });
    assert.ok(names.includes('pageview'));
    assert.ok(names.includes('checker_start'));
    assert.ok(names.includes('checker_success'));
    assert.ok(names.includes('kit_cta_checker_results'));
    assert.ok(names.includes('kit_cta_kit_hero'));
    for (const hit of enabled.analytics) {
      assert.equal(hit.url.split('?')[0], COLLECT);
      assert.equal(hit.method, 'POST');
      assert.equal(hit.headers.referer || '', '');
      assert.equal(hit.headers['x-umami-cache'], undefined);
      assert.equal(hit.body.includes(CHECKED), false);
      assert.equal(hit.body.includes('checked-site.example'), false);
      assert.equal(hit.body.includes(defaultKey), false);
      assert.equal(hit.body.includes('AIza'), false);
      assert.equal(hit.body.includes('?'), false);
      assert.equal(hit.url.includes(CHECKED), false);
      assert.equal(hit.url.includes(defaultKey), false);
      const payload = JSON.parse(hit.body).payload;
      assert.match(payload.url, /^\/[A-Za-z0-9._/-]*$/);
      assert.equal(payload.referrer, undefined);
      assert.equal(payload.id, undefined);
      assert.equal(payload.website, TEST_ID);
    }
    assert.equal(enabled.psiUrls.every(url => !url.startsWith(COLLECT)), true);
    await tracked.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
