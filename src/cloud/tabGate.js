// v2.2: only ONE tab of this browser writes the save (localStorage and cloud), so two open tabs never load each other
// back and forth. The tab the player last showed, focused or touched holds the "writer" key in localStorage; the
// other tabs pause (their game keeps running on screen, nothing is written). When a tab becomes the writer it first
// takes over the save the previous writer left (onClaim). Cloud writes also need the writer to be visible; the final
// flush when it is hidden/closed is still allowed. No storage (private mode) = every tab writes, as before.
export const WRITER_KEY = 'acik_ofis_tab_writer_v1';
const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export class TabGate {
  constructor({ storage, doc, win, id, now } = {}) {
    this.storage = storage;
    this.doc = doc !== undefined ? doc : (typeof document !== 'undefined' ? document : null);
    this.win = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
    this.id = id || rid();
    this.now = now || (() => Date.now());
    this.claimListeners = [];
    if (this.win && this.win.addEventListener) {
      const shown = () => { if (this.visible()) this.claim(); };
      this.win.addEventListener('focus', () => this.claim());
      this.win.addEventListener('pageshow', shown);
      if (this.doc && this.doc.addEventListener) this.doc.addEventListener('visibilitychange', shown);
      // a real input in this tab = the player is here (also covers two windows side by side, both visible)
      for (const ev of ['pointerdown', 'keydown']) this.win.addEventListener(ev, (e) => { if (!e || e.isTrusted !== false) this.claim(); }, { capture: true, passive: true });
    }
    if (this.visible()) this.claim();
  }
  onClaim(fn) { this.claimListeners.push(fn); return () => { this.claimListeners = this.claimListeners.filter((f) => f !== fn); }; }
  visible() { return !this.doc || !this.doc.hidden; }
  read() {
    try { const v = JSON.parse(this.storage.getItem(WRITER_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return undefined; }
  }
  // this tab becomes the writer; returns true when it was not the writer before (listeners take over the save)
  claim() {
    const cur = this.read();
    if (cur === undefined) return false;                   // no storage: nothing to coordinate
    if (cur && cur.id === this.id) return false;
    try { this.storage.setItem(WRITER_KEY, JSON.stringify({ id: this.id, at: this.now() })); } catch (e) { return false; }
    for (const f of this.claimListeners) { try { f(); } catch (e) { /* ignore */ } }
    return true;
  }
  // may this tab write its save to localStorage? (the writer, or nobody holds the key and this tab is visible)
  isWriter() {
    const cur = this.read();
    if (cur === undefined) return true;
    if (!cur || !cur.id) { if (this.visible()) { this.claim(); return true; } return false; }
    return cur.id === this.id;
  }
  // may this tab write to the cloud now? final = the last flush while going to background / closing
  canPush(final) { return this.isWriter() && (final || this.visible()); }
  // closing: let the next shown tab take over without waiting for focus (call after the final save)
  release() { const cur = this.read(); if (cur && cur.id === this.id) { try { this.storage.removeItem(WRITER_KEY); } catch (e) { /* ignore */ } } }
}
