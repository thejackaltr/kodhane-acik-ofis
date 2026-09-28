// v2.3 Umami (analiz.teserix.com), KVKK-gated: no script tag in index.html, dynamic load only after "Tamam", events
// before consent are dropped (not queued), the off switch stops at once, re-enable resumes, SW rule, event hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAnalytics, WEBSITE_ID, DOMAINS, SCRIPT_SRC, KEYS, BEFORE_SEND, GATE_SUPABASE_COUNTER } from '../../src/analytics.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
// minimal DOM: records appended <script> elements and their listeners
function fakeEnv(host = 'acikofis.teserix.com', protocol = 'https:') {
  const appended = [];
  const listeners = {};
  const win = { location: { hostname: host, protocol }, addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } };
  const doc = {
    createElement: () => { const el = { attrs: {}, ev: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(t, f) { this.ev[t] = f; } }; return el; },
    head: { appendChild: (el) => { appended.push(el); return el; } }
  };
  return { win, doc, appended, listeners };
}
const consentOn = (st) => { st.setItem(KEYS.notice, '1'); st.setItem(KEYS.pref, 'on'); };

test('index.html has NO Umami script (loaded at runtime only after consent); constants moved to analytics.js', () => {
  const html = read('index.html');
  assert.equal(/<script[^>]*analiz\.teserix\.com/.test(html), false);
  assert.equal(SCRIPT_SRC, 'https://analiz.teserix.com/script.js');
  assert.equal(WEBSITE_ID, '5ebd71d2-4e8f-4822-a110-1f2c7d56f94e');
  assert.equal(DOMAINS, 'acikofis.teserix.com,thejackaltr.github.io');
  assert.ok(!DOMAINS.includes('localhost'));
  assert.deepEqual(KEYS, { pref: 'acik_ofis_tel', notice: 'acik_ofis_tel_notice', umamiOff: 'umami.disabled' });
  // only this game's id anywhere in the sources
  const src = read('src/analytics.js');
  assert.ok(!src.includes('6a036eb3-5974-482f-bcce-dbdf0a383f36') && !src.includes('04257fdf-e069-4ecb-9b6a-196aa1e83242'));
});

test('service worker never caches cross-origin (Umami script / api)', () => {
  const sw = read('sw.template.js');
  assert.ok(sw.includes('if (url.origin !== location.origin) return;'));
  assert.ok(!sw.includes('analiz.teserix.com/script.js\''));
});

test('gate: before the notice nothing loads and events are DROPPED (game_start included), nothing is queued', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  assert.equal(A.noticeNeeded(), true); assert.equal(A.consent(), false);
  assert.equal(A.track('game_start'), 'off');
  assert.equal(A.track('share_click'), 'off');
  assert.equal(A.sync(), false);
  assert.equal(E.appended.length, 0, 'no script before consent');
  assert.deepEqual(A.queued(), []); assert.deepEqual(A.tracked(), []);
  assert.equal(st.getItem(KEYS.umamiOff), null, 'nothing Umami-related stored before the answer');
});

test('"Tamam": the script is injected with DNT / exclude-search / exclude-hash / before-send; earlier events are NOT sent later', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  A.track('game_start');                               // before consent -> dropped for good
  assert.equal(A.answer(true), true);
  assert.equal(E.appended.length, 1);
  const s = E.appended[0];
  assert.equal(s.src, SCRIPT_SRC); assert.equal(s.defer, true);
  assert.deepEqual([s.attrs['data-website-id'], s.attrs['data-domains'], s.attrs['data-before-send'], s.attrs['data-do-not-track'], s.attrs['data-exclude-search'], s.attrs['data-exclude-hash']],
    [WEBSITE_ID, DOMAINS, BEFORE_SEND, 'true', 'true', 'true']);
  assert.equal(A.track('share_click'), 'queued');     // consent on, tracker still loading -> tiny in-memory queue
  const calls = []; E.win.umami = { track: (...a) => calls.push(a) };
  s.ev.load();
  assert.deepEqual(calls, [['share_click']], 'game_start from before "Tamam" is never sent');
  assert.equal(A.track('cloud_save'), 'sent');
  assert.deepEqual(calls.at(-1), ['cloud_save']);
  assert.equal(A.sync(), true); assert.equal(E.appended.length, 1, 'loaded once');
});

test('"Kapat": no script, no queue, umami.disabled set; later sessions stay off', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  assert.equal(A.answer(false), false);
  assert.equal(A.track('game_start'), 'off'); assert.equal(E.appended.length, 0);
  assert.equal(st.getItem(KEYS.umamiOff), '1');
  const B = createAnalytics({ win: E.win, doc: E.doc, storage: st });       // next session
  assert.equal(B.noticeNeeded(), false); assert.equal(B.sync(), false); assert.equal(E.appended.length, 0);
});

