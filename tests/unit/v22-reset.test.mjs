// v2.2: "Baştan başla" against the Backend v2.2 contract (RPC.reset / RPC.restore / revision on every write,
// 409 PT409 stale_revision|stale_write, 404 PT404 backup_not_found). The mock server mirrors the SQL; the "real" tests
// run the real CloudClient/CloudSync over a fake fetch that answers like PostgREST (backed by the same mock).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../../src/logic/economy.js';
import * as S from '../../src/logic/save.js';
import * as SY from '../../src/logic/sync.js';
import * as I from '../../src/logic/i18n.js';
import { Controller } from '../../src/game.js';
import { createSaveApi, MockSaveServer, classify, ERR_STALE, ERR_BACKUP_NOT_FOUND, UNDO_MS, resolveMode, MOCK_KEY } from '../../src/cloud/resetApi.js';
import { ResetFlow, UNDO_KEY } from '../../src/cloud/resetFlow.js';
import { CloudClient, CloudSync, RPC } from '../../src/cloud/cloud.js';
import { HoldGesture, HOLD_MS } from '../../src/ui/hold.js';
import { resetLists } from '../../src/logic/resetInfo.js';
import { ajansSave } from '../smoke/grown.mjs';

const T0 = Date.UTC(2026, 8, 28, 13, 0, 0);
const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));
I.registerLocales({ tr }); I.setLocale('tr');
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
function clock(t = T0) {
  const c = { t, timers: [] };
  c.now = () => c.t;
  c.setTimer = (f, ms) => { const tm = { f, at: c.t + ms }; c.timers.push(tm); return tm; };
  c.clearTimer = (tm) => { c.timers = c.timers.filter((x) => x !== tm); };
  c.advance = (ms) => { c.t += ms; for (const tm of c.timers.filter((x) => x.at <= c.t)) { c.timers = c.timers.filter((x) => x !== tm); tm.f(); } };
  return c;
}
const hooks = (log) => ({ undoShown: () => log.push('undoShown'), undoGone: () => log.push('undoGone'), restored: () => log.push('restored'), otherDevice: () => log.push('otherDevice'), failed: (k) => log.push('failed:' + k) });
// one tab/device on the MOCK transport: controller + api + flow
function tab(storage, clk, serverStorage = storage) {
  const ctrl = new Controller(storage, clk.now());
  const api = createSaveApi({ mode: 'mock', storage: serverStorage, now: clk.now, broadcast: false });
  const log = [];
  const flow = new ResetFlow(ctrl, api, { storage, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, ui: hooks(log) });
  return { ctrl, api, flow, log };
}
function seeded(clk) { const st = memStorage(); st.setItem(S.SAVE_KEY, S.serialize(ajansSave(clk.now()), clk.now())); return st; }
const row = (server) => JSON.parse(server.getItem(MOCK_KEY)).row;

