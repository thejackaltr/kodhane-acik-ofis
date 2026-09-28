// v2.3 "İsimsiz sayaç": the consent keys (acik_ofis_tel / acik_ofis_tel_notice) are per device and separate from the
// save — "Baştan başla", undo, backup restore, cloud load/merge/save, sign-out and another device's reset never change
// them (one test per path). The anonymous Supabase counter (stage counter + referral) sends nothing without consent;
// login, cloud save and the leaderboard keep working regardless of consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../../src/logic/save.js';
import * as I from '../../src/logic/i18n.js';
import { Controller } from '../../src/game.js';
import { createSaveApi, MockSaveServer } from '../../src/cloud/resetApi.js';
import { ResetFlow } from '../../src/cloud/resetFlow.js';
import { CloudClient, CloudSync, RPC } from '../../src/cloud/cloud.js';
import { KEYS, analytics } from '../../src/analytics.js';
import { ajansSave } from '../smoke/grown.mjs';

const T0 = Date.UTC(2026, 8, 28, 13, 0, 0);
I.registerLocales({ tr: JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url))) }); I.setLocale('tr');
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; }
// ONE device storage = window.localStorage (cloud.js reads the global; the controller gets it injected, like main.js)
const LS = memStorage(); globalThis.localStorage = LS;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
function clock(t = T0) {
  const c = { t, timers: [] };
  c.now = () => c.t;
  c.setTimer = (f, ms) => { const tm = { f, at: c.t + ms }; c.timers.push(tm); return tm; };
  c.clearTimer = (tm) => { c.timers = c.timers.filter((x) => x !== tm); };
  c.advance = (ms) => { c.t += ms; for (const tm of c.timers.filter((x) => x.at <= c.t)) { c.timers = c.timers.filter((x) => x !== tm); tm.f(); } };
  return c;
}
function fakeSupabase(server) {
  const reqs = [];
  const fetch = async (url, o = {}) => {
    const u = new URL(url), body = o.body ? JSON.parse(o.body) : null, method = o.method || 'GET';
    reqs.push({ method, path: u.pathname, body });
    const reply = (status, js) => new Response(js === undefined ? '' : JSON.stringify(js), { status });
    try {
      if (u.pathname === '/rest/v1/rpc/' + RPC.reset) return reply(200, await server.resetSave());
      if (u.pathname === '/rest/v1/rpc/' + RPC.restore) return reply(200, await server.restoreSave(body.p_backup_id));
      if (u.pathname === '/rest/v1/rpc/' + RPC.listBackups) return reply(200, await server.listBackups());
      if (u.pathname === '/rest/v1/acik_ofis_saves' && method === 'GET') { const r = await server.pull(); return reply(200, r ? [r] : []); }
      if (u.pathname === '/rest/v1/acik_ofis_saves' && method === 'POST') { const r = await server.upsert({ data: body.data, revision: body.revision }); return reply(201, [{ revision: r.revision }]); }
      if (u.pathname.startsWith('/rest/v1/rpc/')) return reply(200, true);
      if (u.pathname.startsWith('/auth/v1/logout')) return reply(204);
      return reply(404, {});
    } catch (e) { return reply(e.status || 500, { code: e.code, message: e.message }); }
  };
  return { fetch, reqs };
}
const SESSION = () => ({ access_token: 'jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@b.c' } });
async function device(clk, storage, f, { signedIn = true, reconcile = true } = {}) {
  const ctrl = new Controller(storage, clk.now());
  const cloud = new CloudSync(ctrl, { url: 'https://sb.test', key: 'anon' }, { saveApi: (client) => createSaveApi({ mode: 'real', client, storage: memStorage(), now: clk.now }) });
  if (signedIn) cloud.client.session = SESSION();
  const log = [];
  const flow = new ResetFlow(ctrl, cloud.saveApi, { storage, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, beforeReset: () => cloud.cancelPending(),
    ui: { undoShown: () => log.push('undoShown'), undoGone: () => log.push('undoGone'), restored: () => log.push('restored'), otherDevice: () => log.push('otherDevice'), failed: (k) => log.push('failed:' + k) } });
  cloud.onStale = (cur) => flow.handleStale(cur);
  if (signedIn && reconcile) await cloud.reconcile();
  return { ctrl, cloud, flow, log };
}
// fresh device storage with a grown save + the given consent answer
function prep(clk, pref) {
  LS.clear();
  LS.setItem(S.SAVE_KEY, S.serialize(ajansSave(clk.now()), clk.now()));
  if (pref) { LS.setItem(KEYS.notice, '1'); LS.setItem(KEYS.pref, pref); }
}
const prefs = () => [LS.getItem(KEYS.notice), LS.getItem(KEYS.pref)];

