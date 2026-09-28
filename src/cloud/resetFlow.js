// v2.2 "Baştan başla" flow (no DOM): reset through the reset RPC (cloud.js RPC.reset, via resetApi), 10 s undo with RPC.restore
// (snapshot kept in memory + localStorage backup), stale-write handling (409 PT409 or a newer revision in another tab:
// load the current save, show reset.otherDevice, never overwrite it).
// state.revision = the last server revision this client has seen (guests: a local counter bumped by resets).
// opts.ui hooks (all optional): { undoShown(pending), undoGone(), restored(), otherDevice(kind: 'reset'|'sync'), failed(key) }
// opts.beforeReset(): e.g. cancel a pending cloud push; opts.pushNow(): write the restored save at once (real server).
import { UNDO_MS, isStale, isBackupNotFound } from './resetApi.js';

export const UNDO_KEY = 'acik_ofis_reset_undo_v1';
const clone = (x) => JSON.parse(JSON.stringify(x));
// content signature without the clock fields (same idea as CloudSync.sig)
export function sig(s) { const c = Object.assign({}, s); delete c.lastSaved; delete c.lastTick; delete c.revision; try { return JSON.stringify(c); } catch (e) { return String(Math.random()); } }

// v2.2: why was our write stale? The 409 itself cannot tell (a v2.2 client always gets stale_revision), so look at
// what we loaded: a later game start (reset payload / newState after a reset: new startedAt) or an empty payload =
// 'reset' (reset.otherDevice); the same game played on elsewhere, or an older backup restored = 'sync' (reset.otherDeviceSync).
export function staleKind(mine, data) {
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return 'reset';
  const a = +data.startedAt || 0, b = +(mine && mine.startedAt) || 0;
  return a > b + 1000 ? 'reset' : 'sync';
}

export class ResetFlow {
  constructor(ctrl, api, opts = {}) {
    this.ctrl = ctrl; this.api = api; this.opts = opts;
    this.storage = opts.storage || ctrl.storage;
    this.now = opts.now || (() => Date.now());
    this.setTimer = opts.setTimer || ((f, ms) => setTimeout(f, ms));
    this.clearTimer = opts.clearTimer || ((id) => clearTimeout(id));
    this.undoMs = opts.undoMs || UNDO_MS;
    this.ui = opts.ui || {};
    this.pending = null; this.timer = null; this.busy = false; this.adopting = null; this.mirroring = Promise.resolve();
    this.unsubs = [
      ctrl.on('stale', (e) => { this.handleStale({ data: e.data, revision: e.revision }); }),
      ctrl.on('saved', (st) => { this.mirror(st); })
    ];
    if (api.subscribe) this.unsubs.push(api.subscribe((msg) => this.onRemote(msg)));
  }
  hook(name, arg) { const f = this.ui[name]; if (f) { try { f(arg); } catch (e) { /* ui is optional */ } } }
  undoLeftMs() { return this.pending ? Math.max(0, this.pending.until - this.now()) : 0; }
  canUndo() { return this.undoLeftMs() > 0; }
  rev() { return this.ctrl.state.revision || 0; }

