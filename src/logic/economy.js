// Core economy + simulation (pure; no DOM, no Phaser). Time is passed in explicitly.
import { CFG, STAFF, DESK, STAGES, UPGRADES, SAVE_VERSION, PROMOTE, PROMOTE_DISCOUNT, ITEMS } from './config.js';
import { canPlace, occupancy, deskTiles, chebDist, areaTiles, ringTiles } from './grid.js';
import * as R from './rng.js';

export const PROJECT_KEYS = ['kafe', 'berber', 'pastane', 'dernek', 'apartman', 'kirtasiye', 'nalbur', 'dugun', 'spor', 'pansiyon', 'balikci', 'veteriner', 'kuafor', 'firin', 'oto'];

export function newState(now, seed) {
  const st = STAGES[0];
  return {
    v: SAVE_VERSION,
    startedAt: now, lastSaved: now, lastTick: now,
    money: 0, totalEarned: 0, projectsDone: 0, catNaps: 0, taps: 0,
    playSec: 0, simSec: 0,
    stage: 0,
    rng: (seed == null ? (now % 2147483647) : seed) | 0,
    nextId: 3,
    desks: [{ id: 1, kind: DESK.founderKind, gx: st.founderDesk.gx, gy: st.founderDesk.gy }],
    staff: [{ id: 2, type: 'kurucu', deskId: 1, projectId: null }],
    offers: [],
    offerTimer: 0,
    projects: [],
    buffs: [],
    upgrades: [],
    items: [],                      // v2: placed area items { id, type, gx, gy }
    tutorial: { step: 0, done: false },
    flags: { firstOfferGiven: false, cloudAsked: false, pmTip: false, stagesCounted: [] },
    events: { nextAt: CFG.eventFirstAtPlaySec, seen: [], pending: null }
  };
}

// ---------------------------------------------------------------- rates
export function upgradeMult(state) {
  let m = 1;
  for (const id of state.upgrades) if (UPGRADES[id] && UPGRADES[id].mult) m *= UPGRADES[id].mult;
  return m;
}
export function buffMult(state) {
  let m = 1;
  for (const b of state.buffs) if (b.until > state.simSec) m *= b.mult;
  return m;
}
export function speedMult(state) { return upgradeMult(state) * buffMult(state); }

// ---------------------------------------------------------------- v2: placement bonuses
// Per desk: speed = kahve/bitki area (best of each type) + next to a Proje Yöneticisi's desk; reward = sunucu area.
const layoutCache = new WeakMap();
function layoutSig(state) {
  const it = state.items || [], d = state.desks;
  let pm = '';
  for (const s of state.staff) if (STAFF[s.type] && STAFF[s.type].adjSpeed) pm += s.deskId + ',';
  return d.length + ':' + (d.length ? d[d.length - 1].id : 0) + ':' + it.length + ':' + (it.length ? it[it.length - 1].id : 0) + ':' + pm + ':' + state.stage;
}
export function layoutBonus(state) {
  const sig = layoutSig(state), c = layoutCache.get(state);
  if (c && c.sig === sig) return c.val;
  const speed = new Map(), reward = new Map(), items = state.items || [];
  const pmDesks = [];
  for (const s of state.staff) { const t = STAFF[s.type]; if (t && t.adjSpeed) { const d = state.desks.find((x) => x.id === s.deskId); if (d) pmDesks.push({ d, pct: t.adjSpeed, tiles: deskTiles(d) }); } }
  for (const d of state.desks) {
    const tiles = deskTiles(d);
    const best = {};
    for (const it of items) {
      const def = ITEMS[it.type]; if (!def) continue;
      if (chebDist(tiles, [[it.gx, it.gy]]) > def.radius) continue;
      best[it.type] = true;
    }
    let sp = 0, rw = 0;
    for (const type of Object.keys(best)) { sp += ITEMS[type].speed || 0; rw += ITEMS[type].reward || 0; }
    let pmBest = 0;
    for (const p of pmDesks) if (p.d.id !== d.id && chebDist(tiles, p.tiles) <= 1) pmBest = Math.max(pmBest, p.pct);
    sp += pmBest;
    if (sp) speed.set(d.id, sp);
    if (rw) reward.set(d.id, rw);
  }
  const val = { speed, reward };
  layoutCache.set(state, { sig, val });
  return val;
}
export function deskSpeedBonus(state, deskId) { return layoutBonus(state).speed.get(deskId) || 0; }
export function deskRewardBonus(state, deskId) { return layoutBonus(state).reward.get(deskId) || 0; }
// glowing tiles: every item's area + the ring around each Proje Yöneticisi's desk. Map "gx,gy" -> 'speed'|'reward'
export function glowTiles(state) {
  const out = new Map();
  for (const it of state.items || []) {
    const def = ITEMS[it.type]; if (!def) continue;
    for (const [x, y] of areaTiles(state.stage, it.gx, it.gy, def.radius)) { const k = x + ',' + y; if (out.get(k) !== 'reward') out.set(k, def.reward ? 'reward' : 'speed'); }
  }
  for (const s of state.staff) {
    const t = STAFF[s.type]; if (!t || !t.adjSpeed) continue;
    const d = state.desks.find((x) => x.id === s.deskId); if (!d) continue;
    for (const [x, y] of ringTiles(state.stage, deskTiles(d))) { const k = x + ',' + y; if (!out.has(k)) out.set(k, 'speed'); }
  }
  return out;
}
// tiles a new item of this type would light up if placed at (gx,gy)
export function itemPreviewTiles(state, type, gx, gy) { const def = ITEMS[type]; return def ? areaTiles(state.stage, gx, gy, def.radius) : []; }

