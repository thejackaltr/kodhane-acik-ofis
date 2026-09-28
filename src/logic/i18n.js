// i18n: every UI string lives in src/locales/<code>.json (tr.json is the source of truth).
// Adding a language = adding e.g. src/locales/en.json; missing keys fall back to Turkish.
export const DEFAULT_LOCALE = 'tr';
let DICTS = {};
let CUR = DEFAULT_LOCALE;
let PSEUDO = 0; // test aid: stretch every string by N% to check layout robustness

export function registerLocales(map) { DICTS = Object.assign({}, DICTS, map); }
export function setDict(d) { registerLocales({ [DEFAULT_LOCALE]: d }); } // back-compat for tests
export function available() { return Object.keys(DICTS).sort(); }
export function locale() { return CUR; }
export function setLocale(code) { CUR = DICTS[code] ? code : DEFAULT_LOCALE; return CUR; }
export function setPseudo(pct) { PSEUDO = Math.max(0, +pct || 0); }
// device preference list (navigator.languages) + stored choice -> supported code
export function detect(prefs, stored) {
  if (stored && DICTS[stored]) return stored;
  for (const p of prefs || []) {
    const code = String(p || '').toLowerCase().split('-')[0];
    if (DICTS[code]) return code;
  }
  return DEFAULT_LOCALE;
}
function lookup(dict, key) {
  let cur = dict;
  for (const part of key.split('.')) { if (cur == null) return undefined; cur = cur[part]; }
  return cur;
}
export function raw(key) {
  let v = lookup(DICTS[CUR], key);
  if (v === undefined && CUR !== DEFAULT_LOCALE) v = lookup(DICTS[DEFAULT_LOCALE], key); // fallback: tr
  return v;
}
function stretch(s) {
  if (!PSEUDO || typeof s !== 'string') return s;
  const extra = Math.ceil(s.length * PSEUDO / 100);
  return s + ' ' + '·ğüşİıöç'.repeat(Math.ceil(extra / 8)).slice(0, Math.max(0, extra - 1));
}
function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s; }
export function t(key, vars) {
  const v = raw(key);
  if (typeof v !== 'string') return key;
  return stretch(fill(v, vars));
}
export function list(key) { const v = raw(key); return Array.isArray(v) ? v.map(stretch) : []; }
export function item(key, i, vars) { const v = raw(key); return Array.isArray(v) && v.length ? stretch(fill(v[((i % v.length) + v.length) % v.length], vars)) : key; }
// locale-aware case mapping (Turkish i/İ, ı/I)
export function upper(s) { return String(s).toLocaleUpperCase(CUR); }
export function lower(s) { return String(s).toLocaleLowerCase(CUR); }