  async reset() {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (this.ctrl.checkStale()) return { ok: false, reason: 'stale' };   // this tab was behind: it just loaded the current save
    this.busy = true; this.ctrl.resetting = true;                        // no saves while the request is in flight
    try {
      if (this.opts.beforeReset) { try { this.opts.beforeReset(); } catch (e) { /* ignore */ } }
      let r;
      if (this.api.remote) {
        try { r = await this.api.resetSave(); r.revision = Math.max(r.revision, this.rev() + 1); } catch (e) {   // no row yet -> server says 0
          this.busy = false; this.ctrl.resetting = false;
          if (isStale(e)) { await this.handleStale(null); return { ok: false, reason: 'stale' }; }
          this.hook('failed', 'reset.failed'); return { ok: false, reason: 'network' };   // nothing reset (no local-only reset for accounts)
        }
      } else r = { revision: this.rev() + 1, backupId: null };             // guest: local only, the bump protects other tabs
      this.ctrl.resetting = false;
      this.drop(false);                                                    // an older undo (if any) is gone now
      const snapshot = clone(this.ctrl.state);
      snapshot.lastSaved = this.now();
      this.pending = { backupId: r.backupId, snapshot, revision: r.revision, until: this.now() + this.undoMs, remote: !!this.api.remote };
      try { this.storage.setItem(UNDO_KEY, JSON.stringify(this.pending)); } catch (e) { /* memory copy is enough */ }
      this.ctrl.applyReset(r.revision, this.now(), { cloudAsked: !!this.api.remote || undefined });
      this.arm();
      this.hook('undoShown', this.pending);
      return { ok: true, backupId: r.backupId, revision: r.revision };
    } finally { this.busy = false; this.ctrl.resetting = false; }
  }
  async undo() {
    const p = this.pending;
    if (!p || !this.canUndo()) { this.drop(true); return { ok: false, reason: 'expired' }; }
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true; this.ctrl.resetting = true;
    try {
      let revision;
      if (p.remote && p.backupId && this.api.remote) {
        try { revision = (await this.api.restoreSave({ backupId: p.backupId })).revision; } catch (e) {
          this.busy = false; this.ctrl.resetting = false;
          if (isBackupNotFound(e)) { this.drop(true); this.hook('failed', 'reset.undoExpired'); return { ok: false, reason: 'expired' }; }
          if (isStale(e)) { this.drop(true); await this.handleStale(null); return { ok: false, reason: 'stale' }; }
          this.hook('failed', 'reset.failed'); return { ok: false, reason: 'network' };   // still undoable until the timer ends
        }
      } else revision = p.remote ? this.rev() : this.rev() + 1;           // no server backup (no row yet) / guest
      this.ctrl.resetting = false;
      this.drop(true);
      const snap = clone(p.snapshot);
      snap.revision = revision;
      // the in-memory snapshot is fresher than the server backup (up to one push interval): write it right away
      this.ctrl.replaceState(snap, this.now());
      if (p.remote && this.opts.pushNow) { try { this.opts.pushNow(); } catch (e) { /* next autosave */ } }
      this.hook('restored');
      return { ok: true, revision };
    } finally { this.busy = false; this.ctrl.resetting = false; }
  }
  // settings row: restore a server backup (signed-in players). The server copy is loaded as is (no local snapshot here).
  async restoreBackup(backupId) {
    if (this.busy || !this.api.remote || !backupId) return { ok: false, reason: 'busy' };
    this.busy = true; this.ctrl.resetting = true;
    try {
      if (this.opts.beforeReset) { try { this.opts.beforeReset(); } catch (e) { /* ignore */ } }
      let r, cur;
      try { r = await this.api.restoreSave({ backupId }); cur = await this.api.readSave(); } catch (e) {
        // restored but not read back: our revision stays behind the server, so the next write gets 409 and loads it
        this.hook('failed', 'reset.restoreFailed'); return { ok: false, reason: isBackupNotFound(e) ? 'expired' : 'network' };
      }
      this.ctrl.resetting = false;
      this.drop(true);
      this.ctrl.adoptRemote(cur && cur.data, Math.max(r.revision, cur ? cur.revision : 0), this.now());
      this.mirrorSig = sig(this.ctrl.state);
      if (this.opts.adopted) { try { this.opts.adopted(); } catch (e) { /* ignore */ } }
      this.hook('restored');
      return { ok: true, revision: this.rev() };
    } finally { this.busy = false; this.ctrl.resetting = false; }
  }
  arm() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = null; this.drop(true); }, this.undoLeftMs());
  }
  // forget the undo snapshot (memory + localStorage backup); the server backup stays (30 days, RPC.listBackups)
  drop(notify) {
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    const had = !!this.pending;
    this.pending = null;
    try { this.storage.removeItem(UNDO_KEY); } catch (e) { /* ignore */ }
    if (had && notify) this.hook('undoGone');
  }
  // page reloaded inside the 10 s window: the localStorage backup brings the undo back for the time that is left
  resume() {
    let b = null;
    try { b = JSON.parse(this.storage.getItem(UNDO_KEY) || 'null'); } catch (e) { b = null; }
    if (!b || !b.snapshot || !(b.until > this.now()) || b.revision > this.rev()) {
      try { this.storage.removeItem(UNDO_KEY); } catch (e) { /* ignore */ }
      return false;
    }
    // only on the very game that reset started (normal saves may have raised the revision since; another tab's
    // reset/restore would have replaced the save with a different startedAt)
    if (Math.abs((this.ctrl.state.startedAt || 0) - (b.until - this.undoMs)) > 1000) { try { this.storage.removeItem(UNDO_KEY); } catch (e) { /* ignore */ } return false; }
    this.pending = b; this.arm(); this.hook('undoShown', b);
    return true;
  }
  // a write was refused (or another tab has a newer revision): load the current save, never overwrite it
  handleStale(current) {
    if (this.busy) return Promise.resolve(false);          // our own reset/undo is in flight; its answer decides
    if (this.adopting) return this.adopting;
    this.adopting = (async () => {
      try {
        let cur = current;
        if (!cur) { try { cur = await this.api.readSave(); } catch (e) { cur = null; } }
        if (!cur || (cur.revision || 0) <= this.rev()) return false;
        const kind = staleKind(this.ctrl.state, cur.data);
        this.drop(true);
        this.ctrl.adoptRemote(cur.data, cur.revision, this.now());
        this.mirrorSig = sig(this.ctrl.state);             // what we just loaded is the server copy: nothing to write back
        this.hook('otherDevice', kind);
        return true;
      } finally { this.adopting = null; }
    })();
    return this.adopting;
  }
  // mock transport only: mirror each local save to the mock server like CloudSync's push does on the real one
  mirror(state) {
    if (!this.api.mirrors) return this.mirroring;
    const run = async () => {
      if (state !== this.ctrl.state) return;
      const now = sig(state);
      if (this.mirrorSig && now === this.mirrorSig) return;
      this.mirrorSig = null;
      const next = (state.revision || 0) + 1;
      try { await this.api.writeSave({ data: state, revision: next }); if (state === this.ctrl.state && (state.revision || 0) < next) state.revision = next; } catch (e) { if (isStale(e)) await this.handleStale(null); }
    };
    this.mirroring = this.mirroring.then(run, run);
    return this.mirroring;
  }
  onRemote(msg) {
    if (msg && typeof msg.revision === 'number' && msg.revision > this.rev()) this.handleStale(null);
  }
  destroy() { for (const u of this.unsubs) u(); this.unsubs = []; if (this.timer) this.clearTimer(this.timer); }
}
