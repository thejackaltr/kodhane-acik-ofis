// Headless-browser smoke test (mobile 390x844 touch + desktop 1280x800 mouse) against the production build.
// Usage: npm run build && node tests/smoke/smoke.mjs [baseUrl]   (without baseUrl it starts `vite preview`)
// Writes screenshots to screenshots/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grownSave, ajansSave } from './grown.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
let base = process.argv[2];
let server = null;
if (!base) {
  server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: root, stdio: 'ignore' });
  base = 'http://localhost:4174/';
  await new Promise((r) => setTimeout(r, 2500));
}
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
// v2: every context talks to a FAKE Supabase (nothing is counted or written on the real backend, also in the live smoke).
// Counter calls are recorded per context; the leaderboard RPC answers with fake rows. A context may add its own route
// afterwards (Playwright runs the newest matching route first).
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
async function fakeBackend(ctx) {
  const f = { counts: [], lbCalls: [], lb: [], profile: null, profilePosts: [], saves: [] };
  await ctx.route('https://supabase.teserix.com/**', async (route) => {
    const r = route.request(), u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS, body: '' });
    const body = () => { try { return JSON.parse(r.postData() || 'null'); } catch (e) { return null; } };
    if (u.pathname === '/rest/v1/rpc/kodhane_count_event') { f.counts.push(body().p_event); return route.fulfill({ status: 200, headers: CORS, body: 'true' }); }
    if (u.pathname === '/rest/v1/rpc/kodhane_leaderboard') { f.lbCalls.push({ body: body(), auth: r.headers()['authorization'] || '' }); return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(f.lb) }); }
    if (u.pathname === '/rest/v1/kodhane_profiles' && r.method() === 'GET') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(f.profile ? [f.profile] : []) });
    if (u.pathname === '/rest/v1/kodhane_profiles' && r.method() === 'POST') { const b = body(); f.profilePosts.push(b); f.profile = { nickname: b.nickname, hidden: false }; return route.fulfill({ status: 201, headers: CORS, body: '' }); }
    if (u.pathname === '/rest/v1/acik_ofis_saves' && r.method() === 'GET') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(f.saves) });
    if (u.pathname === '/rest/v1/acik_ofis_saves' && r.method() === 'POST') { const b = body(); f.saves = [{ data: b.data, save_version: b.save_version, updated_at: b.updated_at }]; return route.fulfill({ status: 201, headers: CORS, body: '' }); }
    return route.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  return f;
}
const newContextReal = browser.newContext.bind(browser);
browser.newContext = async (opts) => { const c = await newContextReal(opts); c.fake = await fakeBackend(c); return c; };
const FAKE_SESSION = JSON.stringify({ access_token: 'fake', refresh_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-0000-0000-000000000002', email: 'smoke@example.invalid' } });
function check(name, cond, info = '') { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); }

// count WebGL draw calls per frame
const drawCounter = () => {
  window.__draws = { frames: 0, calls: 0, cur: 0 };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawElements', 'drawArrays']) {
      const orig = C.prototype[fn];
      C.prototype[fn] = function (...a) { window.__draws.cur++; return orig.apply(this, a); };
    }
  }
  const loop = () => { if (window.__draws.cur) { window.__draws.frames++; window.__draws.calls += window.__draws.cur; window.__draws.max = Math.max(window.__draws.max || 0, window.__draws.cur); } window.__draws.cur = 0; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
};

async function ready(p) { await p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene, null, { timeout: 20000 }); await p.waitForTimeout(400); }
const S = (p) => p.evaluate(() => { const s = window.__acikOfis.ctrl.state; return { money: s.money, staff: s.staff.length, desks: s.desks.length, projects: s.projects.length, offers: s.offers.length, done: s.projectsDone, step: s.tutorial.step, tdone: s.tutorial.done, taps: s.taps }; });