for (const pref of ['off', 'on']) {
  test(`[prefs] "Baştan başla" (guest, local only) + undo keep the consent keys (${pref})`, async () => {
    const clk = clock(); prep(clk, pref); globalThis.fetch = async () => { throw new Error('guest: no network'); };
    const D = await device(clk, LS, null, { signedIn: false });
    assert.ok((await D.flow.reset()).ok); assert.equal(D.ctrl.state.money, 0);
    assert.deepEqual(prefs(), ['1', pref]);
    clk.advance(2000); assert.ok((await D.flow.undo()).ok);
    assert.deepEqual(prefs(), ['1', pref]);
  });
}
test('[prefs] "Baştan başla" (signed in, RPC.reset) keeps the consent keys', async () => {
  const clk = clock(); prep(clk, 'off');
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const D = await device(clk, LS, f);
  assert.ok((await D.flow.reset()).ok);
  assert.ok(f.reqs.some((q) => q.path === '/rest/v1/rpc/' + RPC.reset));
  assert.deepEqual(prefs(), ['1', 'off']);
  D.flow.drop(true); D.cloud.cancelPending();
});
test('[prefs] backup restore (Menü > Son yedeği geri yükle, RPC.restore) keeps the consent keys', async () => {
  const clk = clock(); prep(clk, 'off');
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const D = await device(clk, LS, f);
  clk.advance(1000); assert.ok((await D.flow.reset()).ok); D.flow.drop(true);
  const b = await D.cloud.saveApi.newestBackup(); assert.ok(b);
  assert.ok((await D.flow.restoreBackup(b.id)).ok); await settle();
  assert.equal(D.log.at(-1), 'restored');
  assert.deepEqual(prefs(), ['1', 'off']);
  D.cloud.cancelPending();
});
test('[prefs] cloud load/merge (cloud copy wins and replaces the local save) keeps the consent keys', async () => {
  const clk = clock();
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const big = ajansSave(clk.now()); big.totalEarned *= 10; big.revision = 5;
  await server.upsert({ data: big, revision: 5 });
  prep(clk, 'off');
  const D = await device(clk, LS, f);
  assert.ok(D.ctrl.state.revision >= 5 && D.ctrl.state.totalEarned >= big.totalEarned, 'cloud save (higher revision) loaded');
  assert.deepEqual(prefs(), ['1', 'off']);
  D.cloud.cancelPending();
});
test('[prefs] cloud save (local wins, pushed) keeps the consent keys', async () => {
  const clk = clock(); prep(clk, 'on');
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const D = await device(clk, LS, f);
  assert.ok(f.reqs.some((q) => q.method === 'POST' && q.path === '/rest/v1/acik_ofis_saves'), 'pushed to the cloud');
  D.ctrl.state.money += 5; assert.notEqual(await D.cloud.pushNow(true), false);
  assert.deepEqual(prefs(), ['1', 'on']);
  D.cloud.cancelPending();
});
test('[prefs] sign-out keeps the consent keys (only the auth session is removed)', async () => {
  const clk = clock(); prep(clk, 'off');
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const D = await device(clk, LS, f);
  LS.setItem('acik_ofis_auth_v1', JSON.stringify(SESSION()));
  await D.cloud.signOut();
  assert.equal(LS.getItem('acik_ofis_auth_v1'), null);
  assert.deepEqual(prefs(), ['1', 'off']);
});
test('[prefs] another device\'s reset (409 -> current save loaded, otherDevice) keeps the consent keys', async () => {
  const clk = clock();
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  prep(clk, 'off');
  const A = await device(clk, LS, f);
  await server.resetSave();                                   // the other device resets on the server
  A.ctrl.state.money += 1;
  assert.equal(await A.cloud.pushNow(true), false); await settle();
  assert.deepEqual(A.log, ['otherDevice']);
  assert.deepEqual(prefs(), ['1', 'off']);
  A.cloud.cancelPending();
});

// ------------------------------------------------------------------ anonymous Supabase counter (kodhane_count_event)
test('[counter] no consent / "Kapat": the stage counter sends NOTHING; "Tamam": it sends; gameplay/cloud unaffected', async () => {
  const clk = clock(); LS.clear();
  const reqs = []; globalThis.fetch = async (url, o = {}) => { reqs.push(new URL(url).pathname); return new Response('true', { status: 200 }); };
  const client = new CloudClient({ url: 'https://sb.test', key: 'anon' });
  await client.countEvent('acikofis_stage_0');
  assert.deepEqual(reqs, [], 'not answered -> 0 requests');
  analytics().answer(false);
  await client.countEvent('acikofis_stage_0');
  assert.deepEqual(reqs, [], '"Kapat" -> 0 requests');
  analytics().setEnabled(true);
  await client.countEvent('acikofis_stage_0');
  assert.deepEqual(reqs, ['/rest/v1/rpc/kodhane_count_event'], 'consent on -> sent');
  analytics().setEnabled(false);
  await client.countEvent('acikofis_stage_1');
  assert.equal(reqs.length, 1, 'switched off -> stops at once');
  // leaderboard + cloud save are not gated
  await client.leaderboard(10).catch(() => {});
  assert.equal(reqs.at(-1), '/rest/v1/rpc/kodhane_leaderboard', 'leaderboard works without consent');
});
test('[counter] Controller stage events reach countEvent only through the gate (main.js wiring)', () => {
  const src = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /ctrl\.on\('count', \(name\) => \{ cloud\.client\.countEvent\(name\)/);
  const cloud = fs.readFileSync(new URL('../../src/cloud/cloud.js', import.meta.url), 'utf8');
  assert.match(cloud, /countEvent\(name\) \{ if \(!counterAllowed\(\)\) return Promise\.resolve\(null\);/);
  assert.equal((cloud.match(/countRpc/g) || []).length, 2, 'the RPC is only called from countEvent()');
});
test('[counter] cloud save / login do not depend on consent (consent off, signed in: reconcile pushes)', async () => {
  const clk = clock(); prep(clk, 'off');
  const server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now }); const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const D = await device(clk, LS, f);
  assert.ok(f.reqs.some((q) => q.method === 'POST' && q.path === '/rest/v1/acik_ofis_saves'));
  assert.equal(f.reqs.some((q) => q.path === '/rest/v1/rpc/kodhane_count_event'), false);
  D.cloud.cancelPending();
});
