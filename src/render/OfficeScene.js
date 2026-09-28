// Isometric office renderer (Phaser 3). Reads controller state, never mutates it except via controller actions.
import Phaser from 'phaser';
import { STAGES, GRID, ITEMS, EVENTS } from '../logic/config.js';
import * as E from '../logic/economy.js';
import * as G from '../logic/grid.js';
import { t, list } from '../logic/i18n.js';

const A = 'a';                 // atlas key
const S = 0.5;                 // source art is 2x
const TAP_MOVE = 10, LONG_MS = 520;
const BUBBLE_POOL = 3, COIN_POOL = 18, FX_POOL = 24;
const FLOORS = { ev: ['zemin_parke_01', 'zemin_parke_02', 'zemin_hali_01'], studyo: ['zemin_beton_01', 'zemin_beton_02', 'zemin_hali_01'], ajans: ['zemin_ajans_01', 'zemin_ajans_02', 'zemin_hali_02'] };

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export class OfficeScene extends Phaser.Scene {
  constructor(ctrl, opts) {
    super('office');
    this.ctrl = ctrl; this.opts = opts || {};
    this.userZoom = 1; this.dpr = opts.dpr || 1;
    this.staffSprites = new Map(); this.deskSprites = new Map(); this.itemSprites = new Map();
    this.world = []; this.hl = []; this.glows = []; this.glowTimer = null; this.pendingTile = null;
    this.animT = 0; this.frameToggle = false;
    this.bubbleT = 3; this.cat = null;
  }
  preload() { this.load.atlas(A, 'assets/atlas.png', 'assets/atlas.json'); }

  create() {
    this.cameras.main.setBackgroundColor('#2a2230');
    this.makePools();
    this.buildAll();
    this.setupInput();
    this.fitCamera(true);
    const c = this.ctrl;
    this.unsubs = [
      c.on('reload', () => { this.buildAll(); this.fitCamera(true); }),
      c.on('hired', (r) => this.onHired(r)),
      c.on('deskPlaced', (d) => this.addDesk(d, true)),
      c.on('itemPlaced', (it) => { this.addItem(it, true); this.flashGlow(); }),
      c.on('event', (id) => this.playEventVisual(id)),
      c.on('promoted', (s) => this.refreshStaff(s)),
      c.on('delivered', (d) => this.onDelivered(d)),
      c.on('catNap', (e) => this.catNap(e)),
      c.on('placing', (p) => this.showPlacement(p)),
      c.on('tutorial', () => this.updateArrow())
    ];
    this.scale.on('resize', () => this.fitCamera(false));
    this.updateArrow();
    this.opts.onReady && this.opts.onReady(this);
  }

  // ------------------------------------------------------------ world building
  img(frame, x, y, depth) { const o = this.add.image(x, y, A, frame).setScale(S); o.setDepth(depth); return o; }
  clearWorld() {
    for (const o of this.world) o.destroy();
    this.world = [];
    for (const s of this.staffSprites.values()) s.destroy();
    for (const s of this.deskSprites.values()) s.destroy();
    for (const s of this.itemSprites.values()) s.destroy();
    this.staffSprites.clear(); this.deskSprites.clear(); this.itemSprites.clear();
  }
  buildAll() {
    this.clearWorld();
    const st = this.ctrl.state, stage = STAGES[st.stage], look = stage.look;
    const area = G.stageArea(st.stage);
    const rug = new Set((stage.rug || []).map(([x, y]) => x + ',' + y));
    const [floorA, floorB, rugF] = FLOORS[look] || FLOORS.studyo;
    for (let gx = 0; gx < area.w; gx++) for (let gy = 0; gy < area.h; gy++) {
      const w = G.tileToWorld(gx, gy);
      const f = rug.has(gx + ',' + gy) ? rugF : ((gx + gy) % 2 ? floorB : floorA);
      this.world.push(this.img(f, w.x, w.y, -30000 + w.y * 0.01));
    }
    // back walls: right wall along gy=-0.5 (for each gx), left wall along gx=-0.5 (for each gy)
    for (let gx = 0; gx < area.w; gx++) {
      const deco = stage.walls.sag[gx]; const w = G.tileToWorld(gx, 0);
      const f = 'duvar_sag_' + look + (deco ? '_' + deco : '') + '_01';
      this.world.push(this.img(this.textures.get(A).has(f) ? f : 'duvar_sag_' + look + '_01', w.x, w.y, -20000 + gx));
    }
    for (let gy = 0; gy < area.h; gy++) {
      const deco = stage.walls.sol[gy]; const w = G.tileToWorld(0, gy);
      const f = 'duvar_sol_' + look + (deco ? '_' + deco : '') + '_01';
      this.world.push(this.img(this.textures.get(A).has(f) ? f : 'duvar_sol_' + look + '_01', w.x, w.y, -20000 + gy));
    }
    for (const d of stage.decor) {
      const w = G.tileToWorld(d.gx, d.gy);
      const o = this.img(d.kind, w.x, w.y, G.depthOf(w.x, w.y));
      this.world.push(o);
      if (d.kind === 'esya_cayocagi_01') { // steam from the tea pot
        const steam = this.img('fx_buhar_01', w.x + 2, w.y - 44, 90000).setAlpha(0.7);
        this.tweens.add({ targets: steam, y: w.y - 52, alpha: 0.1, duration: 1800, repeat: -1, ease: 'Sine.easeOut' });
        this.world.push(steam);
      }
    }
    for (const d of st.desks) this.addDesk(d, false);
    for (const it of st.items || []) this.addItem(it, false);
    for (const s of st.staff) this.addStaff(s, false);
    this.addCat();
    this.bounds = this.computeBounds();
  }
  computeBounds() {
    const a = G.stageArea(this.ctrl.state.stage);
    const L = G.tileToWorld(0, a.h - 1).x - 36, R = G.tileToWorld(a.w - 1, 0).x + 36;
    const T = G.tileToWorld(0, 0).y - 104, B = G.tileToWorld(a.w - 1, a.h - 1).y + 20;
    return { L, R, T, B, cx: (L + R) / 2, cy: (T + B) / 2, w: R - L, h: B - T };
  }
  addDesk(d, animate) {
    const w = G.tileToWorld(d.gx, d.gy);
    const o = this.img(d.kind, w.x, w.y, G.depthOf(w.x, w.y));
    o.setData('desk', d.id);
    this.deskSprites.set(d.id, o);
    if (animate) { o.y -= 30; o.setAlpha(0); this.tweens.add({ targets: o, y: w.y, alpha: 1, duration: 320, ease: 'Back.easeOut' }); this.puff(w.x + 16, w.y); }
  }
  // v2 area items
  addItem(it, animate) {
    const def = ITEMS[it.type]; if (!def) return;
    const w = G.tileToWorld(it.gx, it.gy);
    const o = this.img(def.kind, w.x, w.y, G.depthOf(w.x, w.y));
    o.setData('item', it.id);
    this.itemSprites.set(it.id, o);
    if (it.type === 'kahve') { // steam from the cup
      const steam = this.img('fx_buhar_01', w.x + 6, w.y - 50, 90000).setAlpha(0.6).setScale(S * 0.7);
      this.tweens.add({ targets: steam, y: w.y - 58, alpha: 0.05, duration: 1600, repeat: -1, ease: 'Sine.easeOut' });
      o.setData('fx', steam);
      o.on('destroy', () => steam.destroy());
    }
    if (it.type === 'sunucu') this.tweens.add({ targets: o, alpha: 0.9, yoyo: true, repeat: -1, duration: 700 + Math.random() * 400 });
    if (animate) { o.y -= 30; o.setAlpha(0); this.tweens.add({ targets: o, y: w.y, alpha: 1, duration: 320, ease: 'Back.easeOut' }); this.puff(w.x, w.y); }
  }
  // glowing tiles: Map "gx,gy" -> 'speed'|'reward' (+ optional preview tiles for an item about to be placed)
  showGlow(map, preview) {
    let i = 0;
    const put = (gx, gy, kind, alpha) => {
      let g = this.glows[i];
      if (!g) { g = this.add.image(0, 0, A, 'sec_karo_alan_01').setScale(S).setDepth(-9000); this.glows.push(g); }
      const w = G.tileToWorld(gx, gy);
      g.setFrame(kind === 'reward' ? 'sec_karo_odul_01' : 'sec_karo_alan_01').setPosition(w.x, w.y).setVisible(true).setAlpha(alpha);
      i++;
    };
    for (const [k, kind] of map || []) { const [x, y] = k.split(',').map(Number); put(x, y, kind, 0.8); }
    if (preview) for (const [x, y] of preview.tiles) put(x, y, preview.kind, 1);
    for (; i < this.glows.length; i++) this.glows[i].setVisible(false);
  }
  hideGlow() { for (const g of this.glows) g.setVisible(false); }
  flashGlow(ms = 2600) {
    this.showGlow(E.glowTiles(this.ctrl.state));
    if (this.glowTimer) this.glowTimer.remove(false);
    this.glowTimer = this.time.delayedCall(ms, () => { this.glowTimer = null; if (!this.ctrl.placing) this.hideGlow(); });
  }
  seatPos(deskId) {
    const d = this.ctrl.state.desks.find((x) => x.id === deskId);
    if (!d) return { x: 0, y: 0 };
    const w = G.tileToWorld(d.gx, d.gy), f = G.furniture(d.kind), o = f.oturmaPx || [64, -6];
    return { x: w.x + o[0] * S, y: w.y + o[1] * S };
  }
  addStaff(s, walkIn) {
    const p = this.seatPos(s.deskId);
    const o = this.add.image(p.x, p.y, A, 'calisan_' + s.type + '_bekle_01').setScale(S).setOrigin(0.5, 1);
    o.setData('staff', s.id); o.setData('type', s.type);
    o.setDepth(G.depthOf(p.x, p.y));
    this.staffSprites.set(s.id, o);
    if (walkIn) {
      const door = STAGES[this.ctrl.state.stage].door;
      const dw = G.tileToWorld(door.gx, door.gy);
      const d = this.ctrl.state.desks.find((x) => x.id === s.deskId);
      const mid = G.tileToWorld(door.gx, d.gy - 1);
      o.setPosition(dw.x, dw.y); o.setData('walking', true);
      const upd = () => o.setDepth(G.depthOf(o.x, o.y));
      this.tweens.chain({ targets: o, tweens: [
        { x: mid.x, y: mid.y, duration: 700 + 90 * Math.abs(d.gy - 1 - door.gy), onUpdate: upd },
        { x: p.x, y: p.y, duration: 700 + 60 * Math.abs(d.gx), onUpdate: upd, onComplete: () => { o.setData('walking', false); upd(); this.say(o, t('bubbles.hired'), 2600); } }
      ] });
    }
    return o;
  }
  refreshStaff(s) { const o = this.staffSprites.get(s.id); if (o) { o.setData('type', s.type); o.setFrame('calisan_' + s.type + '_bekle_01'); o.setOrigin(0.5, 1); this.puff(o.x, o.y - 30); } }
  onHired(r) { this.addStaff(r.staff, true); }

  // ------------------------------------------------------------ cat
  addCat() {
    const st = this.ctrl.state, door = STAGES[st.stage].door;
    const w = G.tileToWorld(Math.min(door.gx + 2, 3), door.gy);
    this.cat = this.add.image(w.x, w.y, A, 'kedi_ofis_otur_01').setScale(S).setOrigin(0.5, 1);
    this.cat.setDepth(G.depthOf(w.x, w.y)); this.cat.setData('cat', true);
    this.world.push(this.cat);
    this.catState = 'otur';
  }
  catNap(e) {
    const cat = this.cat; if (!cat || this.catState === 'walk') return;
    const d = this.ctrl.state.desks.find((x) => x.id === e.deskId); if (!d) return;
    const w = G.tileToWorld(d.gx, d.gy);
    const tx = w.x + 18, ty = w.y - 2 - 20; // on the keyboard, desk top
    this.catState = 'walk';
    cat.setFrame('kedi_ofis_yuru_01'); cat.setOrigin(0.5, 1); cat.setFlipX(tx > cat.x);
    const ground = { x: w.x + 18, y: w.y + 12 };
    this.tweens.chain({ targets: cat, tweens: [
      { x: ground.x, y: ground.y, duration: 2200, onUpdate: () => cat.setDepth(G.depthOf(cat.x, cat.y)) },
      { x: tx, y: ty, duration: 350, ease: 'Quad.easeOut', onStart: () => cat.setDepth(G.depthOf(w.x, w.y) + 1) }
    ], onComplete: () => {
      this.catState = 'yat'; cat.setFrame('kedi_ofis_yat_01'); cat.setOrigin(0.5, 1); cat.setDepth(G.depthOf(w.x, w.y) + 1);
      this.say(cat, rnd(list('bubbles.cat')), 1800);
      const who = [...this.staffSprites.values()].find((o) => this.ctrl.state.staff.some((s) => s.id === o.getData('staff') && s.deskId === d.id));
      if (who) this.time.delayedCall(2200, () => this.say(who, t('bubbles.catKeyboard'), 2200));
      this.time.delayedCall(e.sec * 1000, () => this.catWake(ground));
    } });
  }
  catWake(ground) {
    const cat = this.cat; if (!cat) return;
    this.catState = 'walk'; cat.setFrame('kedi_ofis_yuru_02'); cat.setOrigin(0.5, 1);
    const st = this.ctrl.state, a = G.stageArea(st.stage);
    const dest = G.tileToWorld(Math.floor(a.w / 2), a.h - 1);
    cat.setFlipX(dest.x > cat.x);
    this.tweens.chain({ targets: cat, tweens: [
      { x: ground.x, y: ground.y, duration: 300 },
      { x: dest.x, y: dest.y, duration: 2600, onUpdate: () => cat.setDepth(G.depthOf(cat.x, cat.y)) }
    ], onComplete: () => { this.catState = 'otur'; cat.setFrame('kedi_ofis_otur_01'); cat.setOrigin(0.5, 1); } });
  }

  // ------------------------------------------------------------ pools: bubbles + coins (+ puffs)
  makePools() {
    this.bubbles = [];
    for (let i = 0; i < BUBBLE_POOL; i++) {
      const g = this.add.graphics();
      const txt = this.add.text(0, 0, '', { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontSize: '11px', color: '#2a2230', align: 'center' }).setOrigin(0.5, 0.5);
      txt.setResolution(Math.min(2, this.dpr) * 2);
      const c = this.add.container(0, 0, [g, txt]).setDepth(200000).setVisible(false);
      c.setData('g', g); c.setData('t', txt); c.setData('busy', false);
      this.bubbles.push(c);
    }
    this.coins = [];
    for (let i = 0; i < COIN_POOL; i++) this.coins.push(this.add.image(0, 0, A, 'fx_para_01').setScale(S).setVisible(false).setDepth(190000));
    this.arrow = this.add.image(0, 0, A, 'ui_ok_01').setScale(S).setVisible(false).setDepth(210000).setOrigin(0.5, 1);
    this.tweens.add({ targets: this.arrow, scaleY: S * 0.85, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.easeInOut' });
    this.ghost = this.add.image(0, 0, A, 'masa_tekli_laptop_01').setScale(S).setAlpha(0.75).setVisible(false).setDepth(180000);
    this.fx = [];
    for (let i = 0; i < FX_POOL; i++) this.fx.push(this.add.image(0, 0, A, 'fx_duman_01').setScale(S).setVisible(false).setDepth(195000));
  }
  fxImg(frame) { const o = this.fx.find((x) => !x.visible); if (!o) return null; o.setFrame(frame).setScale(S).setAlpha(1).setAngle(0).setVisible(true); return o; }
  // v2: each "visual" event card makes something happen in the office while the card is open
  playEventVisual(id) {
    const ev = EVENTS[id]; if (!ev || !ev.visual) return;
    const st = this.ctrl.state, fd = st.desks[0], fw = G.tileToWorld(fd.gx, fd.gy);
    this.lastVisual = ev.visual;
    const staffed = st.desks.filter((d) => st.staff.some((x) => x.deskId === d.id));
    if (ev.visual === 'duman') { // smoke from the server rack(s), else from the founder laptop
      const racks = [...this.itemSprites.entries()].filter(([iid]) => (st.items.find((x) => x.id === iid) || {}).type === 'sunucu').map(([, o]) => ({ x: o.x, y: o.y - 70 }));
      const src = racks.length ? racks : [{ x: fw.x + 16, y: fw.y - 40 }];
      let n = 0;
      const ev2 = this.time.addEvent({ delay: 380, repeat: 22, callback: () => {
        const p = src[n++ % src.length], o = this.fxImg('fx_duman_01'); if (!o) return;
        o.setPosition(p.x + (Math.random() - 0.5) * 10, p.y).setScale(S * 0.6);
        this.tweens.add({ targets: o, y: p.y - 50 - Math.random() * 20, x: o.x + (Math.random() - 0.3) * 24, scale: S * 1.2, alpha: 0, duration: 1800, onComplete: () => o.setVisible(false) });
      } });
      this.world.push({ destroy: () => ev2.remove(false) });
    } else if (ev.visual === 'kedi') { // the office cat lies down on the founder's keyboard
      this.catNap({ deskId: fd.id, sec: 14 });
    } else if (ev.visual === 'takvim') { // calendar invites pop up over the team
      const who = [...this.staffSprites.values()].slice(0, 10);
      who.forEach((o, i) => this.time.delayedCall(i * 120, () => {
        const f = this.fxImg('fx_takvim_01'); if (!f) return;
        f.setPosition(o.x, o.y - 70).setScale(S * 0.3);
        this.tweens.add({ targets: f, scale: S, y: o.y - 78, duration: 300, ease: 'Back.easeOut', onComplete: () => this.tweens.add({ targets: f, alpha: 0, delay: 2200, duration: 400, onComplete: () => f.setVisible(false) }) });
      }));
      const pm = st.staff.find((x) => x.type === 'pm'), po = pm && this.staffSprites.get(pm.id);
      if (po) this.time.delayedCall(700, () => this.say(po, rnd(list('bubbles.pm')), 2600));
    } else if (ev.visual === 'kagit') { // revision files fly in through the door to the founder desk
      const door = STAGES[st.stage].door, dw = G.tileToWorld(door.gx, door.gy);
      for (let i = 0; i < 8; i++) this.time.delayedCall(i * 160, () => {
        const f = this.fxImg('fx_kagit_01'); if (!f) return;
        f.setPosition(dw.x, dw.y - 40).setAngle(-30 + Math.random() * 60);
        this.tweens.add({ targets: f, x: fw.x + 16 + (Math.random() - 0.5) * 20, y: fw.y - 30 - i * 2, angle: (Math.random() - 0.5) * 30, duration: 900, ease: 'Quad.easeInOut', onComplete: () => this.tweens.add({ targets: f, alpha: 0, delay: 1800, duration: 400, onComplete: () => f.setVisible(false) }) });
      });
    } else if (ev.visual === 'begeni') { // likes rise over every desk
      const ds = staffed.length ? staffed : [fd];
      for (let i = 0; i < 16; i++) this.time.delayedCall(i * 140, () => {
        const d = ds[i % ds.length], w = G.tileToWorld(d.gx, d.gy), f = this.fxImg(i % 3 ? 'fx_begeni_01' : 'fx_kalp_01'); if (!f) return;
        f.setPosition(w.x + 16 + (Math.random() - 0.5) * 20, w.y - 50);
        this.tweens.add({ targets: f, y: w.y - 100 - Math.random() * 20, alpha: 0, duration: 1500, ease: 'Quad.easeOut', onComplete: () => f.setVisible(false) });
      });
    }
  }
  say(target, text, ms = 2200) {
    if (!target || !text) return;
    let b = this.bubbles.find((x) => x.getData('target') === target) || this.bubbles.find((x) => !x.getData('busy'));
    if (!b) return;
    const g = b.getData('g'), txt = b.getData('t');
    txt.setText(text);
    const w = Math.max(40, txt.width + 14), h = txt.height + 8;
    g.clear(); g.fillStyle(0xffffff, 0.96); g.lineStyle(1.5, 0x2a2230, 0.5);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 7); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 7);
    g.fillTriangle(-5, h / 2 - 1, 5, h / 2 - 1, 0, h / 2 + 6);
    b.setData('busy', true); b.setData('target', target); b.setData('until', this.time.now + ms);
    b.setVisible(true).setAlpha(0).setScale(0.6);
    this.tweens.add({ targets: b, alpha: 1, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.placeBubble(b);
  }
  placeBubble(b) {
    const tg = b.getData('target');
    if (!tg || !tg.active) { b.setVisible(false); b.setData('busy', false); b.setData('target', null); return; }
    const top = tg.y - tg.displayHeight * (tg.originY || 1) - 10;
    b.setPosition(tg.x, top);
  }
  coinBurst(x, y, n = 5) {
    let k = 0;
    for (const c of this.coins) {
      if (c.visible) continue;
      c.setPosition(x + (Math.random() - 0.5) * 16, y).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: c, y: y - 40 - Math.random() * 25, x: c.x + (Math.random() - 0.5) * 30, alpha: 0, duration: 800 + Math.random() * 300, ease: 'Quad.easeOut', onComplete: () => c.setVisible(false) });
      if (++k >= n) break;
    }
  }
  puff(x, y) {
    let k = 0;
    for (const c of this.coins) {
      if (c.visible) continue;
      c.setFrame('fx_yildiz_01').setPosition(x, y).setVisible(true).setAlpha(1);
      const a = Math.random() * Math.PI * 2;
      this.tweens.add({ targets: c, x: x + Math.cos(a) * 30, y: y + Math.sin(a) * 16 - 10, alpha: 0, duration: 500, onComplete: () => { c.setVisible(false); c.setFrame('fx_para_01'); } });
      if (++k >= 5) break;
    }
  }
  onDelivered(d) {
    const st = this.ctrl.state;
    // staff who worked on it are already freed; celebrate at the founder desk + a random staff
    const fd = st.desks[0], w = G.tileToWorld(fd.gx, fd.gy);
    this.coinBurst(w.x + 16, w.y - 30, 6);
    const others = [...this.staffSprites.values()];
    const who = rnd(others);
    if (who) this.say(who, rnd(list('bubbles.delivered')), 1800);
  }

  // ------------------------------------------------------------ placement mode
  showPlacement(p) {
    for (const h of this.hl) h.setVisible(false);
    this.ghost.setVisible(false); this.pendingTile = null;
    if (!p) { if (!this.glowTimer) this.hideGlow(); return; }
    this.showGlow(E.glowTiles(this.ctrl.state));
    const spots = G.validSpots(this.ctrl.state, p.kind);
    let i = 0;
    for (const [gx, gy] of spots) {
      let h = this.hl[i];
      if (!h) { h = this.add.image(0, 0, A, 'sec_karo_ok_01').setScale(S).setDepth(-10000); this.hl.push(h); }
      const w = G.tileToWorld(gx, gy);
      h.setPosition(w.x, w.y).setVisible(true).setAlpha(0.9);
      i++;
    }
    this.ghost.setFrame(p.kind);
    if (spots.length) { this.fitCamera(false); }
  }
  hoverPlacement(wx, wy) {
    const p = this.ctrl.placing; if (!p) return;
    const { gx, gy } = G.worldToTile(wx, wy);
    if (!G.inArea(this.ctrl.state.stage, gx, gy)) { this.ghost.setVisible(false); return; }
    const w = G.tileToWorld(gx, gy);
    const ok = G.canPlace(this.ctrl.state, p.kind, gx, gy);
    this.ghost.setPosition(w.x, w.y).setVisible(true).setTint(ok ? 0xb8ffb8 : 0xff9090);
    if (p.item) this.previewItem(p, gx, gy, ok);
  }
  // v2: an item about to be placed lights up its future area
  previewItem(p, gx, gy, ok) {
    const st = this.ctrl.state;
    this.pendingTile = ok ? gx + ',' + gy : null;
    this.showGlow(E.glowTiles(st), ok ? { tiles: E.itemPreviewTiles(st, p.item, gx, gy), kind: ITEMS[p.item].reward ? 'reward' : 'speed' } : null);
  }

  // ------------------------------------------------------------ tutorial arrow
  updateArrow() {
    const h = this.ctrl.hint();
    if (h && h.target === 'laptop') {
      const d = this.ctrl.state.desks[0], w = G.tileToWorld(d.gx, d.gy);
      this.arrow.setPosition(w.x + 16, w.y - 50).setVisible(true);
    } else this.arrow.setVisible(false);
  }

  // ------------------------------------------------------------ camera + input
  fitCamera(recenter) {
    const cam = this.cameras.main, b = this.bounds || this.computeBounds();
    const vw = this.scale.width / this.dpr, vh = this.scale.height / this.dpr;
    const padTop = this.opts.padTop || 70, padBottom = this.opts.padBottom || 80;
    const fit = Math.min(vw / (b.w + 8), (vh - padTop - padBottom) / (b.h + 8));
    this.fitZoom = Math.max(0.38, Math.min(2.2, fit));
    if (recenter) this.userZoom = this.fitZoom;
    this.userZoom = Phaser.Math.Clamp(this.userZoom, this.fitZoom * 0.7, 3);
    cam.setZoom(this.userZoom * this.dpr);
    if (recenter) cam.centerOn(b.cx, b.cy + (padBottom - padTop) / 2 / this.userZoom);
    this.clampCam();
  }
  clampCam() {
    const cam = this.cameras.main, b = this.bounds; if (!b) return;
    const c = cam.midPoint;
    const x = Phaser.Math.Clamp(c.x, b.L, b.R), y = Phaser.Math.Clamp(c.y, b.T, b.B);
    if (x !== c.x || y !== c.y) cam.centerOn(x, y);
  }
  zoomBy(f, sx, sy) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    this.userZoom = Phaser.Math.Clamp(this.userZoom * f, this.fitZoom * 0.7, 3);
    cam.setZoom(this.userZoom * this.dpr);
    cam.preRender();
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x; cam.scrollY += before.y - after.y;
    this.clampCam();
  }
  setupInput() {
    this.input.addPointer(1);
    const cam = this.cameras.main;
    let start = null, pinch = null, longTimer = null;
    const clearLong = () => { if (longTimer) { longTimer.remove(false); longTimer = null; } };
    this.input.on('pointerdown', (p) => {
      const ps = [this.input.pointer1, this.input.pointer2].filter((x) => x && x.isDown);
      if (ps.length >= 2) {
        clearLong(); start = null;
        pinch = { d: Phaser.Math.Distance.Between(ps[0].x, ps[0].y, ps[1].x, ps[1].y), z: this.userZoom };
        return;
      }
      start = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, t: this.time.now, moved: false, id: p.id };
      clearLong();
      longTimer = this.time.delayedCall(LONG_MS, () => {
        if (start && !start.moved) { const wp = cam.getWorldPoint(p.x, p.y); start.long = true; this.longPress(wp.x, wp.y); }
      });
    });
    this.input.on('pointermove', (p) => {
      if (pinch) {
        const ps = [this.input.pointer1, this.input.pointer2];
        if (ps[0].isDown && ps[1].isDown) {
          const d = Phaser.Math.Distance.Between(ps[0].x, ps[0].y, ps[1].x, ps[1].y);
          const target = Phaser.Math.Clamp(pinch.z * d / pinch.d, this.fitZoom * 0.7, 3);
          this.zoomBy(target / this.userZoom, (ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
        }
        return;
      }
      if (this.ctrl.placing && !p.isDown) { const wp = cam.getWorldPoint(p.x, p.y); this.hoverPlacement(wp.x, wp.y); }
      if (!start || !p.isDown || p.id !== start.id) return;
      const dx = p.x - start.x, dy = p.y - start.y;
      if (!start.moved && Math.hypot(dx, dy) > TAP_MOVE * this.dpr) { start.moved = true; clearLong(); }
      if (start.moved) { cam.scrollX = start.sx - dx / cam.zoom; cam.scrollY = start.sy - dy / cam.zoom; this.clampCam(); }
    });
    this.input.on('pointerup', (p) => {
      clearLong();
      if (pinch) { if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) pinch = null; start = null; return; }
      if (start && !start.moved && !start.long && p.id === start.id) {
        const wp = cam.getWorldPoint(p.x, p.y);
        this.tap(wp.x, wp.y);
      }
      start = null;
    });
    this.input.on('wheel', (p, objs, dx, dy) => { this.zoomBy(dy > 0 ? 0.9 : 1.1, p.x, p.y); });
  }
  pick(wx, wy) {
    if (this.cat && this.cat.getBounds().contains(wx, wy)) return { kind: 'cat' };
    for (const [id, o] of this.itemSprites) { const b = o.getBounds(); b.x += b.width * 0.2; b.width *= 0.6; if (b.contains(wx, wy)) return { kind: 'item', id }; }
    const staff = [...this.staffSprites.values()].sort((a, b) => b.depth - a.depth);
    for (const o of staff) {
      const b = o.getBounds(); b.x += b.width * 0.2; b.width *= 0.6; // tighter than the frame
      if (b.contains(wx, wy)) return { kind: 'staff', id: o.getData('staff') };
    }
    const { gx, gy } = G.worldToTile(wx, wy);
    const hit = G.occupancy(this.ctrl.state).get(gx + ',' + gy);
    if (hit && (hit.startsWith('desk:') || hit.startsWith('seat:'))) return { kind: 'desk', id: +hit.split(':')[1] };
    if (hit && hit.startsWith('item:')) return { kind: 'item', id: +hit.split(':')[1] };
    // desk sprite bounds as a fallback (laptops stick up above their tiles)
    for (const [id, o] of this.deskSprites) if (o.getBounds().contains(wx, wy)) return { kind: 'desk', id };
    return { kind: 'tile', gx, gy };
  }
  tap(wx, wy) {
    const c = this.ctrl;
    if (c.placing) {
      const { gx, gy } = G.worldToTile(wx, wy);
      // items: first tap shows where the glow will be, a second tap on the same tile places it (mouse: hover + click)
      if (c.placing.item && this.pendingTile !== gx + ',' + gy) {
        const ok = G.inArea(c.state.stage, gx, gy) && G.canPlace(c.state, c.placing.kind, gx, gy);
        if (!ok) { this.opts.onPlaceFail && this.opts.onPlaceFail('yer'); return; }
        const w = G.tileToWorld(gx, gy);
        this.ghost.setPosition(w.x, w.y).setVisible(true).setTint(0xb8ffb8);
        this.previewItem(c.placing, gx, gy, true);
        return;
      }
      const r = c.placeAt(gx, gy);
      if (!r.ok) this.opts.onPlaceFail && this.opts.onPlaceFail(r.reason);
      return;
    }
    const hit = this.pick(wx, wy);
    const founder = c.state.staff.find((s) => s.type === 'kurucu');
    const founderDesk = c.state.desks[0].id;
    if (hit.kind === 'cat') { this.say(this.cat, rnd(list('bubbles.cat')), 1500); this.heart(this.cat.x, this.cat.y - 20); return; }
    if ((hit.kind === 'desk' && hit.id === founderDesk) || (hit.kind === 'staff' && founder && hit.id === founder.id)) {
      const r = c.tapLaptop();
      const d = c.state.desks[0], w = G.tileToWorld(d.gx, d.gy);
      if (r.worked) { this.typeFx(w.x + 16, w.y - 34); const o = this.staffSprites.get(founder.id); if (o) o.setFrame('calisan_kurucu_calis_02'); }
      return;
    }
    if (hit.kind === 'item') { this.flashGlow(4000); this.opts.onInfo && this.opts.onInfo(hit); return; }
    if (hit.kind === 'staff' || hit.kind === 'desk') { this.opts.onInfo && this.opts.onInfo(hit); return; }
  }
  longPress(wx, wy) {
    if (this.ctrl.placing) return;
    const hit = this.pick(wx, wy);
    if (hit.kind !== 'tile') this.opts.onInfo && this.opts.onInfo(hit);
  }
  typeFx(x, y) {
    for (const c of this.coins) {
      if (c.visible) continue;
      c.setFrame('fx_yildiz_01').setPosition(x + (Math.random() - 0.5) * 20, y).setVisible(true).setAlpha(1).setScale(S * 0.7);
      this.tweens.add({ targets: c, y: y - 22, alpha: 0, duration: 420, onComplete: () => { c.setVisible(false); c.setFrame('fx_para_01'); c.setScale(S); } });
      break;
    }
  }
  heart(x, y) {
    for (const c of this.coins) {
      if (c.visible) continue;
      c.setFrame('fx_kalp_01').setPosition(x, y).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: c, y: y - 26, alpha: 0, duration: 900, onComplete: () => { c.setVisible(false); c.setFrame('fx_para_01'); } });
      break;
    }
  }
  // world position of the founder laptop in CSS px (for DOM hints / tests)
  laptopScreen() {
    const d = this.ctrl.state.desks[0], w = G.tileToWorld(d.gx, d.gy), cam = this.cameras.main;
    return { x: (w.x + 16 - cam.worldView.x) * cam.zoom / this.dpr, y: (w.y - 12 - cam.worldView.y) * cam.zoom / this.dpr };
  }
  worldToCss(x, y) { const cam = this.cameras.main; return { x: (x - cam.worldView.x) * cam.zoom / this.dpr, y: (y - cam.worldView.y) * cam.zoom / this.dpr }; }

  // ------------------------------------------------------------ per-frame
  update(time, delta) {
    this.ctrl.tick(Date.now());
    const st = this.ctrl.state;
    this.animT += delta;
    if (this.animT > 260) {
      this.animT = 0; this.frameToggle = !this.frameToggle;
      for (const s of st.staff) {
        const o = this.staffSprites.get(s.id); if (!o) continue;
        const walking = o.getData('walking');
        const pose = walking ? 'yuru' : (s.projectId != null ? 'calis' : 'bekle');
        const fr = pose === 'bekle' ? (Math.random() < 0.08 ? 2 : 1) : (this.frameToggle ? 1 : 2);
        o.setFrame('calisan_' + s.type + '_' + pose + '_0' + fr); o.setOrigin(0.5, 1);
      }
      if (this.cat && this.catState === 'yat') { this.cat.setFrame('kedi_ofis_yat_0' + (this.frameToggle ? 1 : 2)); this.cat.setOrigin(0.5, 1); }
      if (this.cat && this.catState === 'walk') { this.cat.setFrame('kedi_ofis_yuru_0' + (this.frameToggle ? 1 : 2)); this.cat.setOrigin(0.5, 1); }
    }
    // random speech bubbles
    this.bubbleT -= delta / 1000;
    if (this.bubbleT <= 0) {
      this.bubbleT = 4 + Math.random() * 5;
      const s = rnd(st.staff.filter((x) => x.type !== 'kurucu' || st.staff.length === 1));
      const o = s && this.staffSprites.get(s.id);
      if (o && !o.getData('walking')) {
        const key = s.projectId == null ? 'bubbles.idle' : s.type === 'tasarimci' ? 'bubbles.design' : s.type === 'yzajan' ? 'bubbles.robot' : s.type === 'pm' ? 'bubbles.pm' : 'bubbles.work';
        if (s.projectId != null || st.projects.length === 0) this.say(o, rnd(list(key)), 2200);
      }
    }
    for (const b of this.bubbles) {
      if (!b.getData('busy')) continue;
      if (time > b.getData('until')) { b.setVisible(false); b.setData('busy', false); b.setData('target', null); } else this.placeBubble(b);
    }
  }
}
