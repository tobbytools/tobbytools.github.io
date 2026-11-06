import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const analyticsSrc = fs.readFileSync(new URL('analytics.js', root), 'utf8');
const configSrc = fs.readFileSync(new URL('analytics-config.js', root), 'utf8');
const COLLECT = 'https://gateway.umami.is/api/send';
const DOC_EXAMPLE_ID = '94db1cb1-74f4-4a40-ad6c-962362670409';
const TEST_ID = '11111111-1111-4111-8111-111111111111';
const CHECKED = 'https://checked-site.example/pricing';
const KEY = 'AIzaSyTESTKEY123456789012345';

function boot(overrides = {}) {
  const calls = [];
  const cookieWrites = [];
  const listeners = [];
  const fields = {
    u: overrides.urlValue || '',
    k: overrides.keyValue || ''
  };
  let cookie = '';
  const document = {
    readyState: overrides.readyState || 'interactive',
    getElementById(id) {
      if (!(id in fields) && overrides.missingFields) return null;
      return { value: fields[id] || '' };
    },
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    }
  };
  Object.defineProperty(document, 'cookie', {
    get() { return cookie; },
    set(value) { cookieWrites.push(value); cookie = String(value); }
  });
  const fetch = async (url, init) => {
    const call = { url, init, jsonReads: 0, cancelled: false };
    calls.push(call);
    return {
      ok: true,
      json() { call.jsonReads += 1; return { cache: 'persist-me', sessionId: 'sess-1', visitId: 'visit-1' }; },
      body: { cancel() { call.cancelled = true; } }
    };
  };
  const sandbox = {
    window: {},
    document,
    location: {
      pathname: overrides.pathname ?? '/',
      hostname: overrides.hostname ?? 'tobbytools.github.io',
      search: overrides.search ?? '',
      hash: overrides.hash ?? ''
    },
    navigator: {
      doNotTrack: overrides.doNotTrack ?? null,
      globalPrivacyControl: overrides.gpc === true
    },
    fetch,
    URLSearchParams
  };
  sandbox.window.doNotTrack = overrides.windowDoNotTrack;
  sandbox.window.document = document;
  sandbox.window.fetch = fetch;
  sandbox.window.navigator = sandbox.navigator;
  if (overrides.config) sandbox.window.TOBBY_ANALYTICS = overrides.config;
  vm.runInNewContext(analyticsSrc, sandbox, { filename: 'analytics.js' });
  return { calls, cookieWrites, listeners, fields, sandbox };
}

function validConfig(extra = {}) {
  return { enabled: true, provider: 'umami', endpoint: COLLECT, websiteId: TEST_ID, ...extra };
}

function parsed(call) {
  return JSON.parse(call.init.body);
}

test('adapter source does not touch storage, cookies, or sendBeacon', () => {
  assert.equal(/localStorage|sessionStorage|document\.cookie|sendBeacon/.test(analyticsSrc), false);
});

test('shipped config has no endpoint and is disabled', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(configSrc, sandbox, { filename: 'analytics-config.js' });
  const cfg = sandbox.window.TOBBY_ANALYTICS;
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.provider, 'umami');
  assert.equal(cfg.endpoint, '');
  assert.equal(cfg.websiteId, '');
  assert.equal(configSrc.includes(DOC_EXAMPLE_ID), false);
  assert.equal(configSrc.includes(TEST_ID), false);
});

test('disabled config makes no request and writes no cookie', () => {
  const { calls, cookieWrites, sandbox } = boot({ config: { enabled: false, provider: 'umami', endpoint: '', websiteId: '' } });
  assert.equal(typeof sandbox.window.tobbyTrack, 'function');
  sandbox.window.tobbyTrack('checker_success');
  sandbox.window.tobbyTrack('pageview');
  sandbox.window.tobbyTrack(CHECKED);
  assert.equal(calls.length, 0);
  assert.equal(cookieWrites.length, 0);
});

test('incomplete or non-umami config never sends', () => {
  const cases = [
    validConfig({ enabled: false }),
    validConfig({ websiteId: '' }),
    validConfig({ websiteId: 'your-website-id' }),
    validConfig({ websiteId: DOC_EXAMPLE_ID }),
    validConfig({ endpoint: '' }),
    validConfig({ endpoint: 'http://gateway.umami.is/api/send' }),
    validConfig({ endpoint: 'https://example.com/api/send' }),
    validConfig({ endpoint: 'https://gateway.umami.is/api/send?x=1' }),
    validConfig({ provider: 'plausible' }),
    validConfig({ provider: '' })
  ];
  for (const config of cases) {
    const { calls, sandbox } = boot({ config, readyState: 'loading' });
    sandbox.window.tobbyTrack('pageview');
    sandbox.window.tobbyTrack('checker_success');
    sandbox.window.tobbyTrack(CHECKED);
    assert.equal(calls.length, 0, JSON.stringify(config));
  }
});