// ================================================================ mobile
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(drawCounter);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await p.goto(base);
  await ready(p);
  check('m: boots, canvas present', await p.$('#game canvas'));
  check('m: first hint', (await p.textContent('[data-test=hint]')) === 'Laptop açık, çay demde. İlk müşteri kapıda.');
  const lap = await p.evaluate(() => window.__acikOfis.scene.laptopScreen());
  await p.touchscreen.tap(lap.x, lap.y);
  await p.waitForSelector('[data-test=accept]', { timeout: 3000 });
  check('m: tapping laptop opens first offer', (await p.textContent('[data-test=offer]')).includes('Kafe menüsü sitesi'));
  await p.tap('[data-test=accept]');
  await p.waitForTimeout(200);
  check('m: hint 2 after accepting', (await p.textContent('[data-test=hint]')) === 'Kafe menüsü için site istiyorlar. Başla!');
  for (let i = 0; i < 30 && (await S(p)).done < 1; i++) { await p.touchscreen.tap(lap.x, lap.y); await p.waitForTimeout(90); }
  let st = await S(p);
  check('m: first delivery, first money', st.done === 1 && st.money >= 90, JSON.stringify(st));
  await p.waitForTimeout(300);
  check('m: first delivery counts acikofis_stage_0 once (anonymous counter, fake backend)', JSON.stringify(ctx.fake.counts) === '["acikofis_stage_0"]', JSON.stringify(ctx.fake.counts));
  check('m: hint 3 (stajyer)', (await p.textContent('[data-test=hint]')) === 'Yalnız yetişmiyor. Bir stajyer al?');
  await p.tap('[data-test=nav-team]');
  await p.tap('[data-test=hire-btn-stajyer]');
  await p.waitForTimeout(300);
  check('m: placement mode with desk hint (touch: dokun)', (await p.textContent('[data-test=hint]')) === 'Stajyerin masa istiyor. Boş bir yere dokun.', await p.textContent('[data-test=hint]'));
  const spot = await p.evaluate(() => { const s = window.__acikOfis.scene; const h = s.hl.filter((x) => x.visible)[2]; return s.worldToCss(h.x, h.y); });
  await p.touchscreen.tap(spot.x, spot.y);
  await p.waitForTimeout(2600);
  st = await S(p);
  check('m: first employee hired at a new desk', st.staff === 2 && st.desks === 2, JSON.stringify(st));
  await p.waitForFunction(() => window.__acikOfis.ctrl.state.offers.length > 0, null, { timeout: 20000 });
  await p.tap('[data-test=nav-offers]');
  await p.tap('[data-test=accept]');
  await p.waitForTimeout(900);
  const working = await p.evaluate(() => { const sc = window.__acikOfis.scene; const s = window.__acikOfis.ctrl.state.staff.find((x) => x.type === 'stajyer'); const o = sc.staffSprites.get(s.id); return { frame: o.frame.name, proj: s.projectId, x: o.x, y: o.y, seat: sc.seatPos(s.deskId) }; });
  const elapsed = (Date.now() - t0) / 1000;
  check('m: intern is working at the desk (typing frames)', /calisan_stajyer_calis_0[12]/.test(working.frame) && working.proj != null && Math.abs(working.x - working.seat.x) < 1 && Math.abs(working.y - working.seat.y) < 1, JSON.stringify(working));
  check('m: first hire + working within 5 minutes', elapsed < 300, elapsed.toFixed(1) + ' s (real time, scripted)');
  st = await S(p);
  check('m: tutorial done, hint gone', st.tdone && (await p.$eval('[data-test=hint]', (e) => e.classList.contains('hidden'))), JSON.stringify(st));
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(shots, 'office-early-mobile.png') });

  // event card (fast-forward play time to minute 3)
  await p.evaluate(() => { window.__acikOfis.ctrl.state.playSec = 175; });
  await p.waitForSelector('[data-test=event-text]', { timeout: 5000 });
  check('m: first event card is the logo one', (await p.textContent('[data-test=event-text]')) === 'Müşteri: Logoyu biraz daha büyütebilir miyiz?');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(shots, 'event-card-mobile.png') });
  await p.tap('[data-test=event-a]');
  await p.waitForTimeout(300);
  check('m: event card closes after a choice', !(await p.$('[data-test=event-text]')));

  // cloud ask around minute 5 (UI only; no request sent)
  await p.evaluate(() => { window.__acikOfis.ctrl.state.playSec = 301; });
  await p.waitForSelector('[data-test=cloud-ask]', { timeout: 5000 });
  check('m: cloud save offer text', (await p.textContent('[data-test=cloud-ask]')) === 'Ofisin büyüyor. Kaybolmasın mı? E-postanı yaz, kodu gönderelim.');
  await p.fill('[data-test=cloud-email]', 'yanlis-adres');
  await p.tap('[data-test=cloud-send]');
  await p.waitForTimeout(200);
  check('m: bad e-mail rejected locally', (await p.textContent('[data-test=cloud-msg]')).includes('Geçerli bir e-posta'));
  await p.screenshot({ path: path.join(shots, 'cloud-offer-mobile.png') });
  await p.tap('[data-test=cloud-later]');

  // share
  await p.tap('[data-test=nav-share]');
  await p.waitForSelector('[data-test=share-img]', { timeout: 8000 });
  await p.waitForTimeout(500);
  const share = await p.evaluate(() => window.__lastShare);
  check('m: share image composed 1080x1080', share && share.width === 1080 && share.height === 1080);
  check('m: share text (v1.0.1)', share && share.text === "Kodhane: Açık Ofis'te ekibim " + st.staff + ' kişi oldu, ' + (await S(p)).done + ' proje teslim ettik. Sen de ofisini kur:', share && share.text);
  check('m: share URL has UTM', share && share.url.includes('utm_source=share&utm_medium=office&utm_campaign=acik-ofis'), share && share.url);
  await p.screenshot({ path: path.join(shots, 'share-preview-mobile.png') });
  const dlP = p.waitForEvent('download', { timeout: 15000 });
  await p.tap('[data-test=share-download]');
  const dl = await dlP;
  const dlPath = await dl.path();
  check('m: fallback download gives a PNG', dl.suggestedFilename() === 'acik-ofis.png' && fs.readFileSync(dlPath).subarray(1, 4).toString() === 'PNG');
  await p.tap('[data-test=share-copy]');
  await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('m: copy link fallback', clip.includes('utm_campaign=acik-ofis'), clip.slice(0, 80));
  const dataUrl = await p.$eval('[data-test=share-img]', (i) => i.src);
  fs.writeFileSync(path.join(shots, 'share-image.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));

  // save/load
  const before = await S(p);
  await p.evaluate(() => window.__acikOfis.ctrl.save());
  await p.reload(); await ready(p);
  const after = await S(p);
  check('m: save/load keeps team, desks, projects', after.staff === before.staff && after.desks === before.desks && after.done === before.done && Math.abs(after.money - before.money) < 50, JSON.stringify([before, after]));

  // offline earnings: pretend we left 2 h ago
  await p.evaluate(() => { const c = window.__acikOfis.ctrl; c.save(); const raw = JSON.parse(localStorage.getItem('acik_ofis_save_v1')); raw.lastTick -= 2 * 3600e3; localStorage.setItem('acik_ofis_save_v1', JSON.stringify(raw)); window.__noSave = true; c.resetting = true; });
  await p.reload(); await ready(p);
  const wtxt = await p.textContent('[data-test=welcome-text]').catch(() => '');
  const off = await S(p);
  check('m: welcome-back popup after 2 h', /^Sen yokken/.test(wtxt), wtxt);
  check('m: offline earnings added', off.money > after.money + 100 && off.done > after.done, JSON.stringify([after.money, off.money, after.done, off.done]));
  await p.screenshot({ path: path.join(shots, 'welcome-back-mobile.png') });

  // PWA
  const man = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.json(); });
  check('pwa: manifest relative start_url/scope + icons', man.start_url === './' && man.scope === './' && man.display === 'standalone' && man.icons.some((i) => i.sizes === '512x512'));
  check('pwa: apple-touch-icon + iOS meta', await p.$('link[rel=apple-touch-icon]') && await p.$('meta[name=apple-mobile-web-app-capable]'));
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active, ctl: !!navigator.serviceWorker.controller }; });
  check('pwa: service worker active', sw.active, JSON.stringify(sw));
  await p.reload(); await ready(p);
  await ctx.setOffline(true);
  await p.reload(); await ready(p).catch(() => {});
  check('pwa: works offline (reload while offline)', await p.$('#game canvas') && await p.evaluate(() => !!window.__acikOfis), '');
  await ctx.setOffline(false);
  const draws = await p.evaluate(() => window.__draws);
  check('perf: draw calls per frame (mobile, early office)', draws.frames > 0 && draws.calls / draws.frames < 12, 'avg ' + (draws.calls / draws.frames).toFixed(1) + ', max ' + draws.max);
  check('m: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ grown office (mobile + desktop)
for (const vp of [{ name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { name: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }]) {
  const ctx = await browser.newContext({ ...vp, locale: 'tr-TR' });
  await ctx.addInitScript(drawCounter);
  const save = grownSave(Date.now());
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, save);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base); await ready(p);
  await p.waitForTimeout(1500);
  const st = await S(p);
  check(vp.name + ': grown save loads (Butik Stüdyo, 15 people)', st.staff === 15 && (await p.textContent('.hud-stage')) === 'Butik Stüdyo', JSON.stringify(st));
  await p.screenshot({ path: path.join(shots, 'office-grown-' + vp.name + '.png') });
  const fps = await p.evaluate(() => new Promise((r) => { const g = window.__acikOfis.game; setTimeout(() => r(g.loop.actualFps), 2500); }));
  const draws = await p.evaluate(() => window.__draws);
  check(vp.name + ': draw calls per frame (grown office)', draws.calls / draws.frames < 16, 'avg ' + (draws.calls / draws.frames).toFixed(1) + ', max ' + draws.max + ', fps(swiftshader) ' + fps.toFixed(0));
  if (vp.name === 'desktop') {
    const lap = await p.evaluate(() => window.__acikOfis.scene.laptopScreen());
    const t0 = (await S(p)).taps;
    await p.mouse.click(lap.x, lap.y);
    await p.waitForTimeout(200);
    check('d: mouse click on laptop works', (await S(p)).taps === t0 + 1 || (await S(p)).projects === 0);
    const z0 = await p.evaluate(() => window.__acikOfis.scene.userZoom);
    await p.mouse.move(640, 400); await p.mouse.wheel(0, -300); await p.waitForTimeout(200);
    check('d: wheel zoom', (await p.evaluate(() => window.__acikOfis.scene.userZoom)) > z0);
    await p.mouse.move(640, 400); await p.mouse.down(); await p.mouse.move(540, 350, { steps: 5 }); await p.mouse.up();
    // long press on an employee opens the info card
    const emp = await p.evaluate(() => { const sc = window.__acikOfis.scene; const o = [...sc.staffSprites.values()][3]; return sc.worldToCss(o.x, o.y - 20); });
    await p.mouse.move(emp.x, emp.y); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
    await p.waitForTimeout(200);
    check('d: long-press opens info card', !!(await p.$('.modal .info-head')));
    await p.keyboard.press('Escape');
  } else {
    // pinch zoom with two touch points (CDP)
    const cdp = await ctx.newCDPSession(p);
    const z0 = await p.evaluate(() => window.__acikOfis.scene.userZoom);
    const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[170, 420], [220, 420]]) });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[170 - i * 12, 420], [220 + i * 12, 420]]) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(200);
    check('m: pinch zoom', (await p.evaluate(() => window.__acikOfis.scene.userZoom)) > z0 * 1.2);
    // drag to pan
    const c0 = await p.evaluate(() => window.__acikOfis.scene.cameras.main.scrollX);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 450, id: 0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 - i * 15, y: 450, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(200);
    check('m: drag to pan', (await p.evaluate(() => window.__acikOfis.scene.cameras.main.scrollX)) !== c0);
  }
  check(vp.name + ': no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ v1.0.1: desktop "tıkla" texts, Senior, Kodhane referral counter
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'tr-TR' });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await ready(p);
  check('d: pointer is fine on desktop', await p.evaluate(() => matchMedia('(pointer: fine)').matches));
  const lap = await p.evaluate(() => window.__acikOfis.scene.laptopScreen());
  await p.mouse.click(lap.x, lap.y);
  await p.waitForSelector('[data-test=accept]', { timeout: 3000 });
  await p.click('[data-test=accept]');
  for (let i = 0; i < 40 && (await S(p)).done < 1; i++) { await p.mouse.click(lap.x, lap.y); await p.waitForTimeout(90); }
  await p.click('[data-test=nav-team]');
  const teamTxt = await p.textContent('.sheet');
  check('d: Senior shown in team list (no Kıdemli)', teamTxt.includes('Senior') && !teamTxt.includes('Kıdemli'), teamTxt.slice(0, 200));
  await p.click('[data-test=hire-btn-stajyer]');
  await p.waitForTimeout(300);
  check('d: desk hint says tıkla on desktop', (await p.textContent('[data-test=hint]')) === 'Stajyerin masa istiyor. Boş bir yere tıkla.', await p.textContent('[data-test=hint]'));
  check('d: no page errors (v1.0.1)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  // opened from Kodhane -> local flag; first cloud save counts 'acikofis_cloud_signup_kodhane' once with the anon key (mocked backend)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const hits = []; let rows = [];
  await ctx.route('https://supabase.teserix.com/**', async (route) => {
    const r = route.request(); const u = new URL(r.url()); const auth = r.headers()['authorization'] || '';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
    if (u.pathname === '/rest/v1/rpc/kodhane_count_event') { hits.push({ ev: JSON.parse(r.postData()).p_event, anon: auth === 'Bearer ' + r.headers()['apikey'] }); return route.fulfill({ status: 200, headers: cors, body: 'true' }); }
    if (u.pathname === '/rest/v1/acik_ofis_saves' && r.method() === 'GET') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(rows) });
    if (u.pathname === '/rest/v1/acik_ofis_saves' && r.method() === 'POST') { const b = JSON.parse(r.postData()); rows = [{ data: b.data, save_version: b.save_version, updated_at: b.updated_at }]; return route.fulfill({ status: 201, headers: cors, body: '' }); }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '?utm_source=kodhane&utm_medium=news&utm_campaign=acikofis_v1'); await ready(p);
  check('ref: utm_source=kodhane remembered locally', await p.evaluate(() => localStorage.getItem('acik_ofis_from_kodhane')) === '1');
  check('ref: no network call before a cloud save', hits.length === 0);
  // simulate a signed-in session (fake token, mocked backend), then reload -> reconcile -> first cloud save
  await p.evaluate(() => localStorage.setItem('acik_ofis_auth_v1', JSON.stringify({ access_token: 'fake', refresh_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-0000-0000-000000000001', email: 'x@example.invalid' } })));
  await p.goto(base); await ready(p);
  await p.waitForTimeout(1500);
  check('ref: first cloud save counted once, anonymously (anon key)', hits.length === 1 && hits[0].ev === 'acikofis_cloud_signup_kodhane' && hits[0].anon && rows.length === 1, JSON.stringify(hits));
  await p.reload(); await ready(p); await p.waitForTimeout(1500);
  check('ref: not counted again (cloud save exists, flag set)', hits.length === 1, JSON.stringify(hits));
  check('ref: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ v2 (Ajans): Ajans office, area items + glow, visual event cards
const TR = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/tr.json'), 'utf8'));
const visibleGlows = (p) => p.evaluate(() => window.__acikOfis.scene.glows.filter((g) => g.visible).length);
const hlSpot = (p, k = 0) => p.evaluate((k) => { const s = window.__acikOfis.scene; const v = s.hl.filter((x) => x.visible); const h = v[Math.min(k, v.length - 1)]; return h ? s.worldToCss(h.x, h.y) : null; }, k);
for (const vp of [{ name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { name: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }]) {
  const ctx = await browser.newContext({ ...vp, locale: 'tr-TR' });
  await ctx.addInitScript(drawCounter);
  const save = ajansSave(Date.now());
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, save);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base); await ready(p);
  await p.waitForTimeout(1500);
  const st = await S(p);
  const v = vp.name === 'mobile' ? 'm2' : 'd2';
  check(v + ': Ajans save loads (14x14, ' + save.staff.length + ' people, items)', st.staff === save.staff.length && (await p.textContent('.hud-stage')) === TR.stages.ajans &&
    (await p.evaluate(() => window.__acikOfis.scene.itemSprites.size)) === save.items.length, JSON.stringify(st));
  check(v + ': nothing counted again for an Ajans save that already counted its stages', ctx.fake.counts.length === 0, JSON.stringify(ctx.fake.counts));
  await p.screenshot({ path: path.join(shots, 'v2-ajans-' + vp.name + '.png') });
  const draws = await p.evaluate(() => window.__draws);
  check(v + ': draw calls per frame (Ajans)', draws.calls / draws.frames < 20, 'avg ' + (draws.calls / draws.frames).toFixed(1) + ', max ' + draws.max);
  // items sheet
  await (vp.hasTouch ? p.tap('[data-test=nav-office]') : p.click('[data-test=nav-office]'));
  await p.waitForSelector('[data-test=item-sunucu]');
  const sheet = await p.textContent('.sheet');
  check(v + ': Eşyalar section with Yazı\'s item texts', sheet.includes(TR.office.items) && ['kahve', 'bitki', 'sunucu'].every((k) => sheet.includes(TR.items[k].name)) && sheet.includes('Geniş bir alandaki masalar %8 daha hızlı.'), sheet.slice(0, 160));
  if (vp.name === 'mobile') { await p.evaluate(() => document.querySelector('[data-test=item-kahve]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); await p.screenshot({ path: path.join(shots, 'v2-items-sheet-mobile.png') }); }
  const type = vp.name === 'mobile' ? 'bitki' : 'kahve';
  const n0 = await p.evaluate(() => window.__acikOfis.ctrl.state.items.length);
  await (vp.hasTouch ? p.tap('[data-test=item-btn-' + type + ']') : p.click('[data-test=item-btn-' + type + ']'));
  await p.waitForTimeout(500);
  check(v + ': item placement mode: hint = items.area, existing areas glow', (await p.textContent('[data-test=hint]')) === TR.items.area && (await visibleGlows(p)) > 0, await p.textContent('[data-test=hint]'));
  const g0 = await visibleGlows(p);
  const spot = await hlSpot(p, 40);
  if (vp.hasTouch) {
    await p.touchscreen.tap(spot.x, spot.y); await p.waitForTimeout(400);
    const g1 = await visibleGlows(p);
    check('m2: first tap only previews the item area (not placed yet, more tiles glow)', (await p.evaluate(() => window.__acikOfis.ctrl.state.items.length)) === n0 && g1 > g0, g0 + ' -> ' + g1);
    await p.screenshot({ path: path.join(shots, 'v2-glow-mobile.png') });
    await p.touchscreen.tap(spot.x, spot.y); await p.waitForTimeout(600);
  } else {
    await p.mouse.move(spot.x, spot.y); await p.waitForTimeout(300);
    check('d2: mouse hover previews the item area', (await visibleGlows(p)) > g0);
    await p.screenshot({ path: path.join(shots, 'v2-glow-desktop.png') });
    await p.mouse.click(spot.x, spot.y); await p.waitForTimeout(600);
  }
  const it = await p.evaluate(() => { const c = window.__acikOfis.ctrl; return { n: c.state.items.length, last: c.state.items.at(-1), placing: !!c.placing }; });
  check(v + ': item placed (' + type + '), placement mode closed, glow flashes', it.n === n0 + 1 && it.last.type === type && !it.placing && (await visibleGlows(p)) > 0, JSON.stringify(it));
  // visual event card
  const evId = vp.name === 'mobile' ? 'kedi' : 'sunucu';
  await p.evaluate((id) => { const s = window.__acikOfis.ctrl.state; s.events.seen = ['logo', 'cuma', 'yegen', 'cay', 'acil', 'sunucu', 'kedi', 'toplanti', 'final', 'viral'].filter((x) => x !== id); s.events.nextAt = s.playSec; }, evId);
  await p.waitForSelector('[data-test=event-text]', { timeout: 6000 });
  await p.waitForTimeout(1600);
  const ev = await p.evaluate(() => ({ visual: window.__acikOfis.scene.lastVisual, fx: window.__acikOfis.scene.fx.filter((x) => x.visible).length, sub: (document.querySelector('[data-test=event-sub]') || {}).textContent || '' }));
  check(v + ': visual event card "' + evId + '" (Kodhane text) plays in the office', (await p.textContent('[data-test=event-text]')) === TR.events[evId].text &&
    (evId === 'sunucu' ? ev.visual === 'duman' && ev.fx > 0 && ev.sub === TR.events.sunucu.subRack : ev.visual === 'kedi'), JSON.stringify(ev));
  await p.screenshot({ path: path.join(shots, 'v2-event-' + evId + '-' + vp.name + '.png') });
  await (vp.hasTouch ? p.tap('[data-test=event-a]') : p.click('[data-test=event-a]'));
  await p.waitForTimeout(300);
  check(v + ': event card closes', !(await p.$('[data-test=event-text]')));
  const toast = await p.evaluate(() => [...document.querySelectorAll('.toasts > *')].map((e) => e.textContent).join(' | '));
  check(v + ': result toast has no unfilled {placeholders}', !/[{}]/.test(toast), toast);
  if (vp.name === 'desktop') {
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const pos = await p.evaluate(() => { const sc = window.__acikOfis.scene, s = window.__acikOfis.ctrl.state; const srv = s.items.find((x) => x.type === 'sunucu'); const o = sc.itemSprites.get(srv.id); return sc.worldToCss(o.x, o.y - 12); });
    await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(400);
    check('d2: clicking the server rack shows its effect (items.sunucu.effect)', ((await p.textContent('[data-test=item-effect]').catch(() => '')) || '') === 'Çevresindeki masaların teslim ettiği projeler %25 daha kazançlı.', await p.textContent('.modal').catch(() => ''));
  }
  check(v + ': no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ v2: first Proje Yöneticisi (tutorial.pm) + stage-up screen (Stüdyo -> Ajans)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const save = grownSave(Date.now()); save.totalEarned = 260000; save.money = 400000;
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, save);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base); await ready(p); await p.waitForTimeout(800);
  await p.tap('[data-test=nav-team]');
  await p.tap('[data-test=hire-btn-pm]');
  await p.waitForTimeout(400);
  check('pm: placing the first Proje Yöneticisi shows tutorial.pm', (await p.textContent('[data-test=hint]')) === TR.tutorial.pm, await p.textContent('[data-test=hint]'));
  await p.screenshot({ path: path.join(shots, 'v2-pm-tip-mobile.png') });
  const spot = await hlSpot(p, 3);
  await p.touchscreen.tap(spot.x, spot.y); await p.waitForTimeout(700);
  const pm = await p.evaluate(() => { const s = window.__acikOfis.ctrl.state; return { pm: s.staff.filter((x) => x.type === 'pm').length, tip: s.flags.pmTip }; });
  check('pm: hired at the chosen desk, tip marked as shown', pm.pm === 1 && pm.tip === true, JSON.stringify(pm));
  await p.tap('[data-test=nav-office]');
  await p.tap('[data-test=move]');
  await p.waitForSelector('[data-test=stageup-text]', { timeout: 4000 });
  await p.waitForTimeout(600);
  check('stageup: congratulation screen with Yazı\'s text', (await p.textContent('[data-test=stageup-text]')) === 'Artık “biz” diyorsunuz ve bunu gerçekten ciddi söylüyorsunuz.' &&
    (await p.textContent('[data-test=stageup-title]')).includes(TR.stages.ajans), await p.textContent('[data-test=stageup-title]'));
  await p.screenshot({ path: path.join(shots, 'v2-stageup-mobile.png') });
  check('counter: stage_0/_1 once at start (fresh v2 save), stage_2 on the move', JSON.stringify(ctx.fake.counts) === '["acikofis_stage_0","acikofis_stage_1","acikofis_stage_2"]', JSON.stringify(ctx.fake.counts));
  await p.tap('[data-test=stageup-share]');
  await p.waitForSelector('[data-test=share-img]', { timeout: 8000 });
  check('stageup: share button opens the share card', !!(await p.$('[data-test=share-img]')));
  const mv = await p.evaluate(() => { const s = window.__acikOfis.ctrl.state; return { stage: s.stage, staff: s.staff.length, zoom: window.__acikOfis.scene.fitZoom }; });
  check('stageup: now in the Ajans with the whole team', mv.stage === 2 && mv.staff === save.staff.length + 1, JSON.stringify(mv));
  await p.evaluate(() => { const b = document.querySelector('.modal .btn.ghost, .modal [data-test=share-close]'); if (b) b.click(); });
  await p.waitForTimeout(400);
  const fitAfter = await p.evaluate(() => { const sc = window.__acikOfis.scene, b = sc.bounds, a = sc.worldToCss(b.L, b.T), c = sc.worldToCss(b.R, b.B); return { ok: a.x >= -1 && a.y >= -1 && c.x <= innerWidth + 1 && c.y <= innerHeight + 1, zoom: sc.userZoom, fit: sc.fitZoom }; });
  check('v21 stage change: the bigger Ajans room fits on screen right after the move', fitAfter.ok && Math.abs(fitAfter.zoom - fitAfter.fit) < 1e-6, JSON.stringify(fitAfter));
  check('pm/stageup: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ v2: all-time leaderboard (p_game='acik_ofis', fake backend)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const f = ctx.fake;
  const rows = [{ rank: 1, nickname: 'ÇaycıHüseyin', score: 48250000, stage: 2 }, { rank: 2, nickname: 'SmokeOfis', score: 12400000, stage: 2, is_me: true }, { rank: 3, nickname: 'kod-ustası_1', score: 3100000, stage: 1 }, { rank: 4, nickname: 'Ali Veli', score: 950000, stage: 2 }]
    .map((r) => ({ is_me: false, status: 'ok', ...r }));
  f.lb = rows; f.profile = { nickname: 'SmokeOfis', hidden: false };
  const save = ajansSave(Date.now());
  await ctx.addInitScript(([s, sess]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); localStorage.setItem('acik_ofis_auth_v1', sess); sessionStorage.setItem('seeded', '1'); } }, [save, FAKE_SESSION]);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await ready(p); await p.waitForTimeout(1200);
  await p.tap('[data-test=menu]');
  await p.tap('[data-test=menu-leaderboard]');
  await p.waitForSelector('[data-test=lb-row]', { timeout: 8000 });
  await p.waitForTimeout(500);
  const call = f.lbCalls.at(-1);
  check('lb: asks for p_game=acik_ofis with the user token', call && call.body.p_game === 'acik_ofis' && call.auth === 'Bearer fake', JSON.stringify(call));
  const lb = await p.evaluate(() => ({ rows: document.querySelectorAll('[data-test=lb-row]').length, me: (document.querySelector('.lb-row.me') || {}).textContent || '', own: (document.querySelector('[data-test=lb-own]') || {}).textContent || '', tab: document.querySelector('.lb-head .tag').textContent }));
  check('lb: list with own row highlighted + own rank', lb.rows === 4 && lb.me.includes('SmokeOfis') && lb.own.includes('2') && lb.tab === TR.lb.tab, JSON.stringify(lb));
  check('lb: no stray "null" text in the modal', !(await p.textContent('.modal')).includes('null'));
  await p.screenshot({ path: path.join(shots, 'v2-leaderboard-mobile.png') });
  f.lb = rows.filter((r) => !r.is_me).concat([{ rank: null, nickname: 'SmokeOfis', score: null, stage: null, is_me: true, status: 'pending' }]);
  await p.tap('[data-test=lb-refresh]'); await p.waitForTimeout(900);
  check('lb: pending state for an implausible own score', !!(await p.$('[data-test=lb-pending]')));
  f.profile.hidden = true; f.lb = rows.filter((r) => !r.is_me).concat([{ rank: null, nickname: 'SmokeOfis', score: null, stage: null, is_me: true, status: 'hidden' }]);
  await p.tap('[data-test=lb-refresh]'); await p.waitForTimeout(900);
  check('lb: hidden state (admin hide switch)', !!(await p.$('[data-test=lb-hidden]')));
  check('lb: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  // guest: list with the public key only, sign-in prompt instead of the nickname form
  const g = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  g.fake.lb = rows.map((r) => ({ ...r, is_me: false }));
  const q = await g.newPage();
  await q.goto(base); await ready(q);
  await q.tap('[data-test=menu]'); await q.waitForSelector('[data-test=menu-leaderboard]');
  check('menu: no stray "null" text (optional buttons)', !(await q.textContent('.modal')).includes('null'));
  await q.tap('[data-test=menu-leaderboard]');
  await q.waitForSelector('[data-test=lb-row]', { timeout: 8000 });
  const gc = g.fake.lbCalls.at(-1);
  check('lb guest: public list + sign-in prompt, no user token', !!(await q.$('[data-test=lb-signin]')) && gc && !/Bearer fake/.test(gc.auth) && gc.body.p_game === 'acik_ofis', gc && JSON.stringify({ body: gc.body, userToken: /Bearer fake/.test(gc.auth) }));
  await g.close();
}


// ================================================================ v2.1: mobile view (fit / pinch / pan / taps vs drags) + free item moving
const officeOnScreen = (p) => p.evaluate(() => {
  const sc = window.__acikOfis.scene, b = sc.bounds, a = sc.worldToCss(b.L, b.T), c = sc.worldToCss(b.R, b.B);
  const ok = a.x >= -1 && a.y >= -1 && c.x <= innerWidth + 1 && c.y <= innerHeight + 1;
  return { ok, zoom: +sc.userZoom.toFixed(3), fit: +sc.fitZoom.toFixed(3), box: [a.x, a.y, c.x, c.y].map(Math.round), vw: innerWidth, vh: innerHeight };
});
const closeModal = async (p) => { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.modal .info-head'), null, { timeout: 3000 }).catch(() => {}); };
const onScreenStaff = (p) => p.evaluate(() => {
  const sc = window.__acikOfis.scene, s = window.__acikOfis.ctrl.state;
  for (const x of s.staff) { if (x.type === 'kurucu') continue; const o = sc.staffSprites.get(x.id); if (!o) continue; const q = sc.worldToCss(o.x, o.y - 22); if (q.x > 40 && q.x < innerWidth - 40 && q.y > 170 && q.y < innerHeight - 200) return { ...q, id: x.id }; }
  return null;
});
for (const vp of [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '360', viewport: { width: 360, height: 780 } }]) {
  const ctx = await browser.newContext({ ...vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const save = ajansSave(Date.now());
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, save);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base); await ready(p); await p.waitForTimeout(900);
  const v = 'v21 ' + vp.name;
  let o = await officeOnScreen(p);
  check(v + ': whole Ajans office fits on screen at start', o.ok && o.zoom === o.fit, JSON.stringify(o));
  await p.screenshot({ path: path.join(shots, 'v21-fit-' + vp.name + '-mobile.png') });
  check(v + ': fit button visible on touch (+/- hidden)', await p.isVisible('[data-test=zoom-fit]') && !(await p.isVisible('.zoom .zin')));
  // rotate to landscape and back: refits while the player has not zoomed
  await p.setViewportSize({ width: vp.viewport.height, height: vp.viewport.width }); await p.waitForTimeout(700);
  o = await officeOnScreen(p);
  check(v + ': refits after rotation (landscape)', o.ok && o.zoom === o.fit, JSON.stringify(o));
  if (vp.name === '390') await p.screenshot({ path: path.join(shots, 'v21-landscape-mobile.png') });
  await p.setViewportSize(vp.viewport); await p.waitForTimeout(700);
  o = await officeOnScreen(p);
  check(v + ': refits after rotating back', o.ok && o.zoom === o.fit, JSON.stringify(o));
  // pinch zoom in around the middle
  const cdp = await ctx.newCDPSession(p);
  const cx = vp.viewport.width / 2, cy = vp.viewport.height / 2;
  const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[cx - 30, cy], [cx + 30, cy]]) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[cx - 30 - i * 14, cy], [cx + 30 + i * 14, cy]]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  const z1 = await p.evaluate(() => window.__acikOfis.scene.userZoom);
  check(v + ': pinch zooms in', z1 > o.fit * 1.5, z1.toFixed(2) + ' vs fit ' + o.fit);
  check(v + ': pinch did not open anything', !(await p.$('.modal .info-head')));
  if (vp.name === '390') await p.screenshot({ path: path.join(shots, 'v21-pinch-mobile.png') });
  // a tap on someone after zooming opens the info card
  let who = await onScreenStaff(p);
  await p.touchscreen.tap(who.x, who.y); await p.waitForTimeout(400);
  check(v + ': tap on an employee after pinch opens the info card', !!(await p.$('.modal .info-head')), JSON.stringify(who));
  await closeModal(p); await p.waitForTimeout(300);
  // a drag that starts on an employee pans and opens nothing
  who = await onScreenStaff(p);
  const s0 = await p.evaluate(() => ({ x: window.__acikOfis.scene.cameras.main.scrollX, y: window.__acikOfis.scene.cameras.main.scrollY }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: who.x, y: who.y, id: 0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: who.x - i * 9, y: who.y - i * 4, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(700);
  const s1 = await p.evaluate(() => ({ x: window.__acikOfis.scene.cameras.main.scrollX, y: window.__acikOfis.scene.cameras.main.scrollY }));
  check(v + ': drag starting on an employee pans, no info card', (s1.x !== s0.x || s1.y !== s0.y) && !(await p.$('.modal .info-head')), JSON.stringify([s0, s1]));
  // the player zoomed: a resize keeps their zoom; the fit button brings the whole office back
  await p.setViewportSize({ width: vp.viewport.width, height: vp.viewport.height - 60 }); await p.waitForTimeout(500);
  const z2 = await p.evaluate(() => window.__acikOfis.scene.userZoom);
  check(v + ': resize after zooming keeps the player zoom', Math.abs(z2 - z1) < 0.01, z1 + ' -> ' + z2);
  await p.setViewportSize(vp.viewport); await p.waitForTimeout(400);
  await p.tap('[data-test=zoom-fit]'); await p.waitForTimeout(400);
  o = await officeOnScreen(p);
  check(v + ': fit button shows the whole office again', o.ok && o.zoom === o.fit, JSON.stringify(o));
  if (vp.name === '390') {
    // free item moving: tap the rack -> Taşı -> preview tap -> confirm tap
    const money0 = await p.evaluate(() => window.__acikOfis.ctrl.state.money);
    const rack = await p.evaluate(() => { const sc = window.__acikOfis.scene, s = window.__acikOfis.ctrl.state; const it = s.items.find((x) => x.type === 'sunucu'); const o = sc.itemSprites.get(it.id); return { ...sc.worldToCss(o.x, o.y - 12), id: it.id, gx: it.gx, gy: it.gy }; });
    await p.touchscreen.tap(rack.x, rack.y); await p.waitForTimeout(400);
    check('v21 move: tapping an item shows the Taşı button', await p.isVisible('[data-test=item-move]'));
    await p.tap('[data-test=item-move]'); await p.waitForTimeout(500);
    const bar = await p.textContent('.placebar');
    const lay = await p.evaluate(() => { const a = document.querySelector('.placebar').getBoundingClientRect(), h = document.querySelector('[data-test=hint]').getBoundingClientRect(), b = document.querySelector('[data-test=place-cancel]').getBoundingClientRect(); return { overlap: h.bottom > a.top + 1, cancelOneLine: b.height < 48 }; });
    check('v21 move: hint does not cover the placement bar, Vazgeç on one line', !lay.overlap && lay.cancelOneLine, JSON.stringify(lay));
    check('v21 move: placement bar says free', bar.includes(TR.items.sunucu.name) && bar.includes('ücretsiz'), bar);
    const spot = await hlSpot(p, 25);
    await p.touchscreen.tap(spot.x, spot.y); await p.waitForTimeout(400);
    const mid = await p.evaluate((id) => window.__acikOfis.ctrl.state.items.find((x) => x.id === id), rack.id);
    check('v21 move: first tap only previews', mid.gx === rack.gx && mid.gy === rack.gy);
    await p.screenshot({ path: path.join(shots, 'v21-item-move-mobile.png') });
    await p.touchscreen.tap(spot.x, spot.y); await p.waitForTimeout(600);
    const after = await p.evaluate((id) => ({ it: window.__acikOfis.ctrl.state.items.find((x) => x.id === id), money: window.__acikOfis.ctrl.state.money, n: window.__acikOfis.ctrl.state.items.length, placing: !!window.__acikOfis.ctrl.placing }), rack.id);
    check('v21 move: second tap moves the rack, free, nothing sold', (after.it.gx !== rack.gx || after.it.gy !== rack.gy) && after.money >= money0 && after.n === save.items.length && !after.placing, JSON.stringify(after));
    check('v21 move: toast', (await p.textContent('.toasts')).includes(TR.toast.itemMoved.replace('{name}', TR.items.sunucu.name)));
    await p.evaluate(() => window.__acikOfis.ctrl.save());
    await p.reload(); await ready(p);
    const kept = await p.evaluate((id) => window.__acikOfis.ctrl.state.items.find((x) => x.id === id), rack.id);
    check('v21 move: new position survives a reload', kept.gx === after.it.gx && kept.gy === after.it.gy);
  }
  check(v + ': no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  // desktop: fit, wheel zoom, fit button, move an item with the mouse (hover + click)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'tr-TR' });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, ajansSave(Date.now()));
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base); await ready(p); await p.waitForTimeout(700);
  let o = await officeOnScreen(p);
  check('v21 desktop: whole office fits', o.ok && o.zoom === o.fit, JSON.stringify(o));
  await p.mouse.move(640, 420); await p.mouse.wheel(0, -400); await p.waitForTimeout(300);
  check('v21 desktop: wheel zoom', (await p.evaluate(() => window.__acikOfis.scene.userZoom)) > o.fit);
  await p.click('[data-test=zoom-fit]'); await p.waitForTimeout(300);
  o = await officeOnScreen(p);
  check('v21 desktop: fit button', o.ok && o.zoom === o.fit, JSON.stringify(o));
  const kahve = await p.evaluate(() => { const sc = window.__acikOfis.scene, s = window.__acikOfis.ctrl.state; const it = s.items.find((x) => x.type === 'kahve'); const o = sc.itemSprites.get(it.id); return { ...sc.worldToCss(o.x, o.y - 10), id: it.id, gx: it.gx, gy: it.gy }; });
  await p.mouse.click(kahve.x, kahve.y); await p.waitForTimeout(400);
  await p.click('[data-test=item-move]'); await p.waitForTimeout(400);
  const spot = await hlSpot(p, 12);
  await p.mouse.move(spot.x, spot.y); await p.waitForTimeout(250);
  await p.mouse.click(spot.x, spot.y); await p.waitForTimeout(500);
  const it = await p.evaluate((id) => window.__acikOfis.ctrl.state.items.find((x) => x.id === id), kahve.id);
  check('v21 desktop: item moved with hover + one click', it.gx !== kahve.gx || it.gy !== kahve.gy, JSON.stringify([kahve, it]));
  await p.screenshot({ path: path.join(shots, 'v21-desktop.png') });
  check('v21 desktop: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}


// ================================================================ +30% longer text (pseudo-locale) layout check
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '?pseudo=30'); await ready(p);
  const lap = await p.evaluate(() => window.__acikOfis.scene.laptopScreen());
  await p.touchscreen.tap(lap.x, lap.y);
  await p.waitForSelector('[data-test=accept]');
  const lay = await p.evaluate(() => {
    const over = [...document.querySelectorAll('#ui *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map((e) => e.className || e.tagName);
    return { over, docW: document.documentElement.scrollWidth, lang: document.documentElement.lang, hint: document.querySelector('[data-test=hint]').textContent };
  });
  check('i18n: html lang from detected locale', lay.lang === 'tr');
  check('i18n: +30% text fits (no horizontal overflow)', lay.docW <= 390 && lay.over.length === 0, JSON.stringify(lay.over.slice(0, 5)));
  await p.screenshot({ path: path.join(shots, 'pseudo-30-offers-mobile.png') });
  await p.tap('[data-test=nav-team]'); await p.waitForTimeout(300);
  const over2 = await p.evaluate(() => [...document.querySelectorAll('.sheet *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).length);
  check('i18n: +30% text fits in team sheet', over2 === 0);
  await p.screenshot({ path: path.join(shots, 'pseudo-30-team-mobile.png') });
  check('pseudo: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
if (server) server.kill();
const pass = results.filter((r) => r[1]).length;
console.log('\nSMOKE: ' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
