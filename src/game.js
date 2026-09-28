// Game controller: owns the state, timestamp-based ticking, saving, offline catch-up and game rules glue.
// Rendering (Phaser scene) and DOM UI subscribe to events; they never change the state directly.
import * as E from './logic/economy.js';
import * as TU from './logic/tutorial.js';
import * as EV from './logic/events.js';
import * as OFF from './logic/offline.js';
import * as SAVE from './logic/save.js';
import { CFG, ITEMS, STAGES, STAGE_COUNTER_PREFIX } from './logic/config.js';
import * as G from './logic/grid.js';

export class Controller {
  constructor(storage, now = Date.now()) {
    this.storage = storage;
    this.listeners = {};
    this.placing = null;          // { kind, hireType|null, item|null }
    this.tip = null;              // { key, until } one-time hint shown for a few seconds (tutorial.pm)
    this.saveTimer = 0;
    this.catTimer = 30;           // first cat nap soon after start
    this.cloudHooks = null;       // seam for cloud save: { onSaved(state) }
    this.resetting = false;
    const loaded = SAVE.load(storage, now);
    this.state = loaded || E.newState(now);
    this.fresh = !loaded;
    this.pendingWelcome = loaded ? OFF.catchUp(this.state, now) : null;
    this.state.lastTick = now;
  }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return () => { this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn); }; }
  emit(ev, data) { for (const fn of this.listeners[ev] || []) { try { fn(data); } catch (e) { console.error(e); } } }
  changed() { this.emit('change', this.state); }

  // ------------------------------------------------------------ time
  tick(now) {
    const s = this.state;
    let dt = (now - s.lastTick) / 1000;
    if (!(dt > 0)) { s.lastTick = now; return; }
    if (dt > 5) { this.resume(now); return; }   // throttled tab / sleep: treat as offline
    s.lastTick = now;
    s.playSec += dt;
    const res = E.advance(s, dt);
    this.handleAdvance(res);
    // cat
    this.catTimer -= dt;
    if (this.catTimer <= 0) {
      this.catTimer = CFG.catNapEverySec[0] + Math.random() * (CFG.catNapEverySec[1] - CFG.catNapEverySec[0]);
      const withPeople = s.desks.filter((d) => s.staff.some((x) => x.deskId === d.id));
      if (withPeople.length) {
        const d = withPeople[Math.floor(Math.random() * withPeople.length)];
        s.catNaps += 1;
        this.emit('catNap', { deskId: d.id, sec: CFG.catNapSec });
      }
    }
    // events & cloud prompt
    if (EV.shouldTrigger(s) && !this.placing) { const id = EV.trigger(s); this.emit('event', id); }
    if (TU.shouldAskCloud(s) && !s.events.pending && !this.placing) { s.flags.cloudAsked = true; this.emit('askCloud'); }
    this.saveTimer += dt;
    if (this.saveTimer >= CFG.autosaveSec) this.save(now);
  }
  handleAdvance(res) {
    if (res.newOffers) this.emit('offers', res.newOffers);
    if (res.delivered.length) {
      for (const d of res.delivered) this.emit('delivered', d);
      if (TU.notify(this.state, 'delivered')) this.emit('tutorial');
      this.countStage();
      this.changed();
    }
    if (this.tip && Date.now() > this.tip.until) { this.tip = null; this.emit('tutorial'); }
  }
  // v2: anonymous stage counter (first delivery = stage 0, then every move); once per save, no personal data
  countStage() {
    const s = this.state, f = s.flags;
    if (!Array.isArray(f.stagesCounted)) f.stagesCounted = [];
    for (let i = 0; i <= s.stage; i++) {
      if (f.stagesCounted.includes(i)) continue;
      if (i === 0 && s.projectsDone < 1) continue;
      f.stagesCounted.push(i);
      this.emit('count', STAGE_COUNTER_PREFIX + i);
    }
  }
  // back from hidden tab / long gap: offline catch-up (capped) and maybe a welcome popup
  resume(now) {
    const w = OFF.catchUp(this.state, now);
    this.changed();
    if (w) this.emit('welcome', w);
    this.save(now);
  }
  save(now = Date.now()) {
    if (this.resetting) return false;
    this.saveTimer = 0;
    const ok = SAVE.store(this.storage, this.state, now);
    if (this.cloudHooks && this.cloudHooks.onSaved) { try { this.cloudHooks.onSaved(this.state); } catch (e) { /* cloud is optional */ } }
    return ok;
  }
  // used by cloud sync when the cloud copy wins
  replaceState(obj, now = Date.now()) {
    const s = SAVE.migrate(obj, now);
    if (!s) return null;
    this.state = s;
    const w = OFF.catchUp(this.state, now);
    this.state.lastTick = now;
    this.save(now);
    this.emit('reload', this.state);
    this.changed();
    return w;
  }
  reset(now = Date.now()) {
    this.resetting = true;
    try { this.storage.removeItem(SAVE.SAVE_KEY); } catch (e) { /* ignore */ }
    this.state = E.newState(now);
    this.resetting = false;
    this.save(now);
    this.emit('reload', this.state);
    this.changed(); this.emit('tutorial');
  }

  // ------------------------------------------------------------ player actions
  tapLaptop() {
    const s = this.state;
    let opened = false;
    if (!s.flags.firstOfferGiven) { E.giveFirstOffer(s); this.emit('offers', 1); }
    if (!s.projects.length) { opened = true; this.emit('openOffers'); }
    const r = E.tapLaptop(s);
    const stepChanged = TU.notify(s, 'laptop');
    if (r.delivered && r.delivered.length) { for (const d of r.delivered) this.emit('delivered', d); if (TU.notify(s, 'delivered')) this.emit('tutorial'); this.countStage(); }
    if (stepChanged) this.emit('tutorial');
    this.changed();
    return { ...r, opened };
  }
  accept(offerId) {
    const r = E.acceptOffer(this.state, offerId);
    if (r.ok) { if (TU.notify(this.state, 'accepted')) this.emit('tutorial'); this.emit('accepted', r.project); this.changed(); this.save(); }
    return r;
  }
  decline(offerId) { E.declineOffer(this.state, offerId); this.changed(); }
  hire(type) {
    const s = this.state;
    if (!E.freeDesk(s)) {
      const need = E.staffCost(s, type) + E.deskCost(s);
      if (s.money < need) return { ok: false, reason: 'para' };
      this.startPlacing(type);
      return { ok: false, reason: 'placing' };
    }
    return this.finishHire(E.hire(s, type));
  }
  finishHire(r) {
    if (r.ok) {
      if (TU.notify(this.state, 'hired')) this.emit('tutorial');
      // v2: the first Proje Yöneticisi -> one-time tip (if their desk was not placed by hand, show it for a while)
      if (r.staff.type === 'pm' && !this.state.flags.pmTip) {
        this.state.flags.pmTip = true;
        if (!r.placed) { this.tip = { key: 'tutorial.pm', until: Date.now() + 9000 }; this.emit('tutorial'); }
      }
      this.emit('hired', r); this.changed(); this.save();
    }
    return r;
  }
  startPlacing(hireType = null) {
    this.placing = { kind: E.deskKindForStage(this.state.stage), hireType, item: null };
    this.emit('placing', this.placing); this.emit('tutorial');
  }
  // v2: place an area item (kahve / bitki / sunucu)
  startItem(type) {
    const s = this.state;
    if (!E.itemAvailable(s, type)) return { ok: false, reason: 'kilitli' };
    if (s.money < E.itemCost(s, type)) return { ok: false, reason: 'para' };
    this.placing = { kind: ITEMS[type].kind, hireType: null, item: type };
    this.emit('placing', this.placing); this.emit('tutorial');
    return { ok: true };
  }
  // v2.1: move a placed item (free); same placement flow as buying (touch: preview tap + confirm tap)
  startMoveItem(itemId) {
    const it = (this.state.items || []).find((x) => x.id === itemId);
    if (!it || !ITEMS[it.type]) return { ok: false, reason: 'yok' };
    this.placing = { kind: ITEMS[it.type].kind, hireType: null, item: it.type, moveId: it.id };
    this.emit('placing', this.placing); this.emit('tutorial');
    return { ok: true };
  }
  cancelPlacing() { this.placing = null; this.emit('placing', null); this.emit('tutorial'); }
  placeAt(gx, gy) {
    const p = this.placing; if (!p) return { ok: false };
    const s = this.state;
    if (!G.canPlace(s, p.kind, gx, gy)) return { ok: false, reason: 'yer' };
    let r;
    if (p.moveId != null) {
      r = E.moveItem(s, p.moveId, gx, gy);
      if (r.ok) { this.placing = null; this.emit('placing', null); this.emit('itemMoved', r.item); this.changed(); this.save(); }
    } else if (p.item) {
      r = E.buyItem(s, p.item, gx, gy);
      if (r.ok) { this.placing = null; this.emit('placing', null); this.emit('itemPlaced', r.item); this.changed(); this.save(); }
    } else if (p.hireType) {
      r = E.hire(s, p.hireType, { kind: p.kind, gx, gy });
      if (r.ok) { r.placed = true; this.placing = null; this.emit('placing', null); this.emit('deskPlaced', r.desk); this.finishHire(r); }
    } else {
      r = E.buyDesk(s, p.kind, gx, gy);
      if (r.ok) { this.placing = null; this.emit('placing', null); this.emit('deskPlaced', r.desk); this.changed(); this.save(); }
    }
    this.emit('tutorial');
    return r;
  }
  promote(staffId) { const r = E.promote(this.state, staffId); if (r.ok) { this.emit('promoted', r.staff); this.changed(); this.save(); } return r; }
  assign(staffId, projectId) { const ok = E.assignStaff(this.state, staffId, projectId); if (ok) this.changed(); return ok; }
  buyUpgrade(id) { const r = E.buyUpgrade(this.state, id); if (r.ok) { this.changed(); this.save(); } return r; }
  move() { const r = E.moveOffice(this.state); if (r.ok) { this.emit('reload', this.state); this.emit('moved', r.stage); this.countStage(); this.changed(); this.save(); } return r; }
  chooseEvent(choice) { const r = EV.applyChoice(this.state, choice); this.changed(); this.save(); return r; }
  laterEvent() { EV.dismiss(this.state); }
  hint() {
    const p = this.placing, tip = this.tip && Date.now() <= this.tip.until ? this.tip.key : null;
    return TU.currentHint(this.state, { placingDesk: !!p && !p.item, placingItem: !!(p && p.item), placingPm: !!(p && p.hireType === 'pm'),
      glow: !!p && E.glowTiles(this.state).size > 0, tip });
  }
}
