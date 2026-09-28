// Optional cloud save on the shared Kodhane Supabase (same account as Kodhane), table public.acik_ofis_saves.
// Guest play is the default: nothing here runs (no network) until the player asks for it or already has a session.
// Login = 6-digit e-mail code only (POST /auth/v1/otp + /auth/v1/verify); no redirect links, no SDK.
// The key below is Supabase's public anon key (same one Kodhane ships); data access is guarded by RLS (auth.uid() = user_id).
import { chooseWinner, needsBackup } from '../logic/sync.js';
import { BACKUP_KEY } from '../logic/save.js';

const DEFAULTS = {
  url: 'https://supabase.teserix.com',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3OTA1NjI1NzAsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6ImFub24iLCJpc3MiOiJzdXBhYmFzZSJ9._ugMmDZoHw2uolYZUT5xeQbM3xiZnoCu9WZUv5-iNjk',
  table: 'acik_ofis_saves',
  storageKey: 'acik_ofis_auth_v1',
  pendingKey: 'acik_ofis_auth_pending',
  referralKey: 'acik_ofis_from_kodhane',       // opened from Kodhane (utm_source=kodhane), remembered locally
  referralCountedKey: 'acik_ofis_kodhane_signup_counted',
  countRpc: 'kodhane_count_event',
  lbRpc: 'kodhane_leaderboard',                 // shared with Kodhane; p_game keeps the lists apart
  lbGame: 'acik_ofis',
  profileTable: 'kodhane_profiles',             // one nickname per account, shared with Kodhane
  pushDelayMs: 30000,
  timeoutMs: 15000
};

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
// remember (locally only) that this player came from Kodhane; no network, no personal data
export function rememberReferral(search, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  try { if (new URLSearchParams(search || '').get('utm_source') === 'kodhane') lsSet(c.referralKey, '1'); } catch (e) { /* ignore */ }
}
export function isOnline() { return !('onLine' in navigator) || navigator.onLine !== false; }

