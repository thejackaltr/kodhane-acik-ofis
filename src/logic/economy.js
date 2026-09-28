// Core economy + simulation (pure; no DOM, no Phaser). Time is passed in explicitly.
import { CFG, STAFF, DESK, STAGES, UPGRADES, SAVE_VERSION, PROMOTE, PROMOTE_DISCOUNT } from './config.js';
import { canPlace, occupancy } from './grid.js';
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
    tutorial: { step: 0, done: false },
    flags: { firstOfferGiven: false, cloudAsked: false },
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
export function staffRate(state, s) { const t = STAFF[s.type]; const m = speedMult(state); return { kod: t.kod * m, tasarim: t.tasarim * m }; }
export function teamRate(state) {
  let kod = 0, tasarim = 0; const m = speedMult(state);
  for (const s of state.staff) { const t = STAFF[s.type]; kod += t.kod * m; tasarim += t.tasarim * m; }
  return { kod, tasarim };
}
export function projectRate(state, p) {
  let kod = 0, tasarim = 0; const m = speedMult(state);
  for (const s of state.staff) if (s.projectId === p.id) { const t = STAFF[s.type]; kod += t.kod * m; tasarim += t.tasarim * m; }
  return { kod, tasarim };
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
  const r = teamRate(state), st = STAGES[state.stage];
  return 60 * (r.kod + r.tasarim * CFG.tasarimPremium) * CFG.payPerUnit * st.mult;
}

// ---------------------------------------------------------------- costs
export function countType(state, type) { return state.staff.filter((s) => s.type === type).length; }
export function staffCost(state, type) { return Math.round(STAFF[type].cost * Math.pow(CFG.staffCostGrowth, countType(state, type))); }
export function deskCost(state) { return Math.round(DESK.base * Math.pow(CFG.deskCostGrowth, Math.max(0, state.desks.length - 1))); }
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
  const i = state.projects.indexOf(p);
  if (i >= 0) state.projects.splice(i, 1);
  for (const s of state.staff) if (s.projectId === p.id) s.projectId = null;
  state.money += p.pay; state.totalEarned += p.pay; state.projectsDone += 1;
  if (out) { out.delivered.push({ id: p.id, key: p.key, pay: p.pay }); out.earned += p.pay; }
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