export function staffRate(state, s) {
  const t = STAFF[s.type]; const m = speedMult(state) * (1 + deskSpeedBonus(state, s.deskId));
  return { kod: t.kod * m, tasarim: t.tasarim * m };
}
export function teamRate(state) {
  let kod = 0, tasarim = 0;
  for (const s of state.staff) { const r = staffRate(state, s); kod += r.kod; tasarim += r.tasarim; }
  return { kod, tasarim };
}
export function projectRate(state, p) {
  let kod = 0, tasarim = 0;
  for (const s of state.staff) if (s.projectId === p.id) { const r = staffRate(state, s); kod += r.kod; tasarim += r.tasarim; }
  return { kod, tasarim };
}
// reward bonus a project would get if delivered now: Tasarımcı on it (+projectBonus) + someone in a sunucu area
export function projectBonus(state, p) {
  let tas = 0, srv = 0;
  for (const s of state.staff) {
    if (s.projectId !== p.id) continue;
    const t = STAFF[s.type];
    if (t && t.projectBonus) tas = Math.max(tas, t.projectBonus);
    srv = Math.max(srv, deskRewardBonus(state, s.deskId));
  }
  return tas + srv;
}
export function projectRemainingSec(state, p) {
  const r = projectRate(state, p);
  const rk = Math.max(0, p.need.kod - p.done.kod), rt = Math.max(0, p.need.tasarim - p.done.tasarim);
  const tk = rk <= 1e-9 ? 0 : (r.kod > 0 ? rk / r.kod : Infinity);
  const tt = rt <= 1e-9 ? 0 : (r.tasarim > 0 ? rt / r.tasarim : Infinity);
  return Math.max(tk, tt);
}
export function projectProgress(p) {
  const n = p.need.kod + p.need.tasarim;
  return n <= 0 ? 1 : Math.min(1, (Math.min(p.done.kod, p.need.kod) + Math.min(p.done.tasarim, p.need.tasarim)) / n);
}
// Estimated income per minute if the team is always busy (for the HUD)
export function incomePerMin(state) {
  const st = STAGES[state.stage];
  const tas = state.staff.some((s) => STAFF[s.type] && STAFF[s.type].projectBonus) ? 1 : 0;
  let v = 0;
  for (const s of state.staff) {
    const r = staffRate(state, s);
    v += (r.kod + r.tasarim * CFG.tasarimPremium) * (1 + deskRewardBonus(state, s.deskId) + tas * STAFF.tasarimci.projectBonus * 0.5);
  }
  return 60 * v * CFG.payPerUnit * st.mult;
}

