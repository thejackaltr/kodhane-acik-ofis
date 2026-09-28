// DOM overlay UI: HUD, bottom nav + sheets, hints, modals (event cards, welcome back, info, menu, share, cloud).
import { h, clear, add } from './dom.js';
import { t, tp, raw, item, list, upper, available, locale } from '../logic/i18n.js';
import { tl, fmt, fmtDuration } from '../logic/format.js';
import * as E from '../logic/economy.js';
import { STAFF, STAFF_ORDER, STAGES, FUTURE_STAGES, UPGRADES, UPGRADE_ORDER, CFG, ITEMS, ITEM_ORDER, EVENTS } from '../logic/config.js';
import { hasRack } from '../logic/events.js';
import * as G from '../logic/grid.js';
import { openShare } from './share.js';
import { holdButton } from './hold.js';

const NAV = [['offers', '📋'], ['team', '👥'], ['office', '🏢'], ['share', '📸']];
const pct = (x) => Math.round(x * 100);
// staff descriptions with their v2 bonus number (%{n})
export function staffDesc(type) { const d = STAFF[type] || {}; return tp('staff.' + type + '.desc', { n: pct(d.projectBonus || d.adjSpeed || 0) }); }
const ITEM_IC = { kahve: '☕', bitki: '🪴', sunucu: '🗄️' };
export function itemEffect(type) { const d = ITEMS[type]; return t('items.' + type + '.effect', { n: pct(d.speed || d.reward || 0) }); }

export class UI {
  constructor(root, ctrl, opts) {
    this.root = root; this.ctrl = ctrl; this.opts = opts || {};
    this.sheet = null; this.modalQueue = []; this.modalOpen = null;
    this.lastRender = 0; this.dirty = true;
    this.build();
    ctrl.on('change', () => { this.dirty = true; });
    ctrl.on('offers', () => { this.dirty = true; });
    ctrl.on('tutorial', () => this.renderHint());
    ctrl.on('accepted', () => this.renderHint());
    ctrl.on('openOffers', () => this.openSheet('offers'));
    ctrl.on('delivered', (d) => this.toast(t('toast.delivered', { p: t('projects.' + d.key), v: tl(d.pay) }), 'ok'));
    ctrl.on('hired', (r) => { this.toast(t('toast.hired', { name: t('staff.' + r.staff.type + '.name') })); this.closeSheet(); });
    ctrl.on('placing', (p) => this.renderPlaceBar(p));
    ctrl.on('itemMoved', (it) => this.toast(t('toast.itemMoved', { name: t('items.' + it.type + '.name') }), 'ok'));
    ctrl.on('deskMoved', () => this.toast(t('toast.deskMoved'), 'ok'));
    ctrl.on('event', (id) => this.showEvent(id));
    ctrl.on('welcome', (w) => this.showWelcome(w));
    ctrl.on('askCloud', () => this.opts.cloud && this.queueModal(this.opts.cloud.renderAsk(this), { dismissable: true, cls: 'cloud' }));
    ctrl.on('moved', (st) => this.showStageUp(st));
    this.loop = () => { this.frame(); requestAnimationFrame(this.loop); };
    requestAnimationFrame(this.loop);
    this.renderHint();
  }
  frame() {
    const now = performance.now();
    if (now - this.lastRender < 250) return;
    this.lastRender = now;
    this.renderHud();
    if (this.dirty) { this.dirty = false; this.renderSheet(); this.renderBadges(); this.renderHint(); }
    this.renderProjects();
  }

