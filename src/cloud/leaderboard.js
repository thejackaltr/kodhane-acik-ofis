import { track } from '../analytics.js';
// v2: "Sıralama · Tüm Zamanlar" — the Kodhane leaderboard function with p_game='acik_ofis'.
// Score = the cloud save's totalEarned (all-time). Nickname rules, the admin hide switch and the plausibility check are
// the same server-side objects Kodhane uses (the nickname itself is shared with Kodhane: one per account).
// Nicknames are only ever written with textContent. The client-side nickname check mirrors the database rules
// (kodhane_nick_problem) just for quick feedback; the database is the authority.
import { h, clear, add } from '../ui/dom.js';
import { t } from '../logic/i18n.js';
import { tl } from '../logic/format.js';
import { STAGES } from '../logic/config.js';
import { isOnline } from './cloud.js';

export const LIMIT = 50;
export const STALE_MS = 60000;
const NICK_RE = /^[A-Za-z0-9\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc _-]+$/;
const HAS_ALNUM = /[A-Za-z0-9\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/;
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'kodhane', 'teserix', 'sistem', 'system', 'support', 'destek', 'root', 'null', 'undefined'];
const BLOCK_EXACT = ['amk', 'aq', 'mk', 'oc', 'pic', 'got', 'sik', 'am', 'amq', 'sg', 'siq', 'ass', 'fag', 'cum', 'tits', 'nazi'];
const BLOCK_SUB = ['orospu', 'siktir', 'sikis', 'sikik', 'sikim', 'sikey', 'yarrak', 'yarak', 'amcik', 'aminak', 'aminako',
  'gavat', 'pezevenk', 'kahpe', 'yavsak', 'ibne', 'pust', 'kaltak', 'surtuk', 'serefsiz', 'godos', 'dalyarak', 'tassak', 'amcuk',
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'whore', 'slut', 'dick', 'pussy', 'asshole', 'faggot', 'hitler', 'porn'];
function trMap(s, from, to) { let out = ''; for (const c of s) { const j = from.indexOf(c); out += j === -1 ? c : to[j]; } return out; }
// same as the database's kodhane_nick_key: I/İ/ı/i all fold to 'i'
export function nickKey(n) { return trMap(String(n), '\u00c7\u011e\u0130I\u00d6\u015e\u00dc\u0131', '\u00e7\u011fii\u00f6\u015f\u00fci').toLowerCase(); }
export function normalizeNickname(raw) { return String(raw == null ? '' : raw).trim().replace(/ {2,}/g, ' '); }
export function validateNickname(raw) {
  const v = normalizeNickname(raw), len = Array.from(v).length;
  if (len < 3) return { ok: false, value: v, error: 'too_short' };
  if (len > 16) return { ok: false, value: v, error: 'too_long' };
  if (!NICK_RE.test(v) || !HAS_ALNUM.test(v)) return { ok: false, value: v, error: 'invalid_chars' };
  const flat = trMap(nickKey(v).replace(/[ _-]/g, ''), '\u00e7\u011f\u00f6\u015f\u00fc013457', 'cgosuoieast');
  if (RESERVED.includes(flat) || BLOCK_EXACT.includes(flat)) return { ok: false, value: v, error: 'blocked' };
  for (const w of BLOCK_SUB) if (flat.includes(w)) return { ok: false, value: v, error: 'blocked' };
  return { ok: true, value: v, error: null };
}
export function serverNickError(err) {
  const code = err && err.code, msg = (err && err.message) || '';
  if (code === '23505' || /duplicate|unique/i.test(msg)) return 'taken';
  if (code === '23514') for (const k of ['too_short', 'too_long', 'invalid_chars', 'blocked']) if (msg.includes(k)) return k;
  if ((err && err.network) || /Failed to fetch|NetworkError|offline/i.test(msg)) return 'offline';
  return 'failed';
}
function validRow(r) {
  return r && typeof r.nickname === 'string' && (r.status == null || r.status === 'ok') && typeof r.score === 'number' && isFinite(r.score) && r.score >= 0 && typeof r.rank === 'number';
}
// server: top N in order (+ the caller's row appended when outside); own 'pending'/'hidden' row without rank
export function buildView(rows, limit = LIMIT) {
  const all = Array.isArray(rows) ? rows : [];
  let meStatus = null;
  for (const r of all) if (r && r.is_me && (r.status === 'pending' || r.status === 'hidden')) meStatus = r.status;
  const ok = all.filter(validRow), top = ok.slice(0, limit), me = ok.find((r) => r.is_me) || null;
  return { top, me, pinned: me && !top.includes(me) ? me : null, empty: top.length === 0, meStatus: me ? null : meStatus };
}
export function stageName(i) { const st = typeof i === 'number' ? STAGES[i] : null; return st ? t('stages.' + st.id) : ''; }
export function rankBadge(rank) { return rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : rank === 3 ? '\u{1F949}' : '#' + rank; }