// ---------------------------------------------------------------- costs
export function countType(state, type) { return state.staff.filter((s) => s.type === type).length; }
export function staffCost(state, type) { return Math.round(STAFF[type].cost * Math.pow(CFG.staffCostGrowth, countType(state, type))); }
export function deskCost(state) {
  const n = Math.max(0, state.desks.length - 1), early = Math.min(n, CFG.deskCostGrowthFrom - 1);
  return Math.round(DESK.base * Math.pow(CFG.deskCostGrowth, early) * Math.pow(CFG.deskCostGrowthLate, n - early));
}
export function freeDesk(state) {
  const used = new Set(state.staff.map((s) => s.deskId));
  return state.desks.find((d) => !used.has(d.id)) || null;
}
export function isUnlocked(state, type) {
  const t = STAFF[type];
  if (!t || !t.hireable) return false;
  if (t.unlockStage && state.stage < t.unlockStage) return false;
  if (t.unlockEarned && state.totalEarned < t.unlockEarned) return false;
  return true;
}
// v2: area items
export function itemCount(state, type) { return (state.items || []).filter((x) => x.type === type).length; }
export function itemCost(state, type) { const d = ITEMS[type]; return Math.round(d.cost * Math.pow(d.growth, itemCount(state, type))); }
export function itemUnlocked(state, type) { const d = ITEMS[type]; return !!d && state.stage >= (d.unlockStage || 0); }
export function itemAvailable(state, type) { return itemUnlocked(state, type) && itemCount(state, type) < ITEMS[type].max; }
export function buyItem(state, type, gx, gy) {
  const d = ITEMS[type];
  if (!d || !itemUnlocked(state, type)) return { ok: false, reason: 'kilitli' };
  if (itemCount(state, type) >= d.max) return { ok: false, reason: 'max' };
  const cost = itemCost(state, type);
  if (state.money < cost) return { ok: false, reason: 'para' };
  if (!canPlace(state, d.kind, gx, gy)) return { ok: false, reason: 'yer' };
  state.money -= cost;
  if (!state.items) state.items = [];
  const it = { id: state.nextId++, type, gx, gy };
  state.items.push(it);
  return { ok: true, item: it, cost };
}
export function maxActiveProjects(state) { return Math.min(4, 1 + Math.floor((state.staff.length - 1) / 3)); }
export function autoAccept(state) { return state.upgrades.some((id) => UPGRADES[id] && UPGRADES[id].autoAccept); }

