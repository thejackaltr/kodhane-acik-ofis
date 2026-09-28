// v2.2 headless check: desk move (UI → two taps) + reset dialog (2 s hold) + "Geri al" undo, guest and signed-in (fake
// Supabase with the RPC.reset / RPC.restore functions from cloud.js). Usage: npm run build && node tests/smoke/v22.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { grownSave } from './grown.mjs';
import { RPC } from '../../src/cloud/cloud.js';

let base = process.argv[2], server = null;
if (!base) { server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' }); base = 'http://localhost:4175/'; await new Promise((r) => setTimeout(r, 2500)); }
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
function check(name, cond, info = '') { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
const USER = '00000000-0000-0000-0000-000000000002';
const SESSION = JSON.stringify({ access_token: 'fake', refresh_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER, email: 'smoke@example.invalid' } });

async function fake(ctx) {
  const f = { row: null, reqs: [], backups: [] };
  await ctx.route('https://supabase.teserix.com/**', async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS, body: '' });
    const body = (() => { try { return JSON.parse(r.postData() || 'null'); } catch (e) { return null; } })();
    let pg = null; try { pg = r.frame().page(); } catch (e) { pg = null; }
    const entry = { m, path: u.pathname, body, pg };
    f.reqs.push(entry);
    const ok = (b, s = 200) => { entry.status = s; return route.fulfill({ status: s, headers: CORS, body: JSON.stringify(b) }); };
    if (u.pathname === '/rest/v1/acik_ofis_saves') {
      if (m === 'GET') return ok(f.row ? [f.row] : []);
      if (m === 'POST') {
        const cur = f.row ? f.row.revision : 0;
        if (f.row && body.revision <= cur) return ok({ code: 'PT409', message: 'stale_revision', details: null, hint: null }, 409);
        f.row = { data: body.data, save_version: body.save_version, updated_at: body.updated_at, revision: body.revision, best_score: Math.max(f.row ? f.row.best_score : 0, body.data.totalEarned || 0) };
        entry.status = 201; return route.fulfill({ status: 201, headers: CORS, body: '' });
      }
      return ok({ code: '42501', message: 'permission denied' }, 403);   // DELETE is revoked on the real backend
    }
    if (u.pathname === '/rest/v1/rpc/' + RPC.reset) {
      const id = 'b' + (f.backups.length + 1); f.backups.push({ id, row: JSON.parse(JSON.stringify(f.row)), at: Date.now() });
      f.row.revision++; f.row.data = { flags: { cloudAsked: true, stagesCounted: (f.row.data.flags || {}).stagesCounted } };
      return ok({ game: 'acik_ofis', revision: f.row.revision, backup_id: id, best_score: f.row.best_score });
    }
    if (u.pathname === '/rest/v1/rpc/' + RPC.restore) {
      const b = f.backups.find((x) => x.id === body.p_backup_id); if (!b) return ok({ code: 'PT404', message: 'backup_not_found' }, 404);
      f.row.revision++; f.row.data = b.row.data;
      return ok({ game: 'acik_ofis', revision: f.row.revision, backup_id: 'b' + (f.backups.length + 1), restored_from: b.id, best_score: f.row.best_score });
    }
    if (u.pathname === '/rest/v1/rpc/' + RPC.listBackups) return ok(f.backups.slice().reverse().map((b) => ({ id: b.id, revision: b.row.revision, reason: 'reset', score: b.row.data.totalEarned || 0, best_score: b.row.best_score, stage: 0, best_stage: 0, created_at: new Date(b.at).toISOString(), expires_at: new Date(b.at + 30 * 86400e3).toISOString() })));
    if (u.pathname.startsWith('/rest/v1/rpc/')) return ok(u.pathname.endsWith('leaderboard') ? [] : true);
    if (u.pathname === '/rest/v1/kodhane_profiles') return ok([]);
    return ok({}, 404);
  });
  return f;
}
const ready = (p) => p.waitForFunction(() => window.__acikOfis && window.__acikOfis.scene, null, { timeout: 20000 }).then(() => p.waitForTimeout(600));
const money = (p) => p.evaluate(() => window.__acikOfis.ctrl.state.money);
async function holdReset(p) {
  await p.click('[data-test=menu]'); await p.click('[data-test=menu-reset]');
  const lists = await p.evaluate(() => ({ del: [...document.querySelectorAll('[data-test=reset-delete] li')].map((l) => l.textContent), keep: [...document.querySelectorAll('[data-test=reset-keep] li')].map((l) => l.textContent), backup: (document.querySelector('[data-test=reset-backup]') || {}).textContent || '', title: document.querySelector('.modal h2').textContent, cancel: document.querySelector('[data-test=reset-cancel]').textContent, hold: document.querySelector('[data-test=reset-hold]').textContent }));
  const b = await p.locator('[data-test=reset-hold]').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
  const early = await p.isVisible('[data-test=reset-hold]');
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(2300); await p.mouse.up();
  await p.waitForSelector('[data-test=undo-toast]', { timeout: 5000 });
  return { lists, early };
}