export class LeaderboardUI {
  constructor(sync, ui) {
    this.sync = sync; this.ui = ui; this.box = null;
    this.L = { rows: null, view: null, loading: false, error: '', fetchedAt: 0, seq: 0, uid: null, nickname: null, hidden: false,
      profileUid: null, profileLoading: false, profileError: false, editing: false, saving: false, msg: '', draft: '' };
    sync.onChange(() => {
      const u = sync.client.user, uid = u ? u.id : null;
      if (uid !== this.L.uid) { Object.assign(this.L, { uid, nickname: null, hidden: false, profileUid: null, profileError: false, editing: false, msg: '', fetchedAt: 0 }); if (this.open()) { this.loadProfile(); this.refresh(); } }
    });
  }
  open() { return !!(this.box && this.box.isConnected); }
  show() {
    this.ui.showModal((box, close) => { this.box = box; this.close = close; box.classList.add('lb'); this.render(); this.onShown(); }, { cls: 'lb' });
  }
  onShown() {
    if (this.sync.client.user) this.loadProfile();
    if (!this.L.loading && (Date.now() - this.L.fetchedAt > STALE_MS || this.L.error)) this.refresh(); else this.render();
  }
  async refresh() {
    const L = this.L;
    if (!isOnline()) { L.error = 'offline'; L.loading = false; this.render(); return; }
    const my = ++L.seq; L.loading = true; L.error = ''; this.render();
    try {
      // signed in: push the current save first so the own score is fresh (max 5 s)
      if (this.sync.client.user && this.sync.reconciled) { this.sync.ctrl.save(); await Promise.race([this.sync.pushNow(true).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]); }
      const rows = await this.sync.client.leaderboard(LIMIT);
      if (my !== L.seq) return;
      L.rows = rows; L.view = buildView(rows); L.fetchedAt = Date.now();
      if (L.view.meStatus === 'hidden') L.hidden = true; else if (L.view.me || L.view.meStatus === 'pending') L.hidden = false;
    } catch (e) { if (my === L.seq) L.error = isOnline() ? 'failed' : 'offline'; }
    if (my === L.seq) { L.loading = false; this.render(); }
  }
  async loadProfile(force) {
    const L = this.L, u = this.sync.client.user;
    if (!u || L.profileLoading) return;
    if (!force && L.profileUid === u.id && !L.profileError) return;
    L.profileLoading = true; L.profileError = false; this.render();
    try { const r = await this.sync.client.getProfile(); L.profileUid = u.id; L.nickname = r && r.nickname ? r.nickname : null; L.hidden = !!(r && r.hidden); }
    catch (e) { L.profileError = true; }
    L.profileLoading = false; this.render();
  }
  async submit(value) {
    const L = this.L;
    if (L.saving) return;
    const v = validateNickname(value); L.draft = value;
    if (!v.ok) { L.msg = 'lb.errors.' + v.error; this.render(true); return; }
    if (!isOnline()) { L.msg = 'lb.errors.offline'; this.render(true); return; }
    L.saving = true; L.msg = ''; this.render();
    try {
      await this.sync.client.saveNickname(v.value);
      const first = !L.nickname;
      L.hidden = L.hidden && !!L.nickname && nickKey(L.nickname) === nickKey(v.value); // same rule as the server
      Object.assign(L, { nickname: v.value, profileUid: this.sync.client.user.id, editing: false, saving: false, draft: '' });
      this.ui.toast(t(first ? 'lb.joined' : 'lb.updated', { v: v.value }), 'ok');
      this.render(); this.loadProfile(true); this.refresh();
    } catch (e) { L.saving = false; L.msg = 'lb.errors.' + serverNickError(e); this.render(true); }
  }
  share() {
    const me = this.L.view && this.L.view.me; if (!me) return;
    track('share_click');
    const link = location.origin + location.pathname.replace(/index\.html$/, '');
    const text = t('lb.shareText', { n: me.rank }) + ' ' + link;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => this.ui.toast(t('lb.copied'), 'ok'), () => this.ui.toast(text));
    else this.ui.toast(text);
  }
  row(r) {
    return h('li', { class: 'lb-row' + (r.is_me ? ' me' : ''), 'data-test': 'lb-row' },
      h('span', { class: 'lb-rank', text: rankBadge(r.rank) }),
      h('div', { class: 'lb-who' }, h('div', { class: 'lb-name' }, h('span', { text: r.nickname }), r.is_me ? h('span', { class: 'lb-you', text: t('lb.you') }) : null),
        stageName(r.stage) ? h('small', { class: 'dim', text: stageName(r.stage) }) : null),
      h('span', { class: 'lb-score', text: tl(r.score) }));
  }
  render(focus) {
    if (!this.open()) return;
    const L = this.L, box = clear(this.box), u = this.sync.client.user;
    add(box, h('header', { class: 'lb-head' }, h('div', null, h('h2', { text: t('lb.title') }), h('span', { class: 'tag', text: t('lb.tab') })),
      h('button', { class: 'btn ghost', 'data-test': 'lb-refresh', disabled: L.loading, onclick: () => { if (u) this.loadProfile(true); this.refresh(); } }, '\u21bb ' + t('lb.refresh'))),
    h('p', { class: 'dim', text: t('lb.info') }));
    // join / own status
    const join = h('div', { class: 'lb-join', 'data-test': 'lb-join' });
    if (!u) {
      add(join, h('p', { text: t('lb.signIn') }), h('button', { class: 'btn primary', 'data-test': 'lb-signin', onclick: () => { this.close(); this.ui.opts.cloud.renderPanel(this.ui); } }, t('lb.signInBtn')));
    } else if (L.profileError && L.profileUid !== u.id) {
      add(join, h('p', { text: t('lb.profileFail') }), h('button', { class: 'btn ghost', onclick: () => this.loadProfile(true) }, t('lb.retry')));
    } else if (L.profileLoading && L.profileUid !== u.id) {
      join.classList.add('hidden');
    } else if (!L.nickname || L.editing || L.hidden) {
      const input = h('input', { type: 'text', maxlength: '16', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('lb.placeholder'), 'aria-label': t('lb.label'), 'data-test': 'lb-nick' });
      input.value = L.draft || (L.editing && !L.hidden ? L.nickname : '') || '';
      input.addEventListener('input', () => { L.draft = input.value; });
      add(join, L.hidden ? h('p', { class: 'lb-flag', 'data-test': 'lb-hidden', text: t('lb.hidden') }) : null,
        h('form', { class: 'col', novalidate: true, onsubmit: (e) => { e.preventDefault(); this.submit(input.value); } },
          h('label', { class: 'dim', text: t('lb.label') }), input,
          h('button', { class: 'btn primary', type: 'submit', disabled: L.saving, 'data-test': 'lb-save' }, L.saving ? t('lb.saving') : t('lb.join'))),
        h('p', { class: 'dim', text: t('lb.hint') + ' ' + t('lb.shared') }),
        L.msg ? h('p', { class: 'msg err', 'data-test': 'lb-msg', text: t(L.msg) }) : null,
        L.editing && !L.hidden ? h('button', { class: 'btn ghost', onclick: () => { L.editing = false; L.msg = ''; L.draft = ''; this.render(); } }, t('lb.cancel')) : null);
      if (focus) setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 0);
    } else {
      const me = L.view && L.view.me;
      if (me) add(join, h('p', { class: 'lb-joined', 'data-test': 'lb-own', text: t('lb.ownRank', { n: me.rank }) }), me.rank === 1 ? h('p', { class: 'dim', text: t('lb.top') }) : null);
      else if (L.view && L.view.meStatus === 'pending') add(join, h('p', { class: 'lb-flag', 'data-test': 'lb-pending', text: t('lb.pending') }));
      else if (L.view) add(join, h('p', { class: 'dim', text: t('lb.notYet') }));
      add(join, h('div', { class: 'row' }, me ? h('button', { class: 'btn ghost', 'data-test': 'lb-share', onclick: () => this.share() }, t('lb.share')) : null,
        h('button', { class: 'btn ghost', 'data-test': 'lb-edit', onclick: () => { L.editing = true; L.msg = ''; L.draft = ''; this.render(true); } }, t('lb.edit'))));
    }
    add(box, join);
    let status = '';
    if (L.error === 'offline') status = t('lb.offline'); else if (L.error) status = t('lb.failed');
    else if (L.loading && !L.view) status = t('lb.loading'); else if (L.view && L.view.empty) status = t('lb.empty');
    if (status) add(box, h('p', { class: 'lb-status' + (L.error ? ' err' : ''), 'data-test': 'lb-status', text: status }));
    const v = L.view;
    if (v && !v.empty) {
      add(box, h('ol', { class: 'lb-list', 'data-test': 'lb-list' }, v.top.map((r) => this.row(r))));
      if (v.pinned) add(box, h('div', { class: 'lb-gap', text: '\u22ef' }), h('ol', { class: 'lb-list' }, this.row(v.pinned)));
    }
    add(box, h('button', { class: 'btn ghost', onclick: () => this.close() }, t('menu.close')));
  }
}
