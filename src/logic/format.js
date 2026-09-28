// Locale-aware number/money/time formatting via Intl (locale comes from i18n; unit words from the locale JSON).
import { locale, t } from './i18n.js';

const cache = new Map();
function nf(opts) {
  const k = locale() + JSON.stringify(opts);
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale(), opts));
  return cache.get(k);
}
export function fmt(n) {
  if (typeof n !== 'number' || n !== n) return nf({}).format(0);
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 10) return nf({ maximumFractionDigits: 1 }).format(n);
  if (a < 1000) return nf({ maximumFractionDigits: 0 }).format(n);
  if (a < 1e15) return nf({ notation: 'compact', maximumFractionDigits: 2 }).format(n);
  return nf({ notation: 'scientific', maximumFractionDigits: 2 }).format(n);
}
export function fmtInt(n) { return nf({ maximumFractionDigits: 0 }).format(n); }
// in-game currency (fictional agency money). Template in the locale file: "{v} TL"
export function tl(n) { return t('fmt.money', { v: fmt(Math.floor(n * 10) / 10) }); }
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const H = (x) => t('fmt.hours', { n: fmtInt(x) }), M = (x) => t('fmt.minutes', { n: fmtInt(x) }), S = (x) => t('fmt.seconds', { n: fmtInt(x) });
  if (h) return m ? t('fmt.pair', { a: H(h), b: M(m) }) : H(h);
  if (m) return s && m < 10 ? t('fmt.pair', { a: M(m), b: S(s) }) : M(m);
  return S(s);
}