test('Do Not Track and Global Privacy Control skip a complete config', () => {
  for (const overrides of [{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { windowDoNotTrack: '1' }, { gpc: true }]) {
    const { calls } = boot({ config: validConfig(), ...overrides });
    assert.equal(calls.length, 0, JSON.stringify(overrides));
  }
});

test('enabled pageview and checker events omit urls, keys, referrers, and ids', async () => {
  const { calls, cookieWrites } = boot({
    config: validConfig(),
    readyState: 'loading',
    search: '?url=' + encodeURIComponent(CHECKED),
    urlValue: CHECKED,
    keyValue: KEY
  });
  assert.equal(calls.length, 0);
  const armed = boot({
    config: validConfig(),
    search: '?url=' + encodeURIComponent(CHECKED),
    urlValue: CHECKED,
    keyValue: KEY
  });
  armed.sandbox.window.tobbyTrack('checker_start');
  armed.sandbox.window.tobbyTrack('checker_success');
  armed.sandbox.window.tobbyTrack('checker_error_rate_limit');
  armed.sandbox.window.tobbyTrack('not_an_event');
  armed.sandbox.window.tobbyTrack(CHECKED);
  armed.sandbox.window.tobbyTrack(KEY);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(armed.calls.length, 4);
  const names = armed.calls.map(call => parsed(call).payload.name ?? 'pageview');
  assert.deepEqual(names, ['pageview', 'checker_start', 'checker_success', 'checker_error_rate_limit']);
  for (const call of armed.calls) {
    assert.equal(call.url, COLLECT);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.referrerPolicy, 'no-referrer');
    assert.equal(call.init.headers['x-umami-cache'], undefined);
    assert.equal(call.cancelled, true);
    assert.equal(call.jsonReads, 0);
    const body = parsed(call);
    const serialized = JSON.stringify(body);
    assert.equal(body.type, 'event');
    assert.equal(body.payload.website, TEST_ID);
    assert.equal(body.payload.hostname, 'tobbytools.github.io');
    assert.equal(body.payload.url, '/');
    assert.equal(Object.hasOwn(body.payload, 'referrer'), false);
    assert.equal(Object.hasOwn(body.payload, 'id'), false);
    assert.equal(Object.hasOwn(body.payload, 'data'), false);
    assert.equal(Object.hasOwn(body.payload, 'screen'), false);
    assert.equal(serialized.includes(CHECKED), false);
    assert.equal(serialized.includes('checked-site.example'), false);
    assert.equal(serialized.includes(KEY), false);
    assert.equal(serialized.includes('AIza'), false);
    assert.equal(serialized.includes('?'), false);
    assert.equal(serialized.includes('sessionId'), false);
    assert.equal(call.init.body.includes(CHECKED), false);
  }
  assert.equal(armed.cookieWrites.length, 0);
  assert.equal(cookieWrites.length, 0);
});

test('kit clicks send only an allowlisted name', async () => {
  const { calls, listeners } = boot({
    config: validConfig(),
    pathname: '/core-web-vitals-audit-kit/',
    urlValue: CHECKED
  });
  const click = listeners.find(item => item.type === 'click');
  assert.equal(click.capture, true);
  const fire = name => click.fn({
    target: {
      closest(sel) {
        assert.equal(sel, '[data-track]');
        return name ? { getAttribute: () => name } : null;
      }
    }
  });
  fire('kit_cta_kit_hero');
  fire(CHECKED);
  fire('checker_success');
  fire('kit_cta_kit_pricing');
  await new Promise(r => setTimeout(r, 0));
  const names = calls.map(call => parsed(call).payload.name ?? 'pageview');
  assert.deepEqual(names, ['pageview', 'kit_cta_kit_hero', 'kit_cta_kit_pricing']);
  assert.equal(JSON.stringify(calls).includes(CHECKED), false);
});

test('a pathname or host that is not a plain path is dropped', () => {
  const bad = [
    { pathname: '/?url=https://checked-site.example' },
    { pathname: '/search#frag' },
    { hostname: 'tobbytools.github.io/?url=1' },
    { hostname: '' }
  ];
  for (const overrides of bad) {
    const { calls } = boot({ config: validConfig(), ...overrides });
    assert.equal(calls.length, 0, JSON.stringify(overrides));
  }
});
