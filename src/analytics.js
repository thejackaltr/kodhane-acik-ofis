// Umami (self-hosted analiz.teserix.com), KVKK-gated ("İsimsiz sayaç"). Event names only — never email, nickname or ids.
// Modelled on Fenomen src/analytics.js (v2.1.1 notice fix).
//
// CONSENT GATE (own localStorage keys; separate from the save, the locale and every cloud key):
//   acik_ofis_tel_notice  set (any value) = the first-launch notice was answered ("Tamam" or "Kapat")
//   acik_ofis_tel         'on' | 'off'    = "Tamam" / "Kapat" on the notice, or the Menü > Gizlilik switch
// "Baştan başla", backup restore, cloud load/merge/sign-out never touch these keys (tests/unit/consent.test.mjs).
// The Umami script is NOT in index.html. It is injected at runtime only when consent is on AND the page runs on one of
// DOMAINS (never localhost / 127.0.0.1 / file:). Before consent nothing is loaded and events are DROPPED (game_start
// included; nothing is sent later). Between consent and the script's load event a tiny in-memory queue is kept; it is
// sent only if consent is still on when the script arrives.
// Turning stats off stops Umami at once, even after the script has loaded:
//   - track() re-reads the preference on every call and does nothing when it is off;
//   - the tracker is loaded with data-before-send=<hook>; Umami calls that hook before EVERY request (incl. its own
//     automatic pageviews) and the hook drops the request unless consent is still on;
//   - localStorage 'umami.disabled' (the tracker's built-in kill switch) is set while off and removed when back on.
// Privacy: cookieless tracker, DNT respected (data-do-not-track), query string and hash never sent
// (data-exclude-search / data-exclude-hash).
//
// The anonymous Supabase counter (kodhane_count_event: stage counter + Kodhane referral) follows the SAME consent while
// GATE_SUPABASE_COUNTER is true (manager decision). Login, cloud save/load and the leaderboard do not depend on it.
export const WEBSITE_ID = '5ebd71d2-4e8f-4822-a110-1f2c7d56f94e';
export const DOMAINS = 'acikofis.teserix.com,thejackaltr.github.io';
export const SCRIPT_SRC = 'https://analiz.teserix.com/script.js';
export const KEYS = { pref: 'acik_ofis_tel', notice: 'acik_ofis_tel_notice', umamiOff: 'umami.disabled' };
export const BEFORE_SEND = '__acikOfisUmamiBeforeSend';
export const GATE_SUPABASE_COUNTER = true;
export const EVENTS = ['game_start', 'login_success', 'cloud_save', 'reset_or_prestige', 'share_click'];
const QUEUE_MAX = 20;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;

export function createAnalytics({ win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null,
  storage = null, cfg = { src: SCRIPT_SRC, websiteId: WEBSITE_ID, domains: DOMAINS }, gateCounter = GATE_SUPABASE_COUNTER } = {}) {
  const store = storage || (() => { try { return (win && win.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) { return null; } })();
  const get = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
  const set = (k, v) => { try { if (store) store.setItem(k, v); } catch (e) { /* ignore */ } };
  const del = (k) => { try { if (store) store.removeItem(k); } catch (e) { /* ignore */ } };
  const hostOk = () => {
    try {
      const l = win.location;
      if (!/^https?:$/.test(l.protocol) || LOCAL.test(l.hostname)) return false;
      return String(cfg.domains || '').split(',').map((d) => d.trim()).filter(Boolean).includes(l.hostname);
    } catch (e) { return false; }
  };
  const recent = []; const log = []; let queue = [];
  let script = null;
  let failed = false;          // the script could not load (blocked / offline): events are dropped for this session

  const A = {
    cfg, KEYS,
    noticeNeeded: () => !get(KEYS.notice),
    consent: () => !!get(KEYS.notice) && get(KEYS.pref) !== 'off',
    hostOk,
    allowed: () => !!(cfg && cfg.src && cfg.websiteId && /^https:\/\//.test(cfg.src)) && hostOk() && A.consent(),
    counterAllowed: () => !gateCounter || A.consent(),
    loaded: () => !!script,
    tracked: () => recent.slice(),
    log: () => log.slice(),
    queued: () => queue.slice(),
    // notice answer: "Tamam" (true) / "Kapat" (false)
    answer(ok) { set(KEYS.notice, '1'); set(KEYS.pref, ok ? 'on' : 'off'); return A.sync(); },
    // Menü > Gizlilik switch; answers the notice too when it is still open
    setEnabled(on) { set(KEYS.notice, '1'); set(KEYS.pref, on ? 'on' : 'off'); return A.sync(); },
    // after an answer / the switch, on every track() and on 'storage' events from other tabs. May Umami run now?
    sync() {
      if (!A.allowed()) { if (get(KEYS.pref) === 'off') set(KEYS.umamiOff, '1'); queue = []; return false; }
      if (get(KEYS.umamiOff)) del(KEYS.umamiOff);
      A.load();
      return true;
    },
    load() {
      if (script || !doc || !win || !A.allowed()) return script;
      win[BEFORE_SEND] = (type, payload) => (A.allowed() ? payload : null);
      const s = doc.createElement('script');
      s.defer = true;
      s.src = cfg.src;
      s.setAttribute('data-website-id', cfg.websiteId);
      if (cfg.domains) s.setAttribute('data-domains', cfg.domains);
      s.setAttribute('data-before-send', BEFORE_SEND);
      s.setAttribute('data-do-not-track', 'true');
      s.setAttribute('data-exclude-search', 'true');
      s.setAttribute('data-exclude-hash', 'true');
      s.setAttribute('data-test', 'umami-script');
      s.addEventListener('load', () => { const q = queue; queue = []; const u = umami(win); if (u && A.allowed()) for (const n of q) send(u, n); });
      s.addEventListener('error', () => { failed = true; queue = []; });
      (doc.head || doc.body || doc.documentElement).appendChild(s);
      script = s;
      return s;
    },
    // event name only; dropped unless consent is on. Never throws. Returns 'off' | 'sent' | 'queued' | 'dropped' | 'invalid'.
    track(name) {
      let st;
      if (typeof name !== 'string' || !name) st = 'invalid';
      else if (!A.sync()) st = 'off';
      else {
        const u = umami(win);
        if (u) { send(u, name); st = 'sent'; } else if (failed) st = 'dropped'; else if (queue.length < QUEUE_MAX) { queue.push(name); st = 'queued'; } else st = 'dropped';
      }
      if (st === 'sent' || st === 'queued') { recent.push(name); if (recent.length > 50) recent.shift(); }
      log.push([name, st]); if (log.length > 100) log.shift();
      return st;
    }
  };
  if (win && win.addEventListener) win.addEventListener('storage', (e) => { if (!e || e.key === null || e.key === KEYS.pref || e.key === KEYS.notice) A.sync(); });
  return A;
}
function umami(win) { try { const u = win ? win.umami : null; return u && typeof u.track === 'function' ? u : null; } catch (e) { return null; } }
function send(u, name) { try { u.track(name); } catch (e) { /* ignore */ } }

let shared = null;
export function analytics() { if (!shared) shared = createAnalytics(); return shared; }
export function setAnalytics(a) { shared = a; }            // tests
export function track(name) { try { return analytics().track(name); } catch (e) { return 'off'; } }
export function tracked() { try { return analytics().tracked(); } catch (e) { return []; } }
export function queued() { try { return analytics().queued(); } catch (e) { return []; } }
export function counterAllowed() { try { return analytics().counterAllowed(); } catch (e) { return !GATE_SUPABASE_COUNTER; } }