for (const signedIn of [false, true]) {
  const tag = signedIn ? 'signed-in' : 'guest';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'tr-TR' });
  const f = await fake(ctx);
  const save = grownSave(Date.now());
  if (signedIn) { save.revision = 3; f.row = { data: save, save_version: save.v || 1, updated_at: new Date().toISOString(), revision: 3, best_score: save.totalEarned }; }
  await ctx.addInitScript(([s, sess]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); if (sess) localStorage.setItem('acik_ofis_auth_v1', sess); sessionStorage.setItem('seeded', '1'); } }, [save, signedIn ? SESSION : null]);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await ready(p);
  await p.evaluate(() => document.querySelectorAll('.modal .btn.primary, .modal [data-test=stageup-ok]').forEach((b) => b.click()));
  await p.waitForTimeout(300);

  if (!signedIn) {   // desk move through the real UI: info modal → "Taşı" → preview tap → confirm tap
    const d = await p.evaluate(() => { const s = window.__acikOfis.ctrl.state; const d = s.desks[s.desks.length - 1]; window.__acikOfis.ui.showInfo({ kind: 'desk', id: d.id }); return { id: d.id, gx: d.gx, gy: d.gy }; });
    await p.click('[data-test=desk-move]');
    const spot = await p.evaluate(() => { const sc = window.__acikOfis.scene; const h = sc.hl.find((x) => x.visible); return { x: h.x, y: h.y, red: sc.bad.filter((x) => x.visible).length, moving: window.__acikOfis.ctrl.placing && window.__acikOfis.ctrl.placing.moveDeskId }; });
    check('desk move: placing mode, green + red tiles', spot.moving === d.id && spot.red > 0, JSON.stringify(spot));
    const m0 = await money(p);
    await p.evaluate(({ x, y }) => { const sc = window.__acikOfis.scene; sc.tap(x, y); sc.tap(x, y); }, spot);
    const after = await p.evaluate((id) => { const c = window.__acikOfis.ctrl; const d = c.state.desks.find((x) => x.id === id); return { gx: d.gx, gy: d.gy, placing: !!c.placing }; }, d.id);
    check('desk move: desk moved for free, mode closed', (after.gx !== d.gx || after.gy !== d.gy) && !after.placing && (await money(p)) === m0, JSON.stringify(after));
  }

  const m0 = await money(p);
  const { lists, early } = await holdReset(p);
  check(tag + ': dialog = Yazı copy, fixed lists (4 go, 3 stay)', lists.title === 'Baştan başlamak istiyor musun?' && lists.del.length === 4 && lists.del[0] === 'Kasa ve kazanç' && lists.keep.length === 3 && lists.keep[2] === 'Kodhane hesabın' && lists.cancel === 'Vazgeç' && lists.hold === 'Baştan başlamak için basılı tut', JSON.stringify(lists));
  check(tag + ': backup line ' + (signedIn ? 'shown with 30 days' : 'hidden for guests'), signedIn ? lists.backup === 'Eski kaydın 30 gün saklanır, bu sürede geri yükleyebilirsin.' : lists.backup === '', lists.backup);
  check(tag + ': short press does not reset', early);
  const m1 = await money(p);
  check(tag + ': reset applied', m1 < m0, m0 + ' → ' + m1);
  if (signedIn) {
    const rpc = f.reqs.filter((q) => q.path === '/rest/v1/rpc/' + RPC.reset);
    check('signed-in: ' + RPC.reset + ' RPC, no p_game', rpc.length === 1 && RPC.reset === 'acik_ofis_reset_save' && !('p_game' in (rpc[0].body || {})));
  }
  await p.click('[data-test=undo]'); await p.waitForTimeout(800);
  check(tag + ': undo restores the office', (await money(p)) >= m0 - 1, String(await money(p)));
  if (signedIn) {
    const rs = f.reqs.filter((q) => q.path === '/rest/v1/rpc/' + RPC.restore);
    check('signed-in: ' + RPC.restore + ' RPC with p_backup_id', rs.length === 1 && rs[0].body.p_backup_id === 'b1');
    await p.evaluate(() => window.__acikOfis.cloud.pushNow(true)); await p.waitForTimeout(500);
    check('signed-in: server row holds the office again', f.row.data.money >= m0 - 1 && f.row.revision >= 5, 'rev ' + f.row.revision);
    const writes = f.reqs.filter((q) => q.m === 'POST' && q.path === '/rest/v1/acik_ofis_saves');
    check('signed-in: every save write carries revision, none is empty', writes.every((q) => Number.isInteger(q.body.revision) && q.body.data && q.body.data.desks), writes.length + ' writes');
    check('signed-in: no DELETE request', !f.reqs.some((q) => q.m === 'DELETE'));
    // settings row: restore the newest backup
    await p.click('[data-test=menu]');
    const row = await p.waitForSelector('[data-test=menu-restore]', { timeout: 5000 }).then(() => true, () => false);
    check('signed-in: menu shows "restore newest backup" row (RPC.listBackups)', row && f.reqs.some((q) => q.path === '/rest/v1/rpc/' + RPC.listBackups));
    if (row) {
      await p.click('[data-test=menu-restore]');
      const ask = await p.textContent('[data-test=restore-ask]');
      check('signed-in: restoreAsk with a tr-TR date', /^\d{1,2} \S+ 20\d\d \d{2}:\d{2} tarihli bir yedeğin var\. Geri yüklersen şimdiki ilerlemen silinir\.$/.test(ask), ask);
      const n0 = f.reqs.filter((q) => q.path === '/rest/v1/rpc/' + RPC.restore).length;
      await p.click('[data-test=restore-yes]'); await p.waitForTimeout(800);
      const toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '));
      const rs = f.reqs.filter((q) => q.path === '/rest/v1/rpc/' + RPC.restore);
      check('signed-in: restoreYes -> RPC.restore(newest) + "restored" toast', rs.length === n0 + 1 && rs.at(-1).body.p_backup_id === 'b1' && toast.includes('Eski ofisin geri yüklendi.'), toast);
    }
  } else {
    await p.click('[data-test=menu]'); await p.waitForTimeout(600);
    check('guest: no backup row in the menu', !(await p.isVisible('[data-test=menu-restore]')) && !f.reqs.some((q) => q.path === '/rest/v1/rpc/' + RPC.listBackups));
    await p.keyboard.press('Escape');
  }
  check(tag + ': no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// ================================================================ two tabs of one browser (signed in)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'tr-TR' });
  const f = await fake(ctx);
  const save = grownSave(Date.now()); save.revision = 3;
  f.row = { data: save, save_version: save.v || 1, updated_at: new Date().toISOString(), revision: 3, best_score: save.totalEarned };
  await ctx.addInitScript(([s, sess]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); localStorage.setItem('acik_ofis_auth_v1', sess); localStorage.setItem('seeded', '1'); } }, [save, SESSION]);
  const errors = [];
  const open = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto(base); await ready(p); await p.evaluate(() => document.querySelectorAll('.modal .btn.primary').forEach((b) => b.click())); return p; };
  // headless pages are all "visible": fake the tab switch (document.hidden + visibilitychange)
  const setHidden = (p, hidden) => p.evaluate((hd) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hd });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hd ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const tick = (p) => p.evaluate(async () => { const a = window.__acikOfis; a.ctrl.state.money += 1; a.ctrl.save(); return a.cloud.pushNow(true); });
  const posts = (p) => f.reqs.filter((q) => q.pg === p && q.m === 'POST' && q.path === '/rest/v1/acik_ofis_saves');
  const reads = (p) => f.reqs.filter((q) => q.pg === p && q.m === 'GET' && q.path === '/rest/v1/acik_ofis_saves');
  const A = await open();
  await A.waitForTimeout(800);
  const B = await open();                                   // opened later and shown -> B is the writer
  await B.waitForTimeout(800);
  await setHidden(A, true);
  let a0 = posts(A).length, b0 = posts(B).length;
  for (let i = 0; i < 3; i++) { await tick(A); await tick(B); }
  check('two tabs: only the visible tab writes (B)', posts(A).length === a0 && posts(B).length > b0, 'A +' + (posts(A).length - a0) + ', B +' + (posts(B).length - b0));
  // player switches to A: B flushes once while hiding, A takes over B's save and becomes the only writer
  await setHidden(B, true); await B.waitForTimeout(300);
  await setHidden(A, false); await A.waitForTimeout(300);
  const same = await Promise.all([A, B].map((p) => p.evaluate(() => { const s = window.__acikOfis.ctrl.state; return s.money + '/' + s.revision; })));
  check('two tabs: shown tab continues the other tab\'s save', same[0] === same[1], same.join(' vs '));
  a0 = posts(A).length; b0 = posts(B).length;
  for (let i = 0; i < 3; i++) { await tick(A); await tick(B); }
  check('two tabs: after the switch only A writes', posts(A).length > a0 && posts(B).length === b0, 'A +' + (posts(A).length - a0) + ', B +' + (posts(B).length - b0));
  check('two tabs: no 409 from switching tabs', !f.reqs.some((q) => q.status === 409));
  // another device writes -> A's next write gets 409 -> ONE read, then no write until a real input
  f.row = Object.assign({}, f.row, { revision: f.row.revision + 1, data: Object.assign({}, f.row.data, { money: 12345, totalEarned: f.row.data.totalEarned + 1 }) });
  const r0 = reads(A).length, p0 = posts(A).length;
  await tick(A); await A.waitForTimeout(600);
  const st = await A.evaluate(() => ({ money: window.__acikOfis.ctrl.state.money, held: window.__acikOfis.cloud.held, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ') }));
  check('409: current save loaded once (1 read) + otherDeviceSync toast', reads(A).length === r0 + 1 && posts(A).length === p0 + 1 && st.money === 12345 && st.held && st.toast.includes('Oyuna başka bir cihazda ya da sekmede devam edildi.'), JSON.stringify(st));
  const n = f.reqs.length;
  for (let i = 0; i < 3; i++) { await tick(A); await tick(B); }
  await A.waitForTimeout(1200);
  check('409: no further requests until the player interacts', f.reqs.length === n, (f.reqs.length - n) + ' requests');
  await A.keyboard.press('Shift');                          // a real (trusted) input event
  const p1 = posts(A).length;
  await tick(A); await A.waitForTimeout(300);
  const last = posts(A).at(-1);
  check('409: after an input the next write goes out with server revision + 1', posts(A).length === p1 + 1 && last.status === 201 && last.body.revision === f.row.revision, 'rev ' + (last && last.body.revision) + ', status ' + (last && last.status));
  check('two tabs: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close(); if (server) server.kill();
const bad = results.filter((x) => !x).length;
console.log(`\nV22 SMOKE: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
