// v2.3 "İsimsiz sayaç" network proof ([privacy-net]) + band layout + Menü > Gizlilik (guest) + preference survival.
// The built game (dist/) is opened on its REAL production addresses, but every request is answered locally:
//   https://acikofis.teserix.com/                  (root)     -> dist/ (Playwright route)
//   https://thejackaltr.github.io/kodhane-acik-ofis/ (subpath) -> dist/ (GitHub Pages base path)
//   https://analiz.teserix.com/**    -> fake Umami that behaves like the real tracker: pageview on load and on
//                                       pushState/replaceState/popstate, honours umami.disabled + data-before-send, POST /api/send
//   https://supabase.teserix.com/**  -> fake Supabase; POST /rest/v1/rpc/kodhane_count_event is counted
// Safety net: --host-resolver-rules maps all of these hosts to 127.0.0.1:9 (closed port), so nothing can leave the box.
// Every request is recorded with context.on('request').  Usage: npm run build && node tests/smoke/privacy.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const shots = process.env.ACIK_OFIS_CONSENT_SHOTS || '/workspace/consent-screens';
fs.mkdirSync(shots, { recursive: true });
const tr = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/tr.json'), 'utf8'));
const WEBSITE_ID = '5ebd71d2-4e8f-4822-a110-1f2c7d56f94e';
const COUNT_PATH = '/rest/v1/rpc/kodhane_count_event';
const BASES = [['root', 'https://acikofis.teserix.com/'], ['subpath', 'https://thejackaltr.github.io/kodhane-acik-ofis/']];
const SAFETY = ['acikofis.teserix.com', 'thejackaltr.github.io', 'analiz.teserix.com', 'supabase.teserix.com', 'kodhane-api.teserix.com', 'cdn.jsdelivr.net', 'kodhane.teserix.com']
  .map((h) => 'MAP ' + h + ' 127.0.0.1:9').join(', ');
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--host-resolver-rules=' + SAFETY] });
const results = [];
function check(name, cond, info = '') { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info ? ' — ' + info : '')); }
const note = (m) => console.log('     ' + m);

if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ missing: run npm run build first'); process.exit(2); }
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
check('dist/index.html: no static Umami tag', !/<script[^>]*analiz\.teserix\.com/.test(html) && !/data-website-id/.test(html));
const swSrc = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
check('dist/sw.js: cache version 2.3.0-*', /const VERSION = '2\.3\.0-[0-9a-f]{7}-[0-9a-z]+';/.test(swSrc), swSrc.split('\n')[1]);

const FAKE_REAL = `(function () {
  var s = document.currentScript;
  var website = s && s.getAttribute('data-website-id');
  var hook = s && s.getAttribute('data-before-send');
  function disabled() { try { return !!localStorage.getItem('umami.disabled'); } catch (e) { return false; } }
  function base() { return { website: website, hostname: location.hostname, url: location.pathname, title: document.title }; }
  function send(type, payload) {
    if (disabled()) return;
    var fn = hook && window[hook];
    if (typeof fn === 'function') { payload = fn(type, payload); if (!payload) return; }
    fetch('https://analiz.teserix.com/api/send', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type, payload: payload }) }).catch(function () {});
  }
  function pageview() { send('event', base()); }
  var push = history.pushState, rep = history.replaceState;
  history.pushState = function () { var r = push.apply(this, arguments); pageview(); return r; };
  history.replaceState = function () { var r = rep.apply(this, arguments); pageview(); return r; };
  window.addEventListener('popstate', pageview);
  window.umami = { track: function (name, data) { var p = base(); if (typeof name === 'string') { p.name = name; if (data) p.data = data; } send('event', p); } };
  if (document.readyState === 'complete') pageview(); else window.addEventListener('load', pageview);
})();`;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };

function makeNet() {
  const net = { reqs: [] };
  net.counts = () => {
    const u = net.reqs.filter((r) => new URL(r[1]).hostname === 'analiz.teserix.com');
    return { umami: u.length, umami_script: u.filter((r) => new URL(r[1]).pathname === '/script.js').length,
      umami_send: u.filter((r) => new URL(r[1]).pathname === '/api/send' && r[0] === 'POST').length,
      counter: net.reqs.filter((r) => new URL(r[1]).pathname === COUNT_PATH && r[0] === 'POST').length };
  };
  net.external = (host) => [...new Set(net.reqs.map((r) => new URL(r[1])).filter((u) => /^https?:$/.test(u.protocol) && ![host, 'analiz.teserix.com', 'supabase.teserix.com'].includes(u.hostname)).map((u) => u.hostname))];
  return net;
}

async function newCtx(base, net, vp = { viewport: { width: 1280, height: 800 } }, init = null) {
  const ctx = await browser.newContext({ locale: 'tr-TR', serviceWorkers: 'block', ...vp });
  const u = new URL(base);
  await ctx.route('https://' + u.hostname + '/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (!p.startsWith(u.pathname)) return route.fulfill({ status: 404, body: 'not found' });
    let rel = decodeURIComponent(p.slice(u.pathname.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const fp = path.normalize(path.join(dist, rel));
    if (!fp.startsWith(dist) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, headers: { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store' }, body: fs.readFileSync(fp) });
  });
  await ctx.route('https://analiz.teserix.com/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/script.js') {
      if (net.umamiMode === 'fail') return route.abort('connectionrefused');
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: FAKE_REAL });
    }
    if (p === '/api/send') return route.fulfill({ status: 200, headers: CORS, body: '{"ok":true}' });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.route('https://supabase.teserix.com/**', (route) => {
    const r = route.request(), p = new URL(r.url()).pathname;
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (p === COUNT_PATH) return route.fulfill({ status: 200, headers: CORS, body: 'true' });
    return route.fulfill({ status: 200, headers: CORS, body: '[]' });
  });
  ctx.on('request', (r) => net.reqs.push([r.method(), r.url()]));
  if (init) await ctx.addInitScript(init);
  return ctx;
}
async function open(ctx, base) {
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene, null, { timeout: 20000 });
  await p.waitForTimeout(500);
  return p;
}
const telState = (p) => p.evaluate(() => ({ notice: localStorage.getItem('acik_ofis_tel_notice'), pref: localStorage.getItem('acik_ofis_tel'), off: localStorage.getItem('umami.disabled'),
  band: !!document.querySelector('[data-test=tel-banner]'), script: !!document.querySelector('script[data-test=umami-script]') || !!document.querySelector('script[src*="analiz.teserix.com"]'), umami: typeof window.umami }));
// close every open/queued modal the way the game does (removing DOM nodes would break the modal queue)
const closeModals = (p) => p.evaluate(() => { const u = window.__acikOfis.ui; for (let i = 0; i < 10 && u.modalOpen; i++) u.closeModal(); });
async function tapLaptop(p) { const l = await p.evaluate(() => window.__acikOfis.scene.laptopScreen()); await p.mouse.click(l.x, l.y); }
// the real game path (tap laptop -> accept -> first delivery = stage counter) + share + direct counter calls + navigation
async function interact(p, { play = false } = {}) {
  if (play) {
    const st0 = await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone);
    await tapLaptop(p);
    if (await p.waitForSelector('[data-test=accept]', { timeout: 3000 }).catch(() => null)) await p.click('[data-test=accept]');
    for (let i = 0; i < 40 && (await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone)) <= st0; i++) { await tapLaptop(p); await p.waitForTimeout(80); }
  }
  await p.click('[data-test=nav-share]');
  await p.waitForSelector('[data-test=share-img]', { timeout: 5000 }).catch(() => {});
  await closeModals(p);
  return p.evaluate(async () => {
    const A = window.__acikOfis.analytics;
    A.track('login_success'); A.track('cloud_save'); A.track('reset_or_prestige');
    await window.__acikOfis.cloud.client.countEvent('acikofis_stage_3');
    window.__acikOfis.ctrl.emit('count', 'acikofis_stage_4');
    const p0 = location.pathname;
    history.pushState({}, '', p0 + '?nav=1'); history.replaceState({}, '', p0 + '?nav=2');
    await new Promise((r) => { window.addEventListener('popstate', r, { once: true }); history.back(); setTimeout(r, 800); });
    history.replaceState(null, '', p0);
    await new Promise((r) => setTimeout(r, 400));
    return location.pathname;
  });
}
async function menuToggle(p) {
  await closeModals(p);
  await p.click('[data-test=menu]');
  await p.waitForSelector('[data-test=menu-privacy]');
  await p.locator('[data-test=tel-toggle]').scrollIntoViewIfNeeded();
  await p.click('[data-test=tel-toggle]');
  await p.waitForTimeout(300);
  await closeModals(p);
}

