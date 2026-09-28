// v2.3 "İsimsiz sayaç" UI (Fenomen src/ui/privacy.js pattern): first-launch notice band ("Tamam" / "Kapat" equal size +
// "Ayrıntılar") and the details modal. The Menü > Gizlilik switch lives in ui.js (showMenu) and calls analytics().setEnabled().
import { h, add } from './dom.js';
import { t, list } from '../logic/i18n.js';
import { analytics } from '../analytics.js';

export const NB_SPACE = '--nb-space';
// "Ayrıntılar": opened from the band and from Menü > Gizlilik; reading it does NOT answer the notice
export function showDetails(ui) {
  ui.showModal((box, close) => {
    box.setAttribute('data-test', 'tel-details-modal');
    add(box, h('h2', { text: t('telemetry.detailsTitle') }), ...list('telemetry.details').filter((p) => String(p).trim()).map((p) => h('p', { class: 'tel-p', text: p })),
      h('button', { class: 'btn primary', 'data-test': 'tel-details-close', onclick: close }, t('telemetry.detailsClose')));
  }, { cls: 'tel-details' });
}
// Keeps --nb-space (px from the band's top edge to the viewport bottom + 8) on <html> while the band is shown, so the
// layout keeps every action above it (src/style.css: hint, placement bar, sheet) and the office camera frames the room
// above it (onSpace -> OfficeScene padBottom + fitView). Returns a cleanup function.
function reserveSpace(band, onSpace, doc = document, win = window) {
  const root = doc.documentElement;
  let last = -1, raf = 0;
  const fit = () => {
    if (!band.isConnected) return;
    const r = band.getBoundingClientRect();
    const v = Math.ceil(Math.max(0, win.innerHeight - r.top) + 8);
    if (v !== last) { last = v; root.style.setProperty(NB_SPACE, v + 'px'); if (onSpace) onSpace(v); }
  };
  const soon = () => { if (!raf) raf = win.requestAnimationFrame(() => { raf = 0; fit(); }); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(band);
  win.addEventListener('resize', soon); fit();
  return () => { if (ro) ro.disconnect(); if (raf) win.cancelAnimationFrame(raf); win.removeEventListener('resize', soon); root.style.removeProperty(NB_SPACE); if (onSpace) onSpace(0); };
}
export function noticeBand(doc = document) { return doc.querySelector('[data-test=tel-banner]'); }
// remove the band (answered here, in Menü > Gizlilik, or in another tab)
export function dismissNoticeBand(doc = document) {
  const b = noticeBand(doc); if (!b) return;
  if (b.__release) b.__release(); b.remove();
}
// the band stays outside #ui (pointer-events: none overlay); returns the band or null when already answered
export function showNoticeBand(ui, { host = document.body, onSpace } = {}) {
  const A = analytics();
  if (!A.noticeNeeded() || noticeBand()) return null;
  // Umami follows the answer at once: "Tamam" loads it now (sync), "Kapat" keeps it off (no request at all)
  const answer = (ok) => { A.answer(ok); dismissNoticeBand(); if (!ok) ui.toast(t('telemetry.offToast'), '', 3500); };
  const band = h('div', { class: 'notice-band', role: 'region', 'aria-label': t('telemetry.title'), 'data-test': 'tel-banner' },
    h('p', { class: 'nb-text' }, h('b', { text: t('telemetry.title') }), ' ' + t('telemetry.body')),
    h('div', { class: 'nb-row' },
      // KVKK: "Tamam" and "Kapat" carry exactly the same class = the same visual weight (no primary/secondary)
      h('button', { class: 'btn nb-btn', 'data-test': 'tel-ok', onclick: () => answer(true) }, t('telemetry.ok')),
      h('button', { class: 'btn nb-btn', 'data-test': 'tel-off', onclick: () => answer(false) }, t('telemetry.off')),
      h('button', { class: 'link nb-link', 'data-test': 'tel-details', onclick: () => showDetails(ui) }, t('telemetry.detailsLink'))));
  host.appendChild(band);
  band.__release = reserveSpace(band, onSpace);
  return band;
}