// ------------------------------------------------------------------ mock server = the SQL rules
test('mode: real Backend RPCs by default, VITE_RESET_MOCK=1 selects the in-browser mock', () => {
  assert.equal(resolveMode({}), 'real');
  assert.equal(resolveMode({ VITE_RESET_MOCK: '1' }), 'mock');
});
test('mock server: write rule (revision = last seen + 1), PT409 stale_revision / stale_write shapes, lenient legacy writes', async () => {
  const srv = new MockSaveServer(memStorage(), { broadcast: false });
  const shape = (msg) => (e) => e.status === 409 && e.code === 'PT409' && e.message === msg;
  // legacy client (no revision) on a lenient row: accepted, server assigns +1; a drop in totalEarned = the v2.1.1 bug
  assert.deepEqual(await srv.upsert({ data: { totalEarned: 270000 } }), { revision: 0 });
  assert.deepEqual(await srv.upsert({ data: { totalEarned: 280000 } }), { revision: 1 });
  await assert.rejects(srv.upsert({ data: { totalEarned: 0 } }), shape('stale_write'));
  // v2.2 client: explicit increasing revision -> strict row
  assert.deepEqual(await srv.upsert({ data: { totalEarned: 1 }, revision: 2 }), { revision: 2 });
  await assert.rejects(srv.upsert({ data: { totalEarned: 9e9 }, revision: 2 }), shape('stale_revision'), 'equal = second device/tab');
  await assert.rejects(srv.upsert({ data: { totalEarned: 9e9 }, revision: 1 }), shape('stale_revision'));
  await assert.rejects(srv.upsert({ data: { totalEarned: 9e9 } }), shape('stale_revision'), 'strict: legacy write refused');
  assert.equal((await srv.pull()).best_score, 280000, 'best_score never decreases');
  const e = classify(Object.assign(new Error('stale_write'), { status: 409, code: 'PT409' }));
  assert.equal(e.code, ERR_STALE); assert.equal(e.reason, 'stale_write');
});
test('mock server: RPC.reset keeps the row (backup, cleared payload, revision + 1, best_score kept); RPC.restore; PT404', async () => {
  const srv = new MockSaveServer(memStorage(), { broadcast: false, now: () => T0 });
  assert.deepEqual(await srv.resetSave(), { game: 'acik_ofis', revision: 0, backup_id: null, best_score: 0 }, 'no row yet');
  await srv.upsert({ data: { v: 2, totalEarned: 5000, money: 70, desks: [1, 2], flags: { stagesCounted: [0, 1] } }, revision: 1 });
  const r = await srv.resetSave();
  assert.equal(r.revision, 2); assert.ok(r.backup_id); assert.equal(r.best_score, 5000);
  const p = await srv.pull();
  assert.equal(p.data.totalEarned, 0); assert.equal(p.data.desks, undefined, 'desks omitted -> migrate() builds the founder office');
  assert.deepEqual(p.data.flags, { cloudAsked: true, stagesCounted: [0, 1] });
  assert.equal(S.migrate(p.data, T0).desks.length, 1);
  await assert.rejects(srv.upsert({ data: { totalEarned: 5000 }, revision: 2 }), (e) => e.code === 'PT409', 'late write with the reset revision');
  await assert.rejects(srv.upsert({ data: { totalEarned: 5000 }, revision: 1 }), (e) => e.code === 'PT409', 'late write with the pre-reset revision');
  const back = await srv.restoreSave(r.backup_id);
  assert.equal(back.revision, 3); assert.equal(back.restored_from, r.backup_id); assert.ok(back.backup_id, 'restore backs up the current row too');
  assert.equal((await srv.pull()).data.money, 70);
  await assert.rejects(srv.restoreSave('nope'), (e) => e.status === 404 && e.code === 'PT404' && e.message === 'backup_not_found');
  assert.equal(classify(Object.assign(new Error('backup_not_found'), { status: 404, code: 'PT404' })).code, ERR_BACKUP_NOT_FOUND);
});
test('merge rule: a higher cloud revision wins over earnings; a higher local revision does not win by itself', () => {
  assert.equal(SY.chooseWinner({ totalEarned: 900, revision: 3 }, 9, { totalEarned: 0, revision: 4 }, 1), 'cloud');
  assert.equal(SY.chooseWinner({ totalEarned: 0, revision: 9 }, 9, { totalEarned: 900, revision: 1 }, 1), 'cloud', 'earnings rule');
  assert.equal(SY.chooseWinner({ totalEarned: 30, revision: 2 }, 1, { totalEarned: 20, revision: 2 }, 9), 'local');
  assert.equal(SY.chooseWinner({ totalEarned: 10 }, 5, { totalEarned: 20 }, 1), 'cloud');
});
test('revision lives in the save; old saves load with revision 0', () => {
  const old = JSON.parse(S.serialize(ajansSave(T0), T0)); delete old.revision;
  assert.equal(S.migrate(old, T0).revision, 0);
  const s = ajansSave(T0); s.revision = 7;
  assert.equal(S.deserialize(S.serialize(s, T0), T0).revision, 7);
  assert.equal(E.newState(T0).revision, 0);
});