export class CloudClient {
  constructor(cfg) {
    this.cfg = Object.assign({}, DEFAULTS, cfg || {});
    this.session = null;
    try { this.session = JSON.parse(lsGet(this.cfg.storageKey) || 'null'); } catch (e) { this.session = null; }
    this.refreshing = null;
  }
  get user() { return this.session && this.session.user ? this.session.user : null; }
  async api(path, { method = 'GET', body, token, headers = {}, keepalive = false } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.cfg.timeoutMs) : null;
    let res;
    try {
      res = await fetch(this.cfg.url + path, {
        method, keepalive, signal: ctl ? ctl.signal : undefined,
        headers: Object.assign({ apikey: this.cfg.key, Authorization: 'Bearer ' + (token || this.cfg.key), 'Content-Type': 'application/json' }, headers),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) { const err = new Error('network'); err.network = true; throw err; } finally { if (timer) clearTimeout(timer); }
    const txt = await res.text();
    let js = null; try { js = txt ? JSON.parse(txt) : null; } catch (e) { js = txt; }
    if (!res.ok) {
      const err = new Error((js && (js.msg || js.message || js.error_description || js.error)) || ('HTTP ' + res.status));
      err.status = res.status; err.code = js && (js.error_code || js.code); throw err;
    }
    return js;
  }
  saveSession(js) {
    const exp = js.expires_at || Math.floor(Date.now() / 1000) + (js.expires_in || 3600);
    this.session = { access_token: js.access_token, refresh_token: js.refresh_token, expires_at: exp, user: { id: js.user && js.user.id, email: js.user && js.user.email } };
    lsSet(this.cfg.storageKey, JSON.stringify(this.session));
  }
  clearSession() { this.session = null; lsDel(this.cfg.storageKey); }
  requestCode(email) { return this.api('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } }); }
  async verifyCode(email, code) {
    const js = await this.api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code } });
    if (!js || !js.access_token) throw new Error('no-session');
    this.saveSession(js);
    return this.user;
  }
  async token() {
    if (!this.session) throw new Error('signed-out');
    if (this.session.expires_at - 60 > Date.now() / 1000) return this.session.access_token;
    if (!this.refreshing) {
      this.refreshing = this.api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh_token } })
        .then((js) => { this.saveSession(js); return js.access_token; })
        .catch((e) => { if (e.status === 400 || e.status === 401 || e.status === 403) this.clearSession(); throw e; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async pull() {
    const tok = await this.token();
    const rows = await this.api('/rest/v1/' + this.cfg.table + '?select=data,save_version,updated_at&user_id=eq.' + encodeURIComponent(this.user.id), { token: tok });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async push(data, keepalive) {
    const tok = await this.token();
    const now = new Date().toISOString();
    await this.api('/rest/v1/' + this.cfg.table + '?on_conflict=user_id', {
      method: 'POST', token: tok, keepalive,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: this.user.id, data, save_version: data.v || 1, updated_at: now }
    });
    return now;
  }
  // anonymous per-day counter on the Kodhane Supabase (anon key only, never the user token; no personal data)
  countEvent(name) { return this.api('/rest/v1/rpc/' + this.cfg.countRpc, { method: 'POST', body: { p_event: name } }); }
  // v2 leaderboard: guests call with the public key only; signed in, the user token lets the list flag "is_me"
  async leaderboard(limit) {
    const tok = this.session ? await this.token().catch(() => null) : null;
    return this.api('/rest/v1/rpc/' + this.cfg.lbRpc, { method: 'POST', token: tok || undefined, body: { p_limit: limit || 50, p_game: this.cfg.lbGame } });
  }
  async getProfile() {
    const tok = await this.token();
    const rows = await this.api('/rest/v1/' + this.cfg.profileTable + '?select=nickname,hidden&user_id=eq.' + encodeURIComponent(this.user.id), { token: tok });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async saveNickname(nickname) {
    const tok = await this.token();
    await this.api('/rest/v1/' + this.cfg.profileTable + '?on_conflict=user_id', {
      method: 'POST', token: tok, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: this.user.id, nickname }
    });
  }
  async signOut() {
    const tok = this.session && this.session.access_token;
    this.clearSession();
    if (tok) { try { await this.api('/auth/v1/logout?scope=local', { method: 'POST', token: tok }); } catch (e) { /* local sign-out is enough */ } }
  }
}

// Sync glue between the controller and the client. status: guest|sending|code|verifying|syncing|saved|error
export class CloudSync {
  constructor(ctrl, cfg) {
    this.ctrl = ctrl;
    this.client = new CloudClient(cfg || (typeof window !== 'undefined' && window.ACIK_OFIS_CLOUD_CONFIG) || null);
    this.status = this.client.user ? 'syncing' : 'guest';
    this.message = ''; this.reconciled = false; this.reconciling = null;
    this.pushTimer = null; this.lastPushAt = 0; this.lastSig = ''; this.cooldownUntil = 0;
    this.pendingEmail = '';
    try { const p = JSON.parse(lsGet(this.client.cfg.pendingKey) || 'null'); if (p && Date.now() - p.at < 3600e3) this.pendingEmail = p.email; } catch (e) { /* ignore */ }
    this.listeners = [];
    ctrl.cloudHooks = { onSaved: () => this.schedulePush() };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
      window.addEventListener('pagehide', () => this.flush());
      window.addEventListener('online', () => { if (this.client.user && !this.reconciled) this.reconcile(); });
    }
    if (this.client.user && isOnline()) this.reconcile();
  }
  onChange(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  set(status, message) { this.status = status; this.message = message || ''; for (const f of this.listeners) { try { f(); } catch (e) { /* ignore */ } } }
  signedIn() { return !!this.client.user; }
  errKey(e, fallback) {
    if (!isOnline()) return 'cloud.offline';
    if (e && e.network) return 'cloud.unreachable';
    if (e && (e.status === 429 || /rate|security purposes/i.test(e.message || ''))) return 'cloud.rateLimit';
    return fallback;
  }
  setPending(email) {
    this.pendingEmail = email || '';
    if (email) lsSet(this.client.cfg.pendingKey, JSON.stringify({ email, at: Date.now() })); else lsDel(this.client.cfg.pendingKey);
  }
  async sendCode(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.set('error', 'cloud.badEmail'); return false; }
    if (Date.now() < this.cooldownUntil) return false;
    if (!isOnline()) { this.set('error', 'cloud.offline'); return false; }
    this.set('sending');
    try {
      await this.client.requestCode(email);
      this.cooldownUntil = Date.now() + 60000;
      this.setPending(email);
      this.set('code', 'cloud.sent');
      return true;
    } catch (e) { this.set('error', this.errKey(e, 'cloud.sendFail')); return false; }
  }
  async verify(code) {
    code = String(code || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(code)) { this.set('code', 'cloud.badCode'); return false; }
    if (!isOnline()) { this.set('code', 'cloud.offline'); return false; }
    this.set('verifying');
    try {
      await this.client.verifyCode(this.pendingEmail, code);
      this.setPending('');
      this.reconciled = false;
      await this.reconcile(true);
      return true;
    } catch (e) {
      const bad = e && (e.status === 403 || e.status === 400 || /expired|invalid|token/i.test(e.message || ''));
      this.set('code', bad && e.status !== 429 ? 'cloud.wrongCode' : this.errKey(e, 'cloud.wrongCode'));
      return false;
    }
  }
  sig(s) { const c = Object.assign({}, s); delete c.lastSaved; delete c.lastTick; try { return JSON.stringify(c); } catch (e) { return String(Math.random()); } }
  // first login migrates the local save; later logins merge by the Kodhane rule (higher lifetime earnings wins)
  reconcile(fromLogin) {
    if (!this.client.user) return Promise.resolve();
    if (this.reconciling) return this.reconciling;
    this.set('syncing');
    this.reconciling = (async () => {
      try {
        const row = await this.client.pull();
        this.ctrl.save();
        const local = JSON.parse(JSON.stringify(this.ctrl.state));
        const localTime = local.lastSaved || 0;
        const cloud = row && row.data && typeof row.data === 'object' ? row.data : null;
        const cloudTime = row ? (Date.parse(row.updated_at) || cloud && cloud.lastSaved || 0) : 0;
        const win = chooseWinner(local, localTime, cloud, cloudTime);
        let note = fromLogin ? 'cloud.loggedInToast' : '';
        if (win === 'cloud') {
          if (needsBackup(local, localTime, cloud, cloudTime)) { lsSet(BACKUP_KEY, JSON.stringify(local)); note = 'cloud.backupNote'; }
          this.ctrl.replaceState(cloud);
          note = note === 'cloud.backupNote' ? note : 'cloud.cloudLoaded';
        } else if (cloud && needsBackup(cloud, cloudTime, local, localTime)) {
          lsSet(BACKUP_KEY, JSON.stringify(cloud));
        }
        this.reconciled = true;
        const pushed = await this.pushNow(true);
        if (!row && pushed) this.countKodhaneSignup();
        if (note) this.toastKey = note;
      } catch (e) {
        this.set('error', this.errKey(e, 'cloud.unreachable'));
        if (!this.client.user) { this.reconciled = false; this.set('guest'); }
        else setTimeout(() => { if (this.client.user && !this.reconciled) this.reconcile(); }, 60000);
      } finally { this.reconciling = null; }
    })();
    return this.reconciling;
  }
  // first cloud save of a player who came from Kodhane -> count once (anonymous)
  countKodhaneSignup() {
    const c = this.client.cfg;
    if (lsGet(c.referralKey) !== '1' || lsGet(c.referralCountedKey)) return false;
    lsSet(c.referralCountedKey, '1');
    this.client.countEvent('acikofis_cloud_signup_kodhane').catch(() => {});
    return true;
  }
  schedulePush() {
    if (!this.client.user || !this.reconciled || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; this.pushNow(false); }, this.client.cfg.pushDelayMs);
  }
  async pushNow(force, keepalive) {
    if (!this.client.user || !this.reconciled) return false;
    const s = this.sig(this.ctrl.state);
    if (!force && s === this.lastSig) return true;
    if (!keepalive) this.set('syncing');
    try {
      await this.client.push(this.ctrl.state, keepalive);
      this.lastSig = s; this.lastPushAt = Date.now();
      this.set('saved');
      return true;
    } catch (e) {
      if (!this.client.user) { this.reconciled = false; this.set('guest'); return false; }
      this.set('error', this.errKey(e, 'cloud.unreachable'));
      return false;
    }
  }
  flush() {
    if (!this.client.user || !this.reconciled) return;
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    this.ctrl.save();
    this.pushNow(false, true);
  }
  async signOut() {
    await this.pushNow(false).catch(() => {});
    await this.client.signOut();
    this.reconciled = false; this.lastSig = '';
    this.set('guest', 'cloud.signedOut');
  }
}
