// Headless-browser smoke test (mobile 390x844 touch + desktop 1280x800 mouse) against the production build.
// Usage: npm run build && node tests/smoke/smoke.mjs [baseUrl]   (without baseUrl it starts `vite preview`)
// Writes screenshots to screenshots/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grownSave } from './grown.mjs';

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
  const dlP = p.waitForEvent('download', { timeout: 5000 });
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