  // ------------------------------------------------------------ skeleton
  build() {
    const r = this.root;
    this.hud = h('div', { class: 'hud' },
      h('div', { class: 'hud-money' }, h('span', { class: 'hud-label', text: upper(t('hud.money')) }), this.moneyEl = h('b', { class: 'money', 'data-test': 'money' }), this.rateEl = h('small', { class: 'rate' })),
      this.stageEl = h('div', { class: 'hud-stage' }),
      h('button', { class: 'icon-btn', 'aria-label': t('hud.menu'), title: t('hud.menu'), onclick: () => this.showMenu(), 'data-test': 'menu' }, '☰')
    );
    this.projEl = h('div', { class: 'projects', 'aria-live': 'polite' });
    this.hintEl = h('div', { class: 'hint hidden', role: 'status', 'data-test': 'hint' });
    this.nav = h('nav', { class: 'nav' }, NAV.map(([id, ic]) =>
      h('button', { class: 'nav-btn', 'data-nav': id, 'data-test': 'nav-' + id, onclick: () => (id === 'share' ? this.share() : this.toggleSheet(id)) },
        h('span', { class: 'nav-ic', 'aria-hidden': 'true', text: ic }), h('span', { class: 'nav-tx', text: id === 'share' ? t('share.button') : t('nav.' + id) }), h('span', { class: 'badge hidden' }))));
    this.sheetEl = h('section', { class: 'sheet hidden', role: 'dialog', 'aria-modal': 'false' });
    this.placeBar = h('div', { class: 'placebar hidden' });
    this.modalEl = h('div', { class: 'modal-wrap hidden', onclick: (e) => { if (e.target === this.modalEl && this.modalOpen && this.modalOpen.dismissable) this.closeModal(); } });
    this.toastEl = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.zoomEl = h('div', { class: 'zoom' },
      h('button', { class: 'icon-btn zin', 'aria-label': t('hud.zoomIn'), onclick: () => this.opts.zoom && this.opts.zoom(1.2) }, '+'),
      h('button', { class: 'icon-btn zout', 'aria-label': t('hud.zoomOut'), onclick: () => this.opts.zoom && this.opts.zoom(1 / 1.2) }, '−'),
      h('button', { class: 'icon-btn zfit', 'aria-label': t('hud.zoomFit'), title: t('hud.zoomFit'), 'data-test': 'zoom-fit', onclick: () => this.opts.fit && this.opts.fit() }, '⤢'));
    add(r, this.hud, this.projEl, this.hintEl, this.zoomEl, this.sheetEl, this.placeBar, this.nav, this.modalEl, this.toastEl);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.modalOpen && this.modalOpen.dismissable) this.closeModal();
      else if (this.ctrl.placing) this.ctrl.cancelPlacing();
      else if (this.sheet) this.closeSheet();
    });
  }

  // ------------------------------------------------------------ HUD
  renderHud() {
    const s = this.ctrl.state;
    this.moneyEl.textContent = tl(s.money);
    this.rateEl.textContent = t('hud.perMin', { v: tl(E.incomePerMin(s)) });
    this.stageEl.textContent = t('stages.' + STAGES[s.stage].id);
  }
  renderProjects() {
    const s = this.ctrl.state;
    const key = s.projects.map((p) => p.id).join(',');
    if (this.projKey !== key) {
      this.projKey = key; clear(this.projEl);
      for (const p of s.projects) {
        const bar = h('i'); const eta = h('small');
        const el = h('div', { class: 'proj' }, h('span', { class: 'proj-name', text: t('projects.' + p.key) }), h('div', { class: 'bar' }, bar), eta);
        el._bar = bar; el._eta = eta; el._id = p.id;
        this.projEl.appendChild(el);
      }
    }
    for (const el of this.projEl.children) {
      const p = s.projects.find((x) => x.id === el._id); if (!p) continue;
      el._bar.style.width = Math.round(E.projectProgress(p) * 100) + '%';
      const rem = E.projectRemainingSec(s, p);
      el._eta.textContent = isFinite(rem) ? t('offers.eta', { t: fmtDuration(Math.ceil(rem)) }) : t('offers.noStaff');
    }
  }
  renderBadges() {
    const s = this.ctrl.state;
    const b = this.nav.querySelector('[data-nav="offers"] .badge');
    b.textContent = s.offers.length; b.classList.toggle('hidden', !s.offers.length);
  }
  renderHint() {
    const hint = this.ctrl.hint();
    const txt = hint ? tp(hint.key) : '';
    if (this.hintEl.textContent !== txt) {
      this.hintEl.textContent = txt;
      this.hintEl.classList.toggle('hidden', !txt);
      if (txt) { this.hintEl.classList.remove('pop'); void this.hintEl.offsetWidth; this.hintEl.classList.add('pop'); }
    }
    for (const btn of this.nav.querySelectorAll('.nav-btn')) btn.classList.remove('pulse');
    if (hint && hint.target === 'ekip') this.nav.querySelector('[data-nav="team"]').classList.add('pulse');
    if (hint && hint.target === 'teklif') this.nav.querySelector('[data-nav="offers"]').classList.add('pulse');
  }

  // ------------------------------------------------------------ sheets
  toggleSheet(id) { if (this.sheet === id) this.closeSheet(); else this.openSheet(id); }
  openSheet(id) {
    if (this.ctrl.placing) this.ctrl.cancelPlacing();
    this.sheet = id; this.sheetEl.classList.remove('hidden');
    for (const b of this.nav.querySelectorAll('.nav-btn')) b.classList.toggle('active', b.dataset.nav === id);
    this.renderSheet();
  }
  closeSheet() {
    this.sheet = null; this.sheetEl.classList.add('hidden');
    for (const b of this.nav.querySelectorAll('.nav-btn')) b.classList.remove('active');
  }
  renderSheet() {
    if (!this.sheet) return;
    const keepScroll = this.sheetBody ? this.sheetBody.scrollTop : 0;
    clear(this.sheetEl);
    const head = h('header', { class: 'sheet-head' }, h('h2', { text: t('nav.' + this.sheet) }), h('button', { class: 'icon-btn', 'aria-label': t('menu.close'), onclick: () => this.closeSheet() }, '✕'));
    this.sheetBody = h('div', { class: 'sheet-body' });
    add(this.sheetEl, head, this.sheetBody);
    if (this.sheet === 'offers') this.renderOffers(this.sheetBody);
    if (this.sheet === 'team') this.renderTeam(this.sheetBody);
    if (this.sheet === 'office') this.renderOffice(this.sheetBody);
    this.sheetBody.scrollTop = keepScroll;
  }
  renderOffers(body) {
    const s = this.ctrl.state, max = E.maxActiveProjects(s), full = s.projects.length >= max;
    if (E.autoAccept(s)) add(body, h('p', { class: 'note', text: t('offers.auto') }));
    if (!s.offers.length) add(body, h('p', { class: 'empty', text: t('offers.empty') }));
    for (const o of s.offers) {
      const work = o.tasarim > 0 ? t('offers.workDesign', { kod: fmt(o.kod), tasarim: fmt(o.tasarim) }) : t('offers.work', { kod: fmt(o.kod) });
      add(body, h('div', { class: 'card offer', 'data-test': 'offer' },
        h('div', { class: 'card-main' }, h('b', { text: t('projects.' + o.key) }), h('small', { text: work })),
        h('div', { class: 'card-side' }, h('span', { class: 'price', text: tl(o.pay) }),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: () => this.ctrl.decline(o.id) }, t('offers.decline')),
            h('button', { class: 'btn primary', disabled: full, 'data-test': 'accept', onclick: () => { const r = this.ctrl.accept(o.id); if (r.ok) this.closeSheet(); else this.toast(t('toast.full')); } }, t('offers.accept'))))));
    }
    if (full) add(body, h('p', { class: 'note', text: t('offers.full', { n: max }) }));
  }
  renderTeam(body) {
    const s = this.ctrl.state, noDesk = !E.freeDesk(s);
    add(body, h('p', { class: 'note', text: t('team.count', { n: s.staff.length }) + ' · ' + t('team.rate', (() => { const r = E.teamRate(s); return { kod: fmt(r.kod), tasarim: fmt(r.tasarim) }; })()) }));
    for (const type of STAFF_ORDER) {
      const def = STAFF[type], unlocked = E.isUnlocked(s, type);
      if (!unlocked && def.unlockStage && s.stage + 1 < def.unlockStage) continue;
      const cost = E.staffCost(s, type) + (noDesk ? E.deskCost(s) : 0);
      const n = E.countType(s, type);
      let lock = '';
      if (!unlocked) lock = def.unlockStage && s.stage < def.unlockStage ? t('team.unlockStage', { stage: t('stages.' + STAGES[def.unlockStage].id) }) : t('team.unlockAt', { v: tl(def.unlockEarned) });
      add(body, h('div', { class: 'card staff' + (unlocked ? '' : ' locked'), 'data-test': 'hire-' + type },
        h('div', { class: 'avatar av-' + type, 'aria-hidden': 'true' }),
        h('div', { class: 'card-main' }, h('b', { text: t('staff.' + type + '.name') + (n ? ' ×' + n : '') }),
          h('small', { text: unlocked ? staffDesc(type) : lock }),
          unlocked ? h('small', { class: 'dim', text: t('team.rate', { kod: fmt(def.kod), tasarim: fmt(def.tasarim) }) }) : null),
        h('div', { class: 'card-side' },
          h('span', { class: 'price', text: unlocked ? tl(cost) : '🔒' }),
          h('button', { class: 'btn primary', disabled: !unlocked || s.money < cost, 'data-test': 'hire-btn-' + type,
            onclick: () => { const r = this.ctrl.hire(type); if (r.reason === 'placing') this.closeSheet(); else if (!r.ok) this.toast(t('toast.noMoney')); } },
          unlocked ? (noDesk ? t('team.hireWithDesk') : t('team.hire')) : t('team.locked')))));
    }
  }
  renderOffice(body) {
    const s = this.ctrl.state;
    const kind = E.deskKindForStage(s.stage), spots = G.validSpots(s, kind).length, dc = E.deskCost(s);
    add(body, h('div', { class: 'card' },
      h('div', { class: 'card-main' }, h('b', { text: t('office.desk') }), h('small', { text: spots ? t('office.deskDesc') : t('office.noSpace') })),
      h('div', { class: 'card-side' }, h('span', { class: 'price', text: tl(dc) }),
        h('button', { class: 'btn primary', disabled: !spots || s.money < dc, 'data-test': 'buy-desk', onclick: () => { this.closeSheet(); this.ctrl.startPlacing(null); } }, t('office.desk')))));
    const nx = STAGES[s.stage + 1];
    if (nx) {
      const can = E.canMove(s);
      add(body, h('div', { class: 'card move' },
        h('div', { class: 'card-main' }, h('b', { text: t('office.move', { stage: t('stages.' + nx.id) }) }), h('small', { text: can ? t('office.moveDesc') : t('office.moveLocked', { v: tl(nx.unlockEarned) }) })),
        h('div', { class: 'card-side' }, h('span', { class: 'price', text: tl(nx.moveCost) }),
          h('button', { class: 'btn primary', disabled: !can || s.money < nx.moveCost, 'data-test': 'move', onclick: () => { const r = this.ctrl.move(); if (r.ok) this.closeSheet(); } }, t('office.move', { stage: '' }).replace(/[:\s]+$/, '')))));
    }
    for (const f of FUTURE_STAGES) add(body, h('p', { class: 'note', text: t('office.future', { stage: t('stages.' + f) }) }));
    // v2: area items
    const shown = ITEM_ORDER.filter((id) => s.stage + 1 >= (ITEMS[id].unlockStage || 0));
    if (shown.length) add(body, h('h3', { text: t('office.items') }), h('p', { class: 'note', text: t('items.area') }));
    for (const id of shown) {
      const d = ITEMS[id], unlocked = E.itemUnlocked(s, id), n = E.itemCount(s, id), max = n >= d.max, cost = E.itemCost(s, id);
      const spotsI = unlocked && !max ? G.validSpots(s, d.kind).length : 0;
      add(body, h('div', { class: 'card item' + (unlocked ? '' : ' locked') + (max ? ' done' : ''), 'data-test': 'item-' + id },
        h('div', { class: 'item-ic ic-' + id, 'aria-hidden': 'true', text: ITEM_IC[id] }),
        h('div', { class: 'card-main' }, h('b', { text: t('items.' + id + '.name') + (n ? ' ×' + n : '') }),
          h('small', { text: unlocked ? t('items.' + id + '.desc') : t('team.unlockStage', { stage: t('stages.' + STAGES[d.unlockStage].id) }) }),
          unlocked ? h('small', { class: 'dim', text: itemEffect(id) + ' · ' + t('office.itemCount', { n, max: d.max }) }) : null),
        h('div', { class: 'card-side' },
          h('span', { class: 'price', text: !unlocked ? '🔒' : max ? '✓' : tl(cost) }),
          max ? h('span', { class: 'tag', text: t('office.itemMax') }) :
            h('button', { class: 'btn primary', disabled: !unlocked || !spotsI || s.money < cost, 'data-test': 'item-btn-' + id,
              onclick: () => { const r = this.ctrl.startItem(id); if (r.ok) this.closeSheet(); else this.toast(t('toast.noMoney')); } }, t('office.place')))));
    }
    add(body, h('h3', { text: t('office.upgrades') }));
    for (const id of UPGRADE_ORDER) {
      const u = UPGRADES[id], have = s.upgrades.includes(id), locked = u.unlockStage && s.stage < u.unlockStage;
      if (locked) continue;
      add(body, h('div', { class: 'card' + (have ? ' done' : '') },
        h('div', { class: 'card-main' }, h('b', { text: t('upgrades.' + id + '.name') }), h('small', { text: t('upgrades.' + id + '.desc') })),
        h('div', { class: 'card-side' }, h('span', { class: 'price', text: have ? '✓' : tl(u.cost) }),
          have ? h('span', { class: 'tag', text: t('office.bought') }) :
            h('button', { class: 'btn primary', disabled: s.money < u.cost, onclick: () => { const r = this.ctrl.buyUpgrade(id); if (r.ok) this.toast(t('toast.upgrade', { name: t('upgrades.' + id + '.name') }), 'ok'); } }, tl(u.cost)))));
    }
  }

  // ------------------------------------------------------------ placement bar
  renderPlaceBar(p) {
    clear(this.placeBar);
    this.placeBar.classList.toggle('hidden', !p);
    this.renderHint();
    if (!p) return;
    const s = this.ctrl.state;
    let label;
    if (p.moveDeskId != null) label = t('place.moveDesk');
    else if (p.moveId != null) label = t('place.moveItem', { name: t('items.' + p.item + '.name') });
    else if (p.item) label = t('place.costItem', { name: t('items.' + p.item + '.name'), v: tl(E.itemCost(s, p.item)) });
    else {
      const cost = E.deskCost(s) + (p.hireType ? E.staffCost(s, p.hireType) : 0);
      label = p.hireType ? t('place.costHire', { name: t('staff.' + p.hireType + '.name'), v: tl(cost) }) : t('place.cost', { v: tl(cost) });
    }
    add(this.placeBar, h('span', { text: label }), h('button', { class: 'btn ghost', 'data-test': 'place-cancel', onclick: () => this.ctrl.cancelPlacing() }, t('place.cancel')));
  }

  // ------------------------------------------------------------ modals
  queueModal(render, opts = {}) {
    this.modalQueue.push({ render, ...opts });
    if (!this.modalOpen) this.nextModal();
  }
  nextModal() {
    const m = this.modalQueue.shift();
    if (!m) { this.modalOpen = null; this.modalEl.classList.add('hidden'); clear(this.modalEl); return; }
    this.modalOpen = m;
    clear(this.modalEl);
    const box = h('div', { class: 'modal ' + (m.cls || ''), role: 'dialog', 'aria-modal': 'true' });
    this.modalEl.appendChild(box);
    this.modalEl.classList.remove('hidden');
    m.render(box, () => this.closeModal());
    const f = box.querySelector('[autofocus], button.primary, button'); if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 30);
  }
  closeModal() { if (this.modalOpen && this.modalOpen.onClose) this.modalOpen.onClose(); this.nextModal(); }
  showModal(render, opts) { this.queueModal(render, { dismissable: true, ...opts }); }

  showEvent(id) {
    this.queueModal((box, close) => {
      const ev = EVENTS[id] || {};
      const sub = ev.visual ? (id === 'sunucu' && hasRack(this.ctrl.state) ? 'subRack' : 'sub') : null;
      add(box, h('div', { class: 'event-tag', text: upper(t('events.title')) }), h('p', { class: 'event-text', 'data-test': 'event-text', text: t('events.' + id + '.text') }),
        sub ? h('p', { class: 'event-sub', 'data-test': 'event-sub', text: t('events.' + id + '.' + sub) }) : null);
      const pick = (c) => {
        const r = this.ctrl.chooseEvent(c);
        close();
        if (!r) return;
        let key = 'events.' + id + '.r' + c + (r.outcome === 'win' ? 'Win' : r.outcome === 'lose' ? 'Lose' : r.pm ? 'Pm' : '');
        if (r.noProject && typeof raw(key + 'None') === 'string') key += 'None';   // v2.1.1: no running project (events.viral.rbNone)
        this.toast(t(key, { s: r.buffSec || 0 }) + (r.cash ? ' (' + (r.cash > 0 ? '+' : '−') + tl(Math.abs(r.cash)) + ')' : ''), 'ok');
      };
      add(box, h('div', { class: 'col' },
        h('button', { class: 'btn primary big', 'data-test': 'event-a', onclick: () => pick('a') }, t('events.' + id + '.a')),
        h('button', { class: 'btn big', 'data-test': 'event-b', onclick: () => pick('b') }, t('events.' + id + '.b'))),
        h('button', { class: 'link', onclick: () => { this.ctrl.laterEvent(); close(); } }, t('events.later')));
    }, { cls: 'event', dismissable: false });
  }
  // v2: stage-up congratulation (+ share)
  showStageUp(stage) {
    const st = STAGES[stage]; if (!st) return;
    this.closeSheet();
    this.queueModal((box, close) => {
      add(box, h('div', { class: 'stageup-ic', 'aria-hidden': 'true', text: stage >= 2 ? '🚀' : '🏢' }),
        h('h2', { 'data-test': 'stageup-title', text: t('toast.moved', { stage: t('stages.' + st.id) }) }),
        h('p', { class: 'stageup-text', 'data-test': 'stageup-text', text: t('stageUp.' + st.id) }),
        h('p', { class: 'dim', text: t('office.moveDesc') }),
        h('button', { class: 'btn primary big', 'data-test': 'stageup-share', onclick: () => { close(); this.share(); } }, '📸 ' + t('stageUp.share')),
        h('button', { class: 'btn big', 'data-test': 'stageup-ok', onclick: close }, t('stageUp.ok')));
    }, { cls: 'stageup', dismissable: true });
  }
  showWelcome(w) {
    const txt = w.projects === 0 ? t('welcome.quiet', { k: w.catNaps }) : item('welcome.lines', Math.floor(Math.random() * 1000), { p: w.projects, k: w.catNaps });
    this.queueModal((box, close) => {
      add(box, h('h2', { text: t('welcome.title') }), h('p', { class: 'welcome-text', 'data-test': 'welcome-text', text: txt }),
        h('p', { class: 'welcome-earned', text: t('welcome.earned', { v: tl(w.earned) }) }),
        w.capped ? h('p', { class: 'note', text: t('welcome.cap', { h: CFG.offlineCapSec / 3600 }) }) : null,
        h('button', { class: 'btn primary big', onclick: close }, t('welcome.ok')));
    }, { cls: 'welcome', dismissable: true });
  }
  showInfo(hit) {
    const s = this.ctrl.state;
    if (hit.kind === 'cat') return this.showModal((box, close) => add(box, h('h2', { text: t('info.cat') }), h('p', { text: t('info.catDesc') }), h('button', { class: 'btn primary', onclick: close }, t('info.close'))));
    if (hit.kind === 'item') {
      const it = (s.items || []).find((x) => x.id === hit.id); if (!it) return;
      return this.showModal((box, close) => add(box, h('div', { class: 'info-head' }, h('div', { class: 'item-ic ic-' + it.type, text: ITEM_IC[it.type] }), h('div', null, h('h2', { text: t('items.' + it.type + '.name') }), h('small', { text: t('items.' + it.type + '.desc') }))),
        h('p', { 'data-test': 'item-effect', text: itemEffect(it.type) }), h('p', { class: 'note', text: t('items.area') }),
        h('div', { class: 'row' }, h('button', { class: 'btn', 'data-test': 'item-move', onclick: () => { close(); this.closeSheet(); this.ctrl.startMoveItem(it.id); } }, '↔ ' + t('items.move')),
          h('button', { class: 'btn primary', onclick: close }, t('info.close')))));
    }
    let staff = null, desk = null;
    if (hit.kind === 'staff') { staff = s.staff.find((x) => x.id === hit.id); desk = staff && s.desks.find((d) => d.id === staff.deskId); }
    if (hit.kind === 'desk') { desk = s.desks.find((d) => d.id === hit.id); staff = desk && s.staff.find((x) => x.deskId === desk.id); }
    this.showModal((box, close) => {
      const moveBtn = desk ? h('button', { class: 'btn', 'data-test': 'desk-move', onclick: () => { close(); this.closeSheet(); this.ctrl.startMoveDesk(desk.id); } }, '↔ ' + t('items.move')) : null;
      if (!staff) { add(box, h('h2', { text: t('info.desk') }), h('p', { text: t('info.deskFree') }), h('button', { class: 'btn primary', onclick: () => { close(); this.openSheet('team'); } }, t('team.hire')), moveBtn); return; }
      const def = STAFF[staff.type];
      const proj = s.projects.find((p) => p.id === staff.projectId);
      const sp = E.deskSpeedBonus(s, staff.deskId), rw = E.deskRewardBonus(s, staff.deskId);
      add(box, h('div', { class: 'info-head' }, h('div', { class: 'avatar av-' + staff.type }), h('div', null, h('h2', { text: t('staff.' + staff.type + '.name') }), h('small', { text: staffDesc(staff.type) }))),
        h('p', { class: 'dim', text: t('team.rate', { kod: fmt(def.kod), tasarim: fmt(def.tasarim) }) }),
        sp ? h('p', { class: 'bonus', 'data-test': 'info-speed', text: '⚡ ' + t('info.speedBonus', { n: pct(sp) }) }) : null,
        rw ? h('p', { class: 'bonus', 'data-test': 'info-reward', text: '💾 ' + t('info.rewardBonus', { n: pct(rw) }) }) : null,
        h('p', { text: proj ? t('team.busy', { p: t('projects.' + proj.key) }) : t('team.idle') }));
      if (staff.type === 'kurucu') add(box, h('p', { class: 'note', text: tp('team.you') }));
      if (s.projects.length > 1 || (!proj && s.projects.length)) {
        add(box, h('h3', { text: t('team.assign') }));
        for (const p of s.projects) add(box, h('button', { class: 'btn' + (p.id === staff.projectId ? ' primary' : ''), onclick: () => { this.ctrl.assign(staff.id, p.id); close(); } }, t('projects.' + p.key)));
      }
      const pr = E.promoteTarget(s, staff.id);
      if (pr) add(box, h('button', { class: 'btn primary', disabled: s.money < pr.cost, 'data-test': 'promote', onclick: () => { const r = this.ctrl.promote(staff.id); if (r.ok) close(); } }, '⬆ ' + t('staff.' + pr.to + '.name') + ' · ' + tl(pr.cost)));
      add(box, moveBtn, h('button', { class: 'btn ghost', onclick: close }, t('info.close')));
    });
  }
  showMenu() {
    const s = this.ctrl.state;
    this.showModal((box, close) => {
      add(box, h('h2', { text: t('menu.title') }),
        h('p', { class: 'dim', text: t('menu.stats', { p: s.projectsDone, k: s.catNaps, v: tl(s.totalEarned) }) }),
        this.opts.leaderboard ? h('button', { class: 'btn big', 'data-test': 'menu-leaderboard', onclick: () => { close(); this.opts.leaderboard.show(); } }, '🏆 ' + t('menu.leaderboard')) : null,
        this.opts.cloud ? h('button', { class: 'btn big', 'data-test': 'menu-cloud', onclick: () => { close(); this.opts.cloud.renderPanel(this); } }, '☁️ ' + t('menu.cloud')) : null,
        this.opts.install && this.opts.install.available() ? h('button', { class: 'btn big', onclick: () => { close(); this.opts.install.prompt(); } }, '📲 ' + t('menu.install')) : null,
        this.opts.install && this.opts.install.ios() ? h('p', { class: 'note', text: t('menu.installIos') }) : null,
        available().length > 1 ? h('label', { class: 'lang' }, t('menu.language'),
          h('select', { onchange: (e) => this.opts.changeLocale && this.opts.changeLocale(e.target.value) },
            available().map((code) => { const o = h('option', { value: code, text: t('languages.' + code) }); if (code === locale()) o.selected = true; return o; }))) : null,
        h('button', { class: 'btn big', onclick: () => { close(); this.showCredits(); } }, 'ℹ️ ' + t('menu.credits')),
        h('button', { class: 'btn big danger', 'data-test': 'menu-reset', onclick: () => { close(); this.confirmReset(); } }, t('menu.reset')),
        h('button', { class: 'btn ghost', onclick: close }, t('menu.close')));
    });
  }
  // v2.2: Yazı's fixed lists (what goes / what stays) + 2 s press-and-hold confirm. The backup line only for signed-in
  // players ({d} = backup retention days from the cloud config). reset.countdown exists in tr.json but is not used.
  confirmReset() {
    const ctx = this.opts.resetContext ? this.opts.resetContext() : {};
    const col = (cls, test, title, items) => h('section', { class: 'reset-col ' + cls, 'data-test': test }, h('h3', { text: t(title) }), h('ul', null, items.map((x) => h('li', { text: x }))));
    this.showModal((box, close) => {
      const btn = holdButton({ label: t('reset.hold'), test: 'reset-hold', onConfirm: () => { close(); this.opts.onReset && this.opts.onReset(); } });
      add(box, h('h2', { text: t('reset.title') }), h('p', { text: t('reset.body') }),
        h('div', { class: 'reset-cols' }, col('del', 'reset-delete', 'reset.lostTitle', list('reset.lost')), col('keep', 'reset-keep', 'reset.keptTitle', list('reset.kept'))),
        ctx.signedIn ? h('p', { class: 'note', 'data-test': 'reset-backup', text: t('reset.backup', { d: ctx.backupDays }) }) : null,
        btn,
        h('button', { class: 'btn ghost', autofocus: true, 'data-test': 'reset-cancel', onclick: close }, t('reset.cancel')));
    }, { cls: 'reset' });
  }
  // v2.2: "Geri al" toast for the undo window (a shrinking bar, no numbers)
  showUndo(pending, onUndo) {
    this.hideUndo();
    const left = Math.max(0, pending.until - Date.now());
    const bar = h('i', { class: 'undo-bar' });
    const el = h('div', { class: 'toast undo', role: 'status', 'data-test': 'undo-toast' },
      h('span', { text: t('reset.done') }),
      h('button', { class: 'btn primary', 'data-test': 'undo', onclick: () => { btnEl.disabled = true; Promise.resolve(onUndo && onUndo()).finally(() => { if (btnEl.isConnected) btnEl.disabled = false; }); } }, t('reset.undo')),
      bar);
    const btnEl = el.querySelector('button');
    bar.style.animationDuration = left + 'ms';
    this.toastEl.appendChild(el);
    this.undoEl = el;
  }
  hideUndo() { if (this.undoEl) { const el = this.undoEl; this.undoEl = null; el.classList.add('out'); setTimeout(() => el.remove(), 400); } }
  showCredits() {
    this.showModal((box, close) => {
      add(box, h('h2', { text: t('credits.title') }), h('p', { text: t('meta.title') }),
        h('p', { text: t('credits.art') }), h('p', { text: t('credits.engine') }), h('p', { class: 'dim', text: t('credits.fiction') }),
        h('p', { class: 'teserix' }, t('credits.made') + ' · ', h('a', { href: 'https://teserix.com', target: '_blank', rel: 'noopener' }, t('credits.link'))),
        h('button', { class: 'btn primary', onclick: close }, t('menu.close')));
    });
  }
  share() { openShare(this, this.ctrl, this.opts.snapshot); }

  // ------------------------------------------------------------ toasts
  toast(msg, kind, ms = 2600) {
    const el = h('div', { class: 'toast ' + (kind || ''), text: msg });
    this.toastEl.appendChild(el);
    while (this.toastEl.children.length > 3) { const first = [...this.toastEl.children].find((c) => c !== this.undoEl); if (!first) break; this.toastEl.removeChild(first); }
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
  }
}
