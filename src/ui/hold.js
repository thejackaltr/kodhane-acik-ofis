// v2.2: press-and-hold confirm button (pointer + keyboard Space/Enter). A fill grows across the button while held;
// no numbers. Releasing / leaving / cancelling early resets it. Min 44px (CSS .btn), no context menu / text selection.
import { h } from './dom.js';

export const HOLD_MS = 2000;

// pure timing part (testable without a DOM)
export class HoldGesture {
  constructor(ms = HOLD_MS) { this.ms = ms; this.startAt = null; this.done = false; }
  press(now) { if (this.done || this.startAt != null) return false; this.startAt = now; return true; }
  release() { const was = this.startAt != null && !this.done; this.startAt = null; return was; }
  progress(now) { return this.startAt == null ? (this.done ? 1 : 0) : Math.min(1, Math.max(0, (now - this.startAt) / this.ms)); }
  // true once, when the hold reached the full time
  tick(now) { if (this.done || this.startAt == null) return false; if (now - this.startAt >= this.ms) { this.done = true; this.startAt = null; return true; } return false; }
  get holding() { return this.startAt != null; }
}

// opts: { label, hint, ms, onConfirm, cls, test }
export function holdButton(opts) {
  const g = new HoldGesture(opts.ms || HOLD_MS);
  const fill = h('span', { class: 'hold-fill', 'aria-hidden': 'true' });
  const label = h('span', { class: 'hold-label', text: opts.label });
  const btn = h('button', { type: 'button', class: 'btn danger big hold ' + (opts.cls || ''), 'data-test': opts.test || 'hold-confirm', 'aria-label': opts.hint ? opts.label + '. ' + opts.hint : opts.label }, fill, label);
  let raf = 0, key = null, pid = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const paint = () => { const p = g.progress(now()); fill.style.transform = 'scaleX(' + p.toFixed(3) + ')'; btn.classList.toggle('holding', g.holding); };
  const loop = () => {
    raf = 0;
    if (g.tick(now())) { paint(); btn.classList.add('done'); btn.disabled = true; opts.onConfirm && opts.onConfirm(); return; }
    paint();
    if (g.holding) raf = requestAnimationFrame(loop);
  };
  const start = () => { if (g.press(now())) { paint(); if (!raf) raf = requestAnimationFrame(loop); } };
  const stop = () => { g.release(); key = null; pid = null; if (raf) { cancelAnimationFrame(raf); raf = 0; } paint(); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button > 0) return;
    e.preventDefault(); pid = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    start();
  });
  btn.addEventListener('pointerup', (e) => { if (pid === e.pointerId) stop(); });
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('lostpointercapture', (e) => { if (pid === e.pointerId) stop(); });
  btn.addEventListener('pointerleave', (e) => { if (pid === e.pointerId && e.pointerType === 'mouse') stop(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('selectstart', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || key) return;
    key = e.key; start();
  });
  btn.addEventListener('keyup', (e) => { if (e.key === key) { e.preventDefault(); stop(); } });
  btn.addEventListener('blur', stop);
  btn.addEventListener('click', (e) => e.preventDefault());   // a plain click never confirms
  paint();
  return btn;
}
