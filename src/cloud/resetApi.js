/*
 * v2.2 "Baştan başla" — save / reset / restore transport with the server `revision` rule.
 *
 * FOLLOWS THE BACKEND CONTRACT: docs/v2.2-backend-client-notes.md + supabase/migrations/20260928160000_v2_2_save_safety.sql
 * (branch v2.2-backend, 1392c49). Summary of what this client relies on:
 *  - acik_ofis_saves has `revision bigint` (+ server-managed `best_score`, `strict_revision`; client may only read them).
 *  - Save write = the existing REST upsert (POST /rest/v1/acik_ofis_saves?on_conflict=user_id) with body
 *    { user_id, data, save_version, updated_at, revision } where revision = last seen server revision + 1.
 *    Success -> last seen = sent. The client also puts the same number in data.revision (local saves / other tabs).
 *  - Stale write -> HTTP 409, code "PT409", message "stale_revision" (revision < server, or = server once the row is
 *    strict) or "stale_write" (legacy write without a new revision that would lower totalEarned).
 *    On 409 the client re-reads the row, loads it (never overwrites it) and shows reset.otherDevice.
 *  - RPC names: game-specific, kept only in cloud.js `RPC` (reset = acik_ofis_reset_save, restore = acik_ofis_restore_save).
 *  - Reset:   POST /rest/v1/rpc/<RPC.reset>   {} -> { game, revision, backup_id, best_score }
 *             Row is not deleted: backup taken, progress cleared server-side, revision + 1. No row yet -> revision 0,
 *             backup_id null. best_score (leaderboard), nickname and the account stay.
 *  - Restore: POST /rest/v1/rpc/<RPC.restore> { "p_backup_id": "<uuid>" } -> { game, revision, backup_id, restored_from, best_score }
 *             Own backup < 30 days only, else 404 code "PT404" message "backup_not_found". No revision check.
 *             The 10 s "Geri al" uses it with the reset's backup_id; the client then writes its (fresher) in-memory
 *             snapshot with revision = returned + 1.
 *  - Read:    GET /rest/v1/acik_ofis_saves?select=data,save_version,updated_at,revision,best_score&user_id=eq.<uid>
 *  - No DELETE (42501) and no empty-save write: the client resets only through RPC.reset.
 *
 * TRANSPORTS
 *  - 'real' (default): Supabase via CloudClient, for signed-in players. Guests have no server row: their reset / undo
 *    is local only (the local revision still protects other tabs of this browser, see Controller.checkStale).
 *  - 'mock' (VITE_RESET_MOCK=1, tests, dev): MockSaveServer, an in-browser copy of the SQL above (same rules, same error
 *    codes/shapes) stored in localStorage and shared by every tab (BroadcastChannel + storage events). Used for
 *    everyone (guests too) so the flow can be tried without an account.
 */
export const ERR_STALE = 'stale';                    // normalized: PT409 stale_revision | stale_write
export const ERR_BACKUP_NOT_FOUND = 'backup_not_found';
export const GAME = 'acik_ofis';
export const UNDO_MS = 10000;                        // client-side undo window (server keeps backups 30 days)
export const BACKUP_RETENTION_MS = 30 * 24 * 3600e3;
export const MOCK_KEY = 'acik_ofis_mock_server_v2';
export const CHANNEL = 'acik_ofis_revision';

export class ApiError extends Error {
  constructor(code, info = {}) { super(info.message || code); this.code = code; this.reason = info.reason || ''; this.current = info.current || null; this.cause = info.cause; }
}
export const isStale = (e) => !!e && e.code === ERR_STALE;
export const isBackupNotFound = (e) => !!e && e.code === ERR_BACKUP_NOT_FOUND;
// PostgREST error (as CloudClient.api throws it: err.status, err.code = body.code, err.message = body.message) -> ApiError
export function classify(e) {
  if (!e || e instanceof ApiError) return e;
  const msg = e.message || '';
  if (e.status === 409 || e.code === 'PT409' || /stale_(revision|write)/.test(msg)) return new ApiError(ERR_STALE, { reason: /stale_write/.test(msg) ? 'stale_write' : 'stale_revision', message: msg, cause: e });
  if (e.code === 'PT404' || /backup_not_found/.test(msg)) return new ApiError(ERR_BACKUP_NOT_FOUND, { message: msg, cause: e });
  return e;
}
function pgError(status, code, message, details) { const e = new Error(message); e.status = status; e.code = code; e.details = details; return e; }