// ---------------------------------------------------------------- offers & projects
export function makeOffer(state) {
  const team = teamRate(state), st = STAGES[state.stage];
  const dur = R.range(state, CFG.projectSec[0], CFG.projectSec[1]);
  const designHeavy = R.next(state) < 0.35;
  let kod = Math.max(CFG.minWork, team.kod * dur * (designHeavy ? 0.6 : 1));
  let tasarim = designHeavy ? Math.max(6, team.tasarim * dur * 0.9 + team.kod * dur * 0.15) : team.tasarim * dur * 0.3;
  kod = Math.round(kod); tasarim = Math.round(tasarim);
  const pay = Math.round((kod + tasarim * CFG.tasarimPremium) * CFG.payPerUnit * st.mult * R.range(state, 1.0, 1.25));
  return { id: state.nextId++, key: R.pick(state, PROJECT_KEYS), kod, tasarim, pay };
}
export function giveFirstOffer(state) {
  if (state.flags.firstOfferGiven) return null;
  state.flags.firstOfferGiven = true;
  const f = CFG.firstOffer;
  const o = { id: state.nextId++, key: f.key, kod: f.kod, tasarim: f.tasarim, pay: f.pay };
  state.offers.unshift(o);
  return o;
}
function idleStaff(state) { return state.staff.filter((s) => s.projectId == null); }
function assignIdle(state, projectId) {
  for (const s of idleStaff(state)) s.projectId = projectId;
}
// put idle staff on the active project with the fewest people
export function rebalance(state) {
  if (!state.projects.length) return;
  for (const s of idleStaff(state)) {
    let best = null, bestN = Infinity;
    for (const p of state.projects) { const n = state.staff.filter((x) => x.projectId === p.id).length; if (n < bestN) { bestN = n; best = p; } }
    if (best) s.projectId = best.id;
  }
}
export function acceptOffer(state, offerId) {
  const i = state.offers.findIndex((o) => o.id === offerId);
  if (i < 0) return { ok: false, reason: 'yok' };
  if (state.projects.length >= maxActiveProjects(state)) return { ok: false, reason: 'dolu' };
  const o = state.offers.splice(i, 1)[0];
  const p = { id: o.id, key: o.key, need: { kod: o.kod, tasarim: o.tasarim }, done: { kod: 0, tasarim: 0 }, pay: o.pay };
  state.projects.push(p);
  assignIdle(state, p.id);
  return { ok: true, project: p };
}
export function declineOffer(state, offerId) {
  const i = state.offers.findIndex((o) => o.id === offerId);
  if (i >= 0) state.offers.splice(i, 1);
}
export function assignStaff(state, staffId, projectId) {
  const s = state.staff.find((x) => x.id === staffId);
  if (!s) return false;
  if (projectId != null && !state.projects.some((p) => p.id === projectId)) return false;
  s.projectId = projectId;
  return true;
}
function completeProject(state, p, out) {
  const bonus = projectBonus(state, p);             // v2: Tasarımcı + sunucu area
  const pay = Math.round(p.pay * (1 + bonus));
  const i = state.projects.indexOf(p);
  if (i >= 0) state.projects.splice(i, 1);
  for (const s of state.staff) if (s.projectId === p.id) s.projectId = null;
  state.money += pay; state.totalEarned += pay; state.projectsDone += 1;
  if (out) { out.delivered.push({ id: p.id, key: p.key, pay, base: p.pay, bonus }); out.earned += pay; }
  rebalance(state);
}
// laptop tap: the founder types faster
export function tapPower(state) {
  const team = teamRate(state), up = state.upgrades.includes('klavye') ? 2 : 1;
  return { kod: (CFG.tap.kod + team.kod * CFG.tap.teamShare) * up, tasarim: (CFG.tap.tasarim + team.tasarim * CFG.tap.teamShare) * up };
}
export function tapLaptop(state) {
  const founder = state.staff.find((s) => s.type === 'kurucu');
  let p = founder && state.projects.find((x) => x.id === founder.projectId);
  if (!p) p = state.projects[0];
  if (!p) return { worked: false };
  state.taps += 1;
  const tp = tapPower(state);
  p.done.kod = Math.min(p.need.kod, p.done.kod + tp.kod);
  p.done.tasarim = Math.min(p.need.tasarim, p.done.tasarim + tp.tasarim);
  const out = { delivered: [], earned: 0 };
  if (p.done.kod >= p.need.kod - 1e-9 && p.done.tasarim >= p.need.tasarim - 1e-9) completeProject(state, p, out);
  return { worked: true, projectId: p.id, ...out };
}