// ------------------------------------------------------------------ real CloudClient over a fake PostgREST
function fakeSupabase(server) {
  const reqs = [];
  const reply = (status, js) => new Response(js === undefined ? '' : JSON.stringify(js), { status });
  const fetch = async (url, o = {}) => {
    const u = new URL(url), body = o.body ? JSON.parse(o.body) : null, method = o.method || 'GET';
    reqs.push({ method, path: u.pathname, search: u.search, body });
    try {
      if (method === 'DELETE') return reply(403, { code: '42501', message: 'permission denied' });
      if (u.pathname === '/rest/v1/rpc/' + RPC.reset) return reply(200, await server.resetSave());
      if (u.pathname === '/rest/v1/rpc/' + RPC.restore) return reply(200, await server.restoreSave(body.p_backup_id));
      if (u.pathname === '/rest/v1/acik_ofis_saves' && method === 'GET') { const r = await server.pull(); return reply(200, r ? [r] : []); }
      if (u.pathname === '/rest/v1/acik_ofis_saves' && method === 'POST') { await server.upsert({ data: body.data, revision: body.revision }); return reply(201); }
      if (u.pathname.startsWith('/rest/v1/rpc/')) return reply(200, true);
      return reply(404, {});
    } catch (e) { return reply(e.status || 500, { code: e.code, message: e.message, details: e.details || null }); }
  };
  return { fetch, reqs };
}
function signedClient() {
  const c = new CloudClient({ url: 'https://sb.test', key: 'anon' });
  c.session = { access_token: 'jwt', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@b.c' } };
  return c;
}
// a signed-in device on the REAL transport: CloudSync (throttled pushes with revision) + flow
async function device(clk, storage, fake) {
  const ctrl = new Controller(storage, clk.now());
  const cloud = new CloudSync(ctrl, { url: 'https://sb.test', key: 'anon' }, { saveApi: (client) => createSaveApi({ mode: 'real', client, storage: memStorage(), now: clk.now }) });
  cloud.client.session = signedClient().session;
  const log = [];
  const flow = new ResetFlow(ctrl, cloud.saveApi, { storage, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, beforeReset: () => cloud.cancelPending(), pushNow: () => cloud.pushNow(true), ui: hooks(log) });
  cloud.onStale = (cur) => flow.handleStale(cur);
  await cloud.reconcile();
  return { ctrl, cloud, flow, log };
}
test('real client: RPC names/params and upsert body follow the Backend notes; reads select revision,best_score', async () => {
  const server = new MockSaveServer(memStorage(), { broadcast: false });
  const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const api = createSaveApi({ mode: 'real', client: signedClient(), storage: memStorage() });
  assert.equal(api.remote, true); assert.equal(api.mirrors, false);
  await assert.rejects(api.writeSave({ data: {}, revision: 1 }), 'an empty save is never written');
  assert.deepEqual(await api.writeSave({ data: { v: 2, totalEarned: 10, desks: [{ id: 1 }] }, revision: 1 }), { revision: 1 });
  const r = await api.resetSave();
  assert.equal(r.revision, 2); assert.ok(r.backupId);
  assert.equal((await api.restoreSave({ backupId: r.backupId })).revision, 3);
  await assert.rejects(api.writeSave({ data: { v: 2, desks: [{ id: 1 }] }, revision: 3 }), (e) => e.code === ERR_STALE && e.reason === 'stale_revision');
  await assert.rejects(api.restoreSave({ backupId: 'x' }), (e) => e.code === ERR_BACKUP_NOT_FOUND);
  const cur = await api.readSave();
  assert.equal(cur.revision, 3); assert.equal(cur.data.totalEarned, 10);
  const [w, rs, rr] = f.reqs;
  assert.equal(w.path, '/rest/v1/acik_ofis_saves'); assert.equal(w.search, '?on_conflict=user_id');
  assert.equal(w.body.revision, 1); assert.equal(w.body.data.revision, 1); assert.equal(w.body.user_id, 'u1');
  assert.deepEqual([rs.path, rs.body], ['/rest/v1/rpc/acik_ofis_reset_save', {}]);
  assert.equal(rr.path, '/rest/v1/rpc/acik_ofis_restore_save'); assert.deepEqual(rr.body, { p_backup_id: r.backupId });
  assert.match(f.reqs.at(-1).search, /select=data,save_version,updated_at,revision,best_score/);
  assert.equal(f.reqs.some((q) => q.method === 'DELETE'), false);
});
test('real, two devices: A resets via RPC.reset (no empty save write) -> B\'s push gets 409 -> B loads + otherDevice; then B resets -> A; undo restores', async () => {
  const clk = clock(), server = new MockSaveServer(memStorage(), { broadcast: false, now: clk.now });
  const f = fakeSupabase(server); globalThis.fetch = f.fetch;
  const A = await device(clk, seeded(clk), f);
  assert.equal(A.ctrl.state.revision, 1, 'first push sent revision 1');
  const B = await device(clk, seeded(clk), f);                      // same account, other device: cloud (rev 1) wins
  assert.equal(B.ctrl.state.revision, 2, 'B took rev 1, pushed rev 2');
  A.ctrl.state.revision = 2;                                        // (A pulled in between; keep the story simple)
  const before = JSON.parse(JSON.stringify(A.ctrl.state));
  const n = f.reqs.length;
  assert.ok((await A.flow.reset()).ok);
  const during = f.reqs.slice(n);
  assert.deepEqual(during.map((q) => q.method + ' ' + q.path), ['POST /rest/v1/rpc/' + RPC.reset], 'reset = the RPC only');
  assert.equal(A.ctrl.state.revision, 3); assert.equal(A.ctrl.state.money, 0);
  // B (rev 2) keeps playing -> push revision 3 = server 3 -> 409 -> B loads the reset save
  B.ctrl.state.money += 1;
  assert.equal(await B.cloud.pushNow(true), false);
  await settle();
  assert.deepEqual(B.log, ['otherDevice']);
  assert.equal(B.ctrl.state.revision, 3); assert.equal(B.ctrl.state.totalEarned, 0); assert.equal(B.ctrl.state.desks.length, 1);
  assert.equal((await server.pull()).data.totalEarned, 0, 'B did not overwrite the reset');
  // A undoes within 10 s: RPC.restore(backup_id) -> revision 4, then A writes its fresher snapshot as revision 5
  clk.advance(5000);
  assert.ok((await A.flow.undo()).ok);
  await settle();
  assert.equal(A.ctrl.state.revision, 5);
  const now = await server.pull();
  assert.equal(now.revision, 5); assert.equal(now.data.desks.length, before.desks.length); assert.equal(now.data.totalEarned, before.totalEarned);
  // reverse: B (rev 3, stale) resets -> A's next push is refused and A loads B's reset
  B.ctrl.state.revision = 5;                                        // B pulled the restored save meanwhile
  assert.ok((await B.flow.reset()).ok);
  A.ctrl.state.money += 1;
  assert.equal(await A.cloud.pushNow(true), false); await settle();
  assert.equal(A.ctrl.state.revision, 6); assert.equal(A.ctrl.state.totalEarned, 0);
  assert.deepEqual(A.log, ['undoShown', 'undoGone', 'restored', 'otherDevice']);
  assert.equal(f.reqs.some((q) => q.method === 'DELETE'), false, 'no DELETE anywhere');
  assert.equal(f.reqs.filter((q) => q.method === 'POST' && q.path === '/rest/v1/acik_ofis_saves').every((q) => Number.isInteger(q.body.revision)), true, 'every save write carries revision');
  A.cloud.cancelPending(); B.cloud.cancelPending();   // no 30 s push timers left behind
});
test('real, RPC.reset fails (offline): nothing is reset locally, reset.failed', async () => {
  const clk = clock();
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const st = seeded(clk), ctrl = new Controller(st, clk.now()), log = [];
  const api = createSaveApi({ mode: 'real', client: signedClient(), storage: memStorage() });
  const flow = new ResetFlow(ctrl, api, { storage: st, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, ui: hooks(log) });
  const money = ctrl.state.money;
  assert.equal((await flow.reset()).ok, false);
  assert.equal(ctrl.state.money, money); assert.equal(ctrl.resetting, false); assert.deepEqual(log, ['failed:reset.failed']);
});
test('real, guest (no account): reset/undo are local only, no network, the local revision still bumps', async () => {
  const clk = clock(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network for guests'); };
  const st = seeded(clk), ctrl = new Controller(st, clk.now()), log = [];
  const api = createSaveApi({ mode: 'real', client: new CloudClient({ url: 'https://sb.test', key: 'anon' }), storage: memStorage() });
  const flow = new ResetFlow(ctrl, api, { storage: st, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, ui: hooks(log) });
  const money = ctrl.state.money;
  assert.ok((await flow.reset()).ok);
  assert.equal(ctrl.state.revision, 1); assert.equal(ctrl.state.money, 0);
  clk.advance(3000);
  assert.ok((await flow.undo()).ok);
  assert.equal(ctrl.state.revision, 2); assert.ok(ctrl.state.money >= money);
  assert.equal(calls, 0);
});

// ------------------------------------------------------------------ flow on the mock (tabs share localStorage)
test('reset: new game with the server revision, stored locally, the cloud hook is NOT called (no empty cloud save)', async () => {
  const clk = clock(), st = seeded(clk), A = tab(st, clk);
  A.ctrl.save(); await settle();
  const pushes = []; A.ctrl.cloudHooks = { onSaved: (s) => pushes.push(s.revision) };
  const before = JSON.parse(JSON.stringify(A.ctrl.state));
  const r = await A.flow.reset();
  assert.ok(r.ok, JSON.stringify(r));
  const s = A.ctrl.state;
  assert.equal(s.revision, 2); assert.equal(s.money, 0); assert.equal(s.desks.length, 1); assert.equal(s.items.length, 0); assert.equal(s.stage, 0);
  assert.deepEqual(s.flags.stagesCounted, before.flags.stagesCounted, 'anonymous stage counter is not counted twice (same as the server payload)');
  assert.deepEqual(pushes, [], 'reset goes only through RPC.reset, never through a save push');
  assert.equal(JSON.parse(st.getItem(S.SAVE_KEY)).revision, 2);
  assert.equal(row(st).data.totalEarned, 0); assert.equal(row(st).revision, 2);
  const backup = JSON.parse(st.getItem(UNDO_KEY));
  assert.equal(backup.snapshot.money, before.money); assert.equal(backup.backupId, r.backupId);
  assert.deepEqual(A.log, ['undoShown']);
});
test('undo within 10 s restores the previous office; the snapshot + backup are then gone', async () => {
  const clk = clock(), st = seeded(clk), A = tab(st, clk);
  A.ctrl.save(); await settle();
  const before = JSON.parse(JSON.stringify(A.ctrl.state));
  await A.flow.reset();
  clk.advance(9000);
  assert.ok(A.flow.canUndo());
  const r = await A.flow.undo();
  assert.ok(r.ok, JSON.stringify(r));
  await settle();
  const s = A.ctrl.state;
  assert.equal(s.desks.length, before.desks.length); assert.equal(s.items.length, before.items.length); assert.equal(s.stage, before.stage);
  assert.ok(s.totalEarned >= before.totalEarned); assert.equal(s.staff.length, before.staff.length);
  assert.equal(st.getItem(UNDO_KEY), null); assert.equal(A.flow.pending, null);
  assert.equal(row(st).revision, 4, 'RPC.restore = 3, then the snapshot was written as 4');
  assert.equal(row(st).data.desks.length, before.desks.length);
  assert.deepEqual(A.log, ['undoShown', 'undoGone', 'restored']);
  assert.equal((await A.flow.undo()).ok, false, 'undo works once');
});
test('after 10 s the undo is gone (memory + localStorage backup), undo() refuses', async () => {
  const clk = clock(), st = seeded(clk), A = tab(st, clk);
  await A.flow.reset();
  assert.ok(st.getItem(UNDO_KEY));
  clk.advance(UNDO_MS);
  assert.equal(A.flow.pending, null); assert.equal(st.getItem(UNDO_KEY), null);
  assert.deepEqual(A.log, ['undoShown', 'undoGone']);
  const r = await A.flow.undo();
  assert.equal(r.ok, false); assert.equal(A.ctrl.state.money, 0);
});
test('reload inside the undo window: the localStorage backup brings the undo back for the remaining time', async () => {
  const clk = clock(), st = seeded(clk), A = tab(st, clk);
  A.ctrl.save(); await settle();
  const money = A.ctrl.state.money;
  await A.flow.reset();
  clk.advance(4000);
  const A2 = tab(st, clk);                    // "page reload": same storage, new controller + flow
  assert.equal(A2.flow.resume(), true);
  assert.deepEqual(A2.log, ['undoShown']);
  assert.equal(A2.flow.undoLeftMs(), 6000);
  assert.ok((await A2.flow.undo()).ok);
  assert.ok(A2.ctrl.state.money >= money - 1e-6);
  const A3 = tab(st, clk); assert.equal(A3.flow.resume(), false, 'used backup does not come back');
});
test('two tabs (shared storage, mock): A resets -> B\'s stale write is refused, B loads the current save + otherDevice; then B resets -> A', async () => {
  const clk = clock(), shared = seeded(clk);
  const A = tab(shared, clk);
  A.ctrl.save(); await settle(); A.ctrl.save();                     // server rev 1, stored rev 1
  const B = tab(shared, clk);
  assert.equal(B.ctrl.state.revision, 1);
  // A resets
  assert.ok((await A.flow.reset()).ok);
  assert.equal(A.ctrl.state.revision, 2);
  const staleB = JSON.parse(JSON.stringify(B.ctrl.state));
  B.ctrl.state.money += 123;
  assert.equal(B.ctrl.save(), false, 'B must not overwrite the reset');
  await settle();
  assert.equal(JSON.parse(shared.getItem(S.SAVE_KEY)).money, 0);
  assert.equal(B.ctrl.state.revision, 2); assert.equal(B.ctrl.state.money, 0); assert.equal(B.ctrl.state.desks.length, 1);
  assert.deepEqual(B.log, ['otherDevice']);
  // the server itself also refuses B's old revision (PT409 stale_revision)
  await assert.rejects(B.api.writeSave({ data: staleB, revision: 2 }), (e) => e.code === ERR_STALE && e.reason === 'stale_revision');
  // A keeps playing (normal saves go through: revision 3)
  A.ctrl.state.money = 500; assert.equal(A.ctrl.save(), true); await settle();
  assert.equal(A.ctrl.state.revision, 3);
  // reverse: B resets, A's write is refused and A loads B's reset
  assert.ok((await B.flow.reset()).ok);
  assert.equal(B.ctrl.state.revision, 4);
  A.ctrl.state.money = 999;
  assert.equal(A.ctrl.save(), false);
  await settle();
  assert.equal(A.ctrl.state.revision, 4); assert.equal(A.ctrl.state.money, 0);
  assert.deepEqual(A.log, ['undoShown', 'undoGone', 'otherDevice'], 'A\'s own undo is dropped, then otherDevice');
  assert.equal(JSON.parse(shared.getItem(S.SAVE_KEY)).money, 0);
  assert.equal((await A.flow.undo()).ok, false, 'A\'s old undo cannot bring its office back over B\'s reset');
});
test('two devices (own local storage, shared mock server): the server refuses the stale write, B loads the current save', async () => {
  const clk = clock(), server = memStorage();
  const A = tab(seeded(clk), clk, server), B = tab(seeded(clk), clk, server);
  A.ctrl.save(); await settle();                                    // server rev 1 (A)
  B.ctrl.save(); await settle();                                    // B sends 1 = server 1 -> stale -> B loads A's copy
  assert.equal(B.ctrl.state.revision, 1); B.log.length = 0;
  assert.ok((await A.flow.reset()).ok);                             // server rev 2
  B.ctrl.state.money += 50;
  assert.equal(B.ctrl.save(), true, 'local write on device B is fine...');
  await settle();
  assert.deepEqual(B.log, ['otherDevice'], '...but the server refused it');
  assert.equal(B.ctrl.state.revision, 2); assert.equal(B.ctrl.state.money, 0);
  assert.equal(row(server).data.totalEarned, 0);
  // reverse
  A.ctrl.state.money = 42; A.ctrl.save(); await settle();          // rev 3
  assert.ok((await B.flow.reset()).ok);                             // rev 4
  A.ctrl.state.money = 43; A.ctrl.save(); await settle();          // sends 4 = 4 -> refused
  assert.equal(A.ctrl.state.revision, 4); assert.equal(A.ctrl.state.money, 0);
  assert.equal(A.log.filter((x) => x === 'otherDevice').length, 1);
});
test('a stale tab that tries to reset loads the current save instead (no second reset)', async () => {
  const clk = clock(), shared = seeded(clk);
  const A = tab(shared, clk), B = tab(shared, clk);
  A.ctrl.save(); await settle(); A.ctrl.save(); B.log.length = 0;
  await A.flow.reset();
  const rev = row(shared).revision;
  const r = await B.flow.reset();
  assert.equal(r.ok, false); assert.equal(r.reason, 'stale'); await settle();
  assert.equal(B.ctrl.state.revision, rev); assert.equal(row(shared).revision, rev);
});

// ------------------------------------------------------------------ confirm dialog + hold button
test('confirm lists come from the save: office/money/staff/items/upgrades/stats go; account + leaderboard stay (signed in)', () => {
  const s = ajansSave(T0);
  const g = resetLists(s, { signedIn: false, languages: 1 });
  assert.deepEqual(g.remove.map((x) => x.key), ['reset.del.office', 'reset.del.money', 'reset.del.staff', 'reset.del.items', 'reset.del.upgrades', 'reset.del.projects', 'reset.del.stats']);
  assert.deepEqual(g.keep.map((x) => x.key), ['reset.keep.nothing']);
  assert.equal(g.remove.find((x) => x.key === 'reset.del.staff').vars.n, s.staff.length - 1);
  const signed = resetLists(s, { signedIn: true, email: 'a@b.c', languages: 2 });
  assert.deepEqual(signed.keep.map((x) => x.key), ['reset.keep.account', 'reset.keep.leaderboard', 'reset.keep.backup', 'reset.keep.language']);
  const fresh = resetLists(E.newState(T0), {});
  assert.deepEqual(fresh.remove.map((x) => x.key), ['reset.del.office', 'reset.del.money', 'reset.del.stats'], 'empty parts are not listed');
  for (const it of [...g.remove, ...signed.keep, ...g.keep]) assert.equal(typeof I.raw(it.key), 'string', it.key);
  for (const k of ['reset.deleteTitle', 'reset.keepTitle', 'reset.undo', 'reset.otherDevice', 'reset.holdHint', 'reset.done', 'reset.restored', 'reset.failed', 'reset.undoExpired'])
    assert.equal(typeof I.raw(k), 'string', k);
  assert.equal(I.t('reset.deleteTitle'), 'Silinecekler'); assert.equal(I.t('reset.keepTitle'), 'Kalacaklar'); assert.equal(I.t('reset.undo'), 'Geri al');
});
test('hold gesture: 2 s press confirms once, early release cancels and resets the fill', () => {
  assert.equal(HOLD_MS, 2000);
  const g = new HoldGesture();
  assert.equal(g.press(0), true); assert.equal(g.progress(1000), 0.5);
  assert.equal(g.tick(1999), false);
  g.release(); assert.equal(g.progress(1999), 0); assert.equal(g.holding, false);
  g.press(5000); assert.equal(g.press(5100), false, 'a second pointer/key does not restart');
  assert.equal(g.tick(6999), false); assert.equal(g.tick(7000), true); assert.equal(g.tick(8000), false, 'fires once');
  assert.equal(g.progress(9000), 1); assert.equal(g.press(9000), false);
});

test('RPC names: game-specific, defined once in cloud.js RPC, never hardcoded at call sites; mock rows become strict after reset/restore', async () => {
  assert.deepEqual({ ...RPC }, { reset: 'acik_ofis_reset_save', restore: 'acik_ofis_restore_save', listBackups: 'acik_ofis_list_save_backups' });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]));
  const src = new URL('../../src', import.meta.url).pathname;
  for (const f of walk(src).filter((f) => f.endsWith('.js'))) {
    const txt = fs.readFileSync(f, 'utf8');
    const hits = (txt.match(/['"`](acik_ofis_)?(reset_save|restore_save|list_save_backups)['"`]/g) || []);
    if (f.endsWith('/cloud/cloud.js')) assert.equal(hits.length, 3, 'the three names live in RPC only'); else assert.deepEqual(hits, [], f);
    assert.equal(/method:\s*['"]DELETE|\.from\([^)]*\)\s*\.delete\(/i.test(txt), false, 'no DELETE request in ' + f);
  }
  const mem = new Map(), storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const srv = new MockSaveServer(storage, { broadcast: false });
  await srv.upsert({ data: { totalEarned: 5 }, revision: null });           // legacy client: lenient row
  await srv.upsert({ data: { totalEarned: 6 } });                         // equal revision accepted + bumped (lenient)
  const r = await srv.resetSave();
  await assert.rejects(srv.upsert({ data: { totalEarned: 1 }, revision: r.revision }), (e) => e.code === 'PT409' && e.message === 'stale_revision', 'strict after reset');
  await srv.restoreSave(r.backup_id);
  await assert.rejects(srv.upsert({ data: { totalEarned: 9 } }), (e) => e.code === 'PT409' && e.message === 'stale_revision', 'strict after restore');
});