function n0(x) { return typeof x === 'number' && isFinite(x) ? Math.max(0, Math.floor(x)) : 0; }
function envOf() { try { return (import.meta && import.meta.env) || {}; } catch (e) { return {}; } }
export function resolveMode(env = envOf()) { return env.VITE_RESET_MOCK === '1' || env.VITE_RESET_MOCK === 'true' ? 'mock' : 'real'; }
function uuid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
// public.save_score(data): data.totalEarned if a finite number >= 0, else 0
export function saveScore(d) { const v = d && d.totalEarned; return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0; }
// public.save_reset_payload('acik_ofis', old, now): desks/staff/items omitted (migrate() rebuilds the founder office)
export function resetPayload(old, nowMs) {
  const sc = old && old.flags && Array.isArray(old.flags.stagesCounted) ? old.flags.stagesCounted : [];
  return { v: old && typeof old.v === 'number' ? old.v : 2, startedAt: nowMs, lastSaved: nowMs, lastTick: nowMs, resetAt: nowMs,
    money: 0, totalEarned: 0, projectsDone: 0, catNaps: 0, taps: 0, playSec: 0, simSec: 0, stage: 0,
    offers: [], projects: [], buffs: [], upgrades: [], items: [], flags: { cloudAsked: true, stagesCounted: sc } };
}