// ================================================================ 1) [privacy-net] root + GitHub Pages subpath
for (const [label, base] of BASES) {
  const host = new URL(base).hostname, tag = '[privacy-net][' + label + ']';
  // (a) before the notice is answered
  let net = makeNet();
  let ctx = await newCtx(base, net);
  let p = await open(ctx, base);
  await p.waitForSelector('[data-test=tel-banner]');
  check(tag + ' served under ' + new URL(base).pathname + ', allowed host', (await p.evaluate(() => location.pathname)) === new URL(base).pathname && await p.evaluate(() => window.__acikOfis.analytics.hostOk()));
  await interact(p, { play: true });
  const done = await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone);
  await p.reload(); await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene); await p.waitForSelector('[data-test=tel-banner]');
  await interact(p);
  await p.waitForTimeout(500);
  let c = net.counts(), st = await telState(p);
  check(tag + ' (a) before "Tamam" incl. first delivery (stage counter) + reload: 0 Umami requests, 0 counter RPCs', done >= 1 && c.umami === 0 && c.counter === 0, JSON.stringify([done, c]));
  note(tag + ' (a) counts: ' + JSON.stringify(c) + ' (first delivery played: ' + (done >= 1) + ')');
  check(tag + ' (a) no tracker script, window.umami undefined, notice pending, nothing queued', !st.script && st.umami === 'undefined' && st.notice === null && st.band && (await p.evaluate(() => window.__acikOfis.analytics.queued().length)) === 0, JSON.stringify(st));
  check(tag + ' (a) only the game host requested', net.external(host).length === 0, JSON.stringify(net.external(host)));
  check(tag + ' (a) no page errors', p.errs.length === 0, p.errs.join(' | '));
  // (b) "Kapat"
  await p.click('[data-test=tel-off]'); await p.waitForTimeout(300);
  st = await telState(p);
  check(tag + ' (b) "Kapat": band gone, pref off, umami.disabled set', !st.band && st.notice === '1' && st.pref === 'off' && st.off, JSON.stringify(st));
  await interact(p, { play: true });
  await p.reload(); await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene); await p.waitForTimeout(400);
  await interact(p);
  await p.waitForTimeout(500);
  c = net.counts(); st = await telState(p);
  check(tag + ' (b) after "Kapat" incl. play + reload: 0 Umami requests, 0 counter RPCs, no band, no script', c.umami === 0 && c.counter === 0 && !st.band && !st.script, JSON.stringify([c, st]));
  note(tag + ' (b) counts: ' + JSON.stringify(c));
  check(tag + ' (b) no page errors', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();

  // (+) positive control: "Tamam"
  net = makeNet();
  ctx = await newCtx(base, net);
  p = await open(ctx, base);
  await p.waitForSelector('[data-test=tel-banner]');
  check(tag + ' band accept label is exactly "Tamam"', (await p.textContent('[data-test=tel-ok]')).trim() === 'Tamam');
  await p.click('[data-test=tel-ok]');
  await p.waitForFunction(() => typeof window.umami === 'object', null, { timeout: 8000 });
  await interact(p, { play: true });
  await p.waitForTimeout(800);
  const cOn = net.counts();
  const sattr = await p.evaluate(() => { const s = document.querySelector('script[data-test=umami-script]'); return s && { src: s.src, id: s.getAttribute('data-website-id'), domains: s.getAttribute('data-domains') }; });
  check(tag + ' (+) after "Tamam": 1 script, pageviews + events sent, counter RPCs sent (stage + direct)', cOn.umami_script === 1 && cOn.umami_send >= 7 && cOn.counter >= 3, JSON.stringify(cOn));
  note(tag + ' (+) counts after Tamam: ' + JSON.stringify(cOn));
  check(tag + ' (+) script attributes', sattr && sattr.src === 'https://analiz.teserix.com/script.js' && sattr.id === WEBSITE_ID && sattr.domains === 'acikofis.teserix.com,thejackaltr.github.io', JSON.stringify(sattr));
  // (c) switched off in Menü > Gizlilik (real click)
  await menuToggle(p);
  st = await telState(p);
  check(tag + ' (c) switched off in Menü > Gizlilik: pref off, umami.disabled', st.pref === 'off' && st.off, JSON.stringify(st));
  const c0 = net.counts();
  await interact(p, { play: true });
  await p.waitForTimeout(500);
  const c1 = net.counts();
  check(tag + ' (c) after switching off: 0 new Umami requests, 0 new counter RPCs', c1.umami === c0.umami && c1.counter === c0.counter, JSON.stringify([c0, c1]));
  note(tag + ' (c) new after switch-off: umami=' + (c1.umami - c0.umami) + ' counter=' + (c1.counter - c0.counter));
  // (d) reload while off
  await p.reload(); await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene); await p.waitForTimeout(400);
  await interact(p);
  await p.waitForTimeout(500);
  const c2 = net.counts(); st = await telState(p);
  check(tag + ' (d) reload while off: 0 new Umami requests, 0 new counter RPCs, no script, no band', c2.umami === c0.umami && c2.counter === c0.counter && !st.script && !st.band, JSON.stringify([c0, c2, st]));
  note(tag + ' (d) new after reload while off: umami=' + (c2.umami - c0.umami) + ' counter=' + (c2.counter - c0.counter));
  // re-enable
  await menuToggle(p);
  await p.waitForFunction(() => typeof window.umami === 'object', null, { timeout: 8000 });
  await interact(p);
  await p.waitForTimeout(500);
  const c3 = net.counts();
  check(tag + ' re-enable in Menü resumes (script again, sends + counter)', c3.umami_script === c2.umami_script + 1 && c3.umami_send > c2.umami_send && c3.counter > c2.counter, JSON.stringify([c2, c3]));
  check(tag + ' only game host + intercepted mocks requested', net.external(host).length === 0, JSON.stringify(net.external(host)));
  check(tag + ' no page errors', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

// ================================================================ 2) Umami blocked: game works
{
  const base = BASES[0][1], net = makeNet(); net.umamiMode = 'fail';
  const ctx = await newCtx(base, net, undefined, "localStorage.setItem('acik_ofis_tel_notice','1'); localStorage.setItem('acik_ofis_tel','on');");
  const p = await open(ctx, base);
  await interact(p, { play: true });
  await p.waitForTimeout(300);
  check('umami blocked: game playable (first delivery), share works, nothing queued, no page errors', (await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone)) >= 1
    && (await p.evaluate(() => window.__acikOfis.analytics.queued().length)) === 0 && p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

// ================================================================ 3) layout: band unanswered, nothing covered
const VIS = (sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    if (getComputedStyle(el).position !== 'fixed') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const inside = r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const bad = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy, hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) bad.push([Math.round(x), Math.round(y), hit ? (hit.dataset.test || hit.className || hit.tagName) : null]);
    }
    out.push({ name: el.dataset.test || el.textContent.trim().slice(0, 16), inside, bad });
  }
  return out;
};
const failing = (rows) => rows.filter((r) => !r.inside || r.bad.length);
const VIEWPORTS = [
  ['1280x800', { viewport: { width: 1280, height: 800 } }],
  ['375x667', { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['667x375', { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]
];
for (const [vname, vp] of VIEWPORTS) {
  const base = BASES[0][1], net = makeNet(), tag = '[layout][' + vname + ']';
  const ctx = await newCtx(base, net, vp);
  const p = await open(ctx, base);
  await p.waitForSelector('[data-test=tel-banner]');
  await p.waitForTimeout(600);
  const tapAt = async (x, y) => (vp.hasTouch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
  const band = await p.evaluate(() => document.querySelector('[data-test=tel-banner]').getBoundingClientRect().toJSON());
  let rows = await p.evaluate(VIS, '[data-test=tel-banner] button');
  check(tag + ' band buttons (Tamam, Kapat, Ayrıntılar) visible and on top', rows.length === 3 && !failing(rows).length, JSON.stringify(rows));
  rows = await p.evaluate(VIS, '[data-test^=nav-], [data-test=menu], [data-test=zoom-fit]');
  check(tag + ' bottom nav + menu + fit buttons visible, not under the band', rows.length >= 5 && !failing(rows).length, JSON.stringify(failing(rows)));
  rows = await p.evaluate(VIS, '[data-test=hint]');
  check(tag + ' tutorial hint visible above the band', rows.length === 1 && !failing(rows).length, JSON.stringify(rows));
  // the laptop (first tap target) is framed above the band
  const lap = await p.evaluate(() => window.__acikOfis.scene.laptopScreen());
  const hitLap = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + (e.closest('#game') ? '#game' : '') : null; }, lap);
  check(tag + ' laptop target on the canvas, above the band', hitLap === 'CANVAS#game' && lap.y < band.top - 4 && lap.y > 0, JSON.stringify({ lap, bandTop: band.top, hitLap }));
  await tapAt(lap.x, lap.y);
  const offer = await p.waitForSelector('[data-test=accept]', { timeout: 3000 }).catch(() => null);
  rows = await p.evaluate(VIS, '[data-test=accept]');
  check(tag + ' real tap on the laptop opens the offer; Accept visible above the band', offer && rows.length === 1 && !failing(rows).length, JSON.stringify(rows));
  if (offer) await p.click('[data-test=accept]');
  await p.evaluate(() => { window.__acikOfis.ctrl.state.money = 1e9; window.__acikOfis.ctrl.changed(); });
  await p.click('[data-test=nav-team]'); await p.waitForTimeout(400);
  rows = await p.evaluate(VIS, '.sheet:not(.hidden) button[data-test^=hire-btn-]');
  check(tag + ' team sheet: hire buttons visible above the band (' + rows.length + ')', rows.length >= 1 && !failing(rows).length, JSON.stringify(failing(rows)));
  await p.click('[data-test=nav-office]'); await p.waitForTimeout(400);
  rows = await p.evaluate(VIS, '.sheet:not(.hidden) [data-test=buy-desk], .sheet:not(.hidden) button[data-test^=item-btn-]');
  check(tag + ' office sheet: buy buttons visible above the band (' + rows.length + ')', rows.length >= 1 && !failing(rows).length, JSON.stringify(failing(rows)));
  await p.click('.sheet:not(.hidden) [data-test=buy-desk], .sheet:not(.hidden) button[data-test^=item-btn-] >> nth=0');
  await p.waitForTimeout(400);
  rows = await p.evaluate(VIS, '[data-test=place-cancel]');
  check(tag + ' placement bar: Cancel visible above the band', rows.length === 1 && !failing(rows).length, JSON.stringify(rows));
  if (rows.length) await p.click('[data-test=place-cancel]');
  await p.waitForTimeout(200);
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  check(tag + ' no horizontal overflow', w <= vp.viewport.width, String(w));
  await p.click('[data-test=tel-details]'); await p.waitForSelector('[data-test=tel-details-close]');
  const dbtn = await p.evaluate(VIS, '[data-test=tel-details-close]');
  check(tag + ' details open from the band (notice still pending), Kapat reachable', (await p.evaluate(() => localStorage.getItem('acik_ofis_tel_notice'))) === null && dbtn.length === 1 && !failing(dbtn).length, JSON.stringify(dbtn));
  await p.evaluate(() => { document.querySelector('.modal.tel-details, .tel-details').scrollTop = 0; });
  await p.waitForTimeout(350);
  const sc = await p.evaluate(() => { const m = document.querySelector('.modal-wrap .modal'); const r = m.getBoundingClientRect(); return { scrollable: m.scrollHeight > m.clientHeight + 1, fits: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 }; });
  check(tag + ' details: dialog fits the screen (' + (sc.scrollable ? 'scrolls' : 'no scroll needed') + ')', sc.fits, JSON.stringify(sc));
  await p.screenshot({ path: path.join(shots, 'acikofis-details-' + vname + '.png') });
  await p.evaluate(() => { const m = document.querySelector('.modal-wrap .modal'); m.scrollTop = m.scrollHeight; });
  await p.waitForTimeout(200);
  const lastP = await p.evaluate(VIS, '.modal-wrap .modal p:last-of-type');
  const dbtn2 = await p.evaluate(VIS, '[data-test=tel-details-close]');
  check(tag + ' details: scrolled to the end, last paragraph + Kapat visible and on top', lastP.length >= 1 && lastP[lastP.length - 1].inside && dbtn2.length === 1 && !failing(dbtn2).length, JSON.stringify([lastP, dbtn2]));
  if (sc.scrollable) await p.screenshot({ path: path.join(shots, 'acikofis-details-' + vname + '-scrolled.png') });
  const over = await p.evaluate(() => { const r = document.querySelector('[data-test=tel-banner]').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inUi: !!document.querySelector('#ui > [data-test=tel-banner]'), hitBand: !!(e && e.closest('[data-test=tel-banner]')) }; });
  check(tag + ' band lives in #ui and an open modal covers it (modals/toasts stay on top)', over.inUi && !over.hitBand, JSON.stringify(over));
  await p.click('[data-test=tel-details-close]'); await p.waitForTimeout(200);
  await p.click('[data-test=tel-ok]'); await p.waitForTimeout(400);
  const st = await telState(p);
  check(tag + ' real click on Tamam answers and removes the band', !st.band && st.pref === 'on');
  note(tag + ' band rect ' + JSON.stringify({ top: Math.round(band.top), bottom: Math.round(band.bottom), left: Math.round(band.left), right: Math.round(band.right) }) + ', laptop at ' + JSON.stringify({ x: Math.round(lap.x), y: Math.round(lap.y) }));
  check(tag + ' no page errors', p.errs.length === 0, p.errs.join(' | '));
  await ctx.close();
}

// ================================================================ 4) Menü > Gizlilik for guests + screenshots
for (const [vname, vp] of [VIEWPORTS[0], VIEWPORTS[2]]) {
  const base = BASES[0][1], net = makeNet(), tag = '[guest][' + vname + ']';
  const ctx = await newCtx(base, net, vp);
  const p = await open(ctx, base);
  await p.waitForSelector('[data-test=tel-banner]'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(shots, 'acikofis-band-' + vname + '.png') });
  check('[copy][' + vname + '] band: approved title + body', (await p.textContent('[data-test=tel-banner]')).includes(tr.telemetry.title) && (await p.textContent('[data-test=tel-banner]')).includes(tr.telemetry.body));
  await p.click('[data-test=tel-details]'); await p.waitForSelector('[data-test=tel-details-close]'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(shots, 'acikofis-details-' + vname + '.png') });
  const dtext = await p.textContent('.modal');
  check('[copy][' + vname + '] details: approved title + every paragraph', dtext.includes(tr.telemetry.detailsTitle) && tr.telemetry.details.every((x) => dtext.includes(x)), dtext.slice(0, 200));
  await p.click('[data-test=tel-details-close]');
  check(tag + ' signed out (guest)', await p.evaluate(() => !(window.__acikOfis.cloud && window.__acikOfis.cloud.user)));
  await p.click('[data-test=menu]'); await p.waitForSelector('[data-test=menu-privacy]');
  await p.locator('[data-test=menu-privacy]').scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const box = await p.textContent('[data-test=menu-privacy]');
  const restoreRow = await p.$('[data-test=menu-restore]');
  check(tag + ' Menü > Gizlilik visible for guests (no restore row), switch off before any answer', await p.isVisible('[data-test=menu-privacy]') && await p.isVisible('[data-test=tel-toggle]') && !restoreRow
    && !(await p.isChecked('[data-test=tel-toggle]')) && box.includes(tr.menu.privacy) && box.includes(tr.menu.telemetry) && box.includes(tr.menu.telemetryHint), box);
  const order = await p.evaluate(() => { const m = document.querySelector('[data-test=menu-privacy]'), r = document.querySelector('[data-test=menu-reset]'); return !!(m.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && !m.contains(r) && !r.contains(m); });
  check(tag + ' Gizlilik is its own section, outside and above Baştan başla', order);
  await p.screenshot({ path: path.join(shots, 'acikofis-privacy-guest-' + vname + '.png') });
  await p.click('[data-test=menu-tel-details]'); await p.waitForSelector('[data-test=tel-details-close]');
  check(tag + ' details from Menü: same text, notice still pending', (await p.textContent('.modal')) === dtext && (await p.evaluate(() => localStorage.getItem('acik_ofis_tel_notice'))) === null);
  await p.click('[data-test=tel-details-close]');
  check(tag + ' no requests to Umami/counter', net.counts().umami === 0 && net.counts().counter === 0, JSON.stringify(net.counts()));
  await ctx.close();
}