test('off switch after "Tamam": track() rechecks consent, before-send drops every request, umami.disabled set; back on resumes', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  A.answer(true);
  const calls = []; E.win.umami = { track: (...a) => calls.push(a) };
  E.appended[0].ev.load();
  assert.equal(A.track('game_start'), 'sent');
  A.setEnabled(false);
  assert.equal(A.track('reset_or_prestige'), 'off');
  assert.deepEqual(calls, [['game_start']]);
  assert.equal(E.win[BEFORE_SEND]('event', { name: 'x' }), null, 'before-send drops (incl. automatic pageviews)');
  assert.equal(st.getItem(KEYS.umamiOff), '1');
  A.setEnabled(true);
  assert.equal(st.getItem(KEYS.umamiOff), null);
  assert.deepEqual(E.win[BEFORE_SEND]('event', { name: 'x' }), { name: 'x' });
  assert.equal(A.track('reset_or_prestige'), 'sent');
  assert.deepEqual(calls.at(-1), ['reset_or_prestige']);
});

test('re-enable from the switch loads the script when it was never loaded (answered "Kapat" first)', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  A.answer(false); assert.equal(E.appended.length, 0);
  A.setEnabled(true); assert.equal(E.appended.length, 1);
});

test('switch while the notice is still open answers it; a queued event is dropped if consent is gone when the script arrives', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  A.setEnabled(true); assert.equal(A.noticeNeeded(), false);
  assert.equal(A.track('share_click'), 'queued');
  st.setItem(KEYS.pref, 'off');                         // switched off in another tab before the tracker loaded
  const calls = []; E.win.umami = { track: (...a) => calls.push(a) };
  E.appended[0].ev.load();
  assert.deepEqual(calls, []);
});

test('never on localhost / 127.0.0.1 / file: / unknown hosts, even with consent', () => {
  for (const [host, proto] of [['localhost', 'http:'], ['127.0.0.1', 'http:'], ['0.0.0.0', 'http:'], ['[::1]', 'http:'], ['', 'file:'], ['preview.example.com', 'https:']]) {
    const st = memStorage(); consentOn(st);
    const E = fakeEnv(host, proto), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
    assert.equal(A.track('game_start'), 'off', host); assert.equal(E.appended.length, 0, host);
  }
  for (const host of ['acikofis.teserix.com', 'thejackaltr.github.io']) {
    const st = memStorage(); consentOn(st);
    const E = fakeEnv(host), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
    assert.equal(A.sync(), true, host); assert.equal(E.appended.length, 1, host);
  }
});

test('a throwing / missing tracker never breaks the game; bounded queue; blocked script clears the queue', () => {
  const st = memStorage(); consentOn(st);
  const E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  for (let i = 0; i < 40; i++) A.track('share_click');
  assert.equal(A.queued().length, 20);
  E.appended[0].ev.error();
  assert.equal(A.queued().length, 0);
  E.win.umami = { track: () => { throw new Error('boom'); } };
  assert.doesNotThrow(() => A.track('login_success'));
  assert.doesNotThrow(() => createAnalytics({ win: null, doc: null, storage: null }).track('game_start'));
});

test('Supabase counter: gated by the same consent (GATE_SUPABASE_COUNTER = true); the flag lifts the gate', () => {
  assert.equal(GATE_SUPABASE_COUNTER, true);
  const st = memStorage(), E = fakeEnv();
  const A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  assert.equal(A.counterAllowed(), false, 'before the notice');
  A.answer(false); assert.equal(A.counterAllowed(), false, 'after "Kapat"');
  A.setEnabled(true); assert.equal(A.counterAllowed(), true, 'after "Tamam" / switch on');
  A.setEnabled(false); assert.equal(A.counterAllowed(), false, 'switched off');
  const B = createAnalytics({ win: E.win, doc: E.doc, storage: memStorage(), gateCounter: false });
  assert.equal(B.counterAllowed(), true, 'flag false -> counter independent of consent');
  assert.match(read('src/analytics.js'), /export const GATE_SUPABASE_COUNTER = true;/);
});

test('events wired at real action sites (names only)', () => {
  const src = ['src/main.js', 'src/cloud/cloud.js', 'src/cloud/resetFlow.js', 'src/ui/share.js', 'src/cloud/leaderboard.js'].map(read).join('\n');
  const names = [...new Set([...src.matchAll(/\btrack\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(names, ['cloud_save', 'game_start', 'login_success', 'reset_or_prestige', 'share_click']);
  assert.ok(!/\btrack\('[a-z_]+'\s*,/.test(src), 'no payloads');
});

test('tracker fails to load (blocked / offline): queue cleared, later events dropped (never throw, no unbounded queue)', () => {
  const st = memStorage(), E = fakeEnv(), A = createAnalytics({ win: E.win, doc: E.doc, storage: st });
  consentOn(st);
  assert.equal(A.track('game_start'), 'queued');
  E.appended[0].ev.error();
  assert.deepEqual(A.queued(), []);
  assert.equal(A.track('share_click'), 'dropped');
  assert.deepEqual(A.queued(), []);
  assert.equal(E.appended.length, 1, 'no retry storm');
});