// ------------------------------------------------------------------ mock server (same rules as the SQL)
export class MockSaveServer {
  constructor(storage, opts = {}) {
    this.storage = storage; this.key = opts.key || MOCK_KEY;
    this.now = opts.now || (() => Date.now());
    this.strictMode = !!opts.strict;        // game_config revision_mode.acik_ofis = 'strict'
    this.listeners = []; this.channel = null;
    const useBc = opts.broadcast !== undefined ? opts.broadcast : typeof window !== 'undefined';
    if (useBc && typeof BroadcastChannel !== 'undefined') {
      try { this.channel = new BroadcastChannel(opts.channelName || CHANNEL); this.channel.onmessage = (e) => this.fire(e.data); } catch (e) { this.channel = null; }
    }
    if (useBc && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', (e) => { if (e.key === this.key) { const r = this.load().row; this.fire({ revision: r ? r.revision : 0 }); } });
    }
  }
  load() {
    let s = null; try { s = JSON.parse(this.storage.getItem(this.key) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = { row: null, backups: [] };
    if (!Array.isArray(s.backups)) s.backups = [];
    const t = this.now(); s.backups = s.backups.filter((b) => b.createdAt > t - BACKUP_RETENTION_MS);
    return s;
  }
  store(s, announce) { this.storage.setItem(this.key, JSON.stringify(s)); if (announce && this.channel) { try { this.channel.postMessage({ revision: s.row ? s.row.revision : 0 }); } catch (e) { /* ignore */ } } }
  fire(msg) { for (const f of this.listeners) { try { f(msg || {}); } catch (e) { /* ignore */ } } }
  subscribe(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  close() { if (this.channel) { try { this.channel.close(); } catch (e) { /* ignore */ } this.channel = null; } }
  // GET row
  async pull() { const r = this.load().row; return r ? { data: r.data, save_version: r.data && r.data.v || 1, updated_at: new Date(r.updatedAt).toISOString(), revision: r.revision, best_score: r.best } : null; }
  // upsert + trigger save_before_write
  async upsert({ data, revision }) {
    const s = this.load(), t = this.now(), clone = data ? JSON.parse(JSON.stringify(data)) : null;
    if (!s.row) {
      const rev = n0(revision), prevBest = s.backups.reduce((m, b) => Math.max(m, b.best || 0), 0);
      s.row = { data: clone, revision: rev, strict: rev > 0, best: Math.max(saveScore(clone), prevBest), updatedAt: t };
    } else {
      const old = s.row;
      let rev = revision == null ? old.revision : n0(revision), strict;
      if (rev < old.revision) throw pgError(409, 'PT409', 'stale_revision', 'sent revision ' + rev + ', server revision ' + old.revision);
      if (rev === old.revision) {
        if (old.strict || this.strictMode) throw pgError(409, 'PT409', 'stale_revision', 'sent revision ' + rev + ', server revision ' + old.revision);
        if (saveScore(clone) < saveScore(old.data)) throw pgError(409, 'PT409', 'stale_write', 'totalEarned would drop');
        rev = old.revision + 1; strict = false;
      } else strict = true;
      s.row = { data: clone, revision: rev, strict, best: Math.max(old.best, saveScore(clone)), updatedAt: t };
    }
    this.store(s, false);
    return { revision: s.row.revision };
  }
  // rpc RPC.reset (UPDATE fires save_before_write with a higher revision -> the row becomes strict)
  async resetSave() {
    const s = this.load(), t = this.now();
    if (!s.row) return { game: GAME, revision: 0, backup_id: null, best_score: 0 };
    const id = uuid();
    s.backups.unshift({ id, revision: s.row.revision, payload: s.row.data, best: s.row.best, reason: 'reset', createdAt: t });
    s.row = Object.assign({}, s.row, { data: resetPayload(s.row.data, t), revision: s.row.revision + 1, strict: true, updatedAt: t });
    this.store(s, true);
    return { game: GAME, revision: s.row.revision, backup_id: id, best_score: s.row.best };
  }
  // rpc RPC.restore (same: strict afterwards)
  async restoreSave(backupId) {
    const s = this.load(), t = this.now(), b = s.backups.find((x) => x.id === backupId);
    if (!b) throw pgError(404, 'PT404', 'backup_not_found');
    let bid = null, rev;
    if (s.row) {
      bid = uuid();
      s.backups.unshift({ id: bid, revision: s.row.revision, payload: s.row.data, best: s.row.best, reason: 'restore', createdAt: t });
      rev = s.row.revision + 1;
      s.row = Object.assign({}, s.row, { data: b.payload, revision: rev, strict: true, updatedAt: t });
    } else {
      rev = b.revision + 1;
      s.row = { data: b.payload, revision: rev, strict: rev > 0, best: Math.max(saveScore(b.payload), b.best || 0), updatedAt: t };
    }
    this.store(s, true);
    return { game: GAME, revision: rev, backup_id: bid, restored_from: b.id, best_score: s.row.best };
  }
}

// ------------------------------------------------------------------ facade used by the reset flow / cloud sync
// api.remote: a server is in use (mock: always; real: signed in). api.mirrors: every local save is also written to it
// by the reset flow (mock only; in 'real' mode CloudSync does the throttled push).
export function createSaveApi({ mode = resolveMode(), client = null, storage, now, broadcast, strict } = {}) {
  const mock = mode === 'mock' ? new MockSaveServer(storage, { now, broadcast, strict }) : null;
  const signedIn = () => !!(client && client.user);
  const wrap = (p) => p.catch((e) => { throw classify(e); });
  const api = {
    mode, mock,
    get remote() { return mode === 'mock' || signedIn(); },
    get mirrors() { return mode === 'mock'; },
    resetSave() {
      return wrap((mock ? mock.resetSave() : client.resetSave()).then((js) => ({ revision: n0(js && js.revision), backupId: (js && js.backup_id) || null, bestScore: js && js.best_score })));
    },
    restoreSave({ backupId }) {
      return wrap((mock ? mock.restoreSave(backupId) : client.restoreSave(backupId)).then((js) => ({ revision: n0(js && js.revision), restoredFrom: js && js.restored_from })));
    },
    // revision = last seen + 1 (the caller decides); data.revision is set to the same number
    writeSave({ data, revision, keepalive }) {
      const body = Object.assign({}, data, { revision });
      if (!Array.isArray(body.desks) || !body.desks.length) return Promise.reject(new Error('empty save refused'));   // resets go through RPC.reset only
      return wrap((mock ? mock.upsert({ data: body, revision }) : client.push(body, keepalive, revision).then(() => ({ revision }))));
    },
    readSave() {
      return wrap((mock ? mock.pull() : client.pull(true)).then((row) => {
        if (!row) return null;
        const data = row.data && typeof row.data === 'object' ? row.data : null;
        return { data, revision: n0(row.revision != null ? row.revision : data && data.revision), bestScore: row.best_score };
      }));
    },
    subscribe: (fn) => (mock ? mock.subscribe(fn) : () => {}),
    close: () => mock && mock.close()
  };
  return api;
}