// ================================================================ 5) [prefs] Baştan başla (+ Geri al) keeps the choice (real UI)
for (const pref of ['off', 'on']) {
  const base = BASES[0][1], net = makeNet();
  const ctx = await newCtx(base, net, undefined, `if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s','1'); localStorage.setItem('acik_ofis_tel_notice','1'); localStorage.setItem('acik_ofis_tel','${pref}'); }`);
  const p = await open(ctx, base);
  await interact(p, { play: true });
  await closeModals(p);
  await p.click('[data-test=menu]'); await p.click('[data-test=menu-reset]');
  const b = await p.locator('[data-test=reset-hold]').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(2300); await p.mouse.up();
  await p.waitForSelector('[data-test=undo-toast]', { timeout: 5000 });
  let st = await telState(p);
  check('[prefs] Baştan başla keeps the choice (' + pref + '), no band', (await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone)) === 0 && st.pref === pref && st.notice === '1' && !st.band, JSON.stringify(st));
  await p.click('[data-test=undo]'); await p.waitForTimeout(500);
  await p.reload(); await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene); await p.waitForTimeout(400);
  st = await telState(p);
  check('[prefs] Geri al + reload keeps the choice (' + pref + '), no band', (await p.evaluate(() => window.__acikOfis.ctrl.state.projectsDone)) >= 1 && st.pref === pref && !st.band, JSON.stringify(st));
  const c = net.counts();
  if (pref === 'off') check('[prefs] off: play + Baştan başla + Geri al sent nothing', c.umami === 0 && c.counter === 0, JSON.stringify(c));
  else check('[prefs] on: reset_or_prestige etc. reached Umami, counter active', c.umami_send >= 3 && c.counter >= 1, JSON.stringify(c));
  await ctx.close();
}

await browser.close();
const pass = results.filter((r) => r[1]).length;
console.log('\nPRIVACY: ' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