// ---------------------------------------------------------------- buying
export function hire(state, type, deskOpt) {
  if (!isUnlocked(state, type)) return { ok: false, reason: 'kilitli' };
  const cost = staffCost(state, type);
  let desk = freeDesk(state);
  let dcost = 0;
  if (!desk) {
    if (!deskOpt) return { ok: false, reason: 'masa' };
    dcost = deskCost(state);
    if (!canPlace(state, deskOpt.kind, deskOpt.gx, deskOpt.gy)) return { ok: false, reason: 'yer' };
  }
  if (state.money < cost + dcost) return { ok: false, reason: 'para' };
  if (!desk) desk = placeDeskUnchecked(state, deskOpt.kind, deskOpt.gx, deskOpt.gy);
  state.money -= cost + dcost;
  const s = { id: state.nextId++, type, deskId: desk.id, projectId: null };
  state.staff.push(s);
  rebalance(state);
  return { ok: true, staff: s, desk, cost: cost + dcost };
}
// promotion: same desk, better type
export function promoteTarget(state, staffId) {
  const s = state.staff.find((x) => x.id === staffId);
  const to = s && PROMOTE[s.type];
  if (!to || !isUnlocked(state, to)) return null;
  return { to, cost: Math.round(staffCost(state, to) * PROMOTE_DISCOUNT) };
}
export function promote(state, staffId) {
  const tgt = promoteTarget(state, staffId);
  if (!tgt) return { ok: false, reason: 'yok' };
  if (state.money < tgt.cost) return { ok: false, reason: 'para' };
  state.money -= tgt.cost;
  const s = state.staff.find((x) => x.id === staffId);
  s.type = tgt.to;
  return { ok: true, staff: s, cost: tgt.cost };
}
function placeDeskUnchecked(state, kind, gx, gy) {
  const d = { id: state.nextId++, kind, gx, gy };
  state.desks.push(d);
  return d;
}
export function buyDesk(state, kind, gx, gy) {
  const cost = deskCost(state);
  if (state.money < cost) return { ok: false, reason: 'para' };
  if (!canPlace(state, kind, gx, gy, occupancy(state))) return { ok: false, reason: 'yer' };
  state.money -= cost;
  return { ok: true, desk: placeDeskUnchecked(state, kind, gx, gy), cost };
}
export function deskKindForStage(stage) { return stage >= 1 ? DESK.kinds[1] : DESK.kinds[0]; }
export function buyUpgrade(state, id) {
  const u = UPGRADES[id];
  if (!u || state.upgrades.includes(id)) return { ok: false, reason: 'yok' };
  if (u.unlockStage && state.stage < u.unlockStage) return { ok: false, reason: 'kilitli' };
  if (state.money < u.cost) return { ok: false, reason: 'para' };
  state.money -= u.cost; state.upgrades.push(id);
  return { ok: true };
}
export function canMove(state) {
  const nx = STAGES[state.stage + 1];
  return !!nx && state.totalEarned >= (nx.unlockEarned || 0);
}
export function moveOffice(state) {
  const nx = STAGES[state.stage + 1];
  if (!nx) return { ok: false, reason: 'yok' };
  if (state.totalEarned < (nx.unlockEarned || 0)) return { ok: false, reason: 'kilitli' };
  if (state.money < nx.moveCost) return { ok: false, reason: 'para' };
  state.money -= nx.moveCost; state.stage += 1;
  // desks keep their grid position (the floor only grows); founder desk stays put
  return { ok: true, stage: state.stage };
}

// ---------------------------------------------------------------- simulation
// Advance the world by dt seconds (event-based, deterministic). opts.auto: team accepts offers itself
// (always true for offline catch-up). Returns a summary of what happened.
export function advance(state, dt, opts = {}) {
  const out = { delivered: [], earned: 0, newOffers: 0, sec: 0 };
  if (!(dt > 0)) return out;
  const auto = opts.auto || autoAccept(state);
  let left = dt, guard = 0;
  while (left > 1e-9 && guard++ < 20000) {
    // auto-accept when someone is idle
    if (auto) {
      while (state.offers.length && state.projects.length < maxActiveProjects(state) && state.staff.some((s) => s.projectId == null)) {
        const best = state.offers.reduce((a, b) => (b.pay > a.pay ? b : a));
        acceptOffer(state, best.id);
      }
      rebalance(state);
    }
    // next event time
    let step = left;
    for (const p of state.projects) step = Math.min(step, projectRemainingSec(state, p));
    if (state.offers.length < CFG.maxOffers) step = Math.min(step, Math.max(0, CFG.offerEverySec - state.offerTimer));
    for (const b of state.buffs) if (b.until > state.simSec) step = Math.min(step, b.until - state.simSec);
    step = Math.max(0, step);
    // progress
    for (const p of state.projects) {
      const r = projectRate(state, p);
      p.done.kod = Math.min(p.need.kod, p.done.kod + r.kod * step);
      p.done.tasarim = Math.min(p.need.tasarim, p.done.tasarim + r.tasarim * step);
    }
    state.simSec += step; left -= step; out.sec += step;
    if (state.offers.length < CFG.maxOffers) {
      state.offerTimer += step;
      if (state.offerTimer >= CFG.offerEverySec - 1e-9) { state.offerTimer = 0; state.offers.push(makeOffer(state)); out.newOffers++; }
    } else state.offerTimer = 0;
    // completions
    for (const p of state.projects.slice()) {
      if (p.done.kod >= p.need.kod - 1e-9 && p.done.tasarim >= p.need.tasarim - 1e-9) completeProject(state, p, out);
    }
    state.buffs = state.buffs.filter((b) => b.until > state.simSec + 1e-9);
  }
  return out;
}
