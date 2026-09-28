// Two-choice event cards (effects here; texts in tr.json under events.<id>).
import { CFG, EVENTS, EVENT_ORDER } from './config.js';
import * as R from './rng.js';

export function shouldTrigger(state) {
  if (state.events.pending) return false;
  if (state.tutorial.step < 3) return false;                 // not before the first hire
  return state.playSec >= state.events.nextAt;
}
export function eligible(state) { return EVENT_ORDER.filter((e) => EVENTS[e] && state.stage >= (EVENTS[e].minStage || 0)); }
export function trigger(state) {
  // first card is always the logo one (minute 3–4), then unseen ones (v2 visual cards once in Butik Stüdyo), then random
  const pool = eligible(state);
  const unseen = pool.filter((e) => !state.events.seen.includes(e));
  const id = unseen.length ? unseen[0] : R.pick(state, pool);
  state.events.pending = id;
  return id;
}
// v2: does the card show its "server rack" text variant?
export function hasRack(state) { return (state.items || []).some((x) => x.type === 'sunucu'); }
export function applyChoice(state, choice) {
  const id = state.events.pending;
  if (!id || !EVENTS[id]) return null;
  let eff = EVENTS[id][choice === 'a' ? 'a' : 'b'] || {};
  const res = { id, choice, cash: 0 };
  if (eff.chance) { const win = R.next(state) < eff.chance.p; res.outcome = win ? 'win' : 'lose'; eff = (win ? eff.chance.win : eff.chance.lose) || {}; }
  const p = state.projects[0];
  if (eff.projPay && p) p.pay = Math.round(p.pay * eff.projPay);
  if (eff.projNeed && p) { p.need.kod = Math.round(p.need.kod * eff.projNeed); p.need.tasarim = Math.round(p.need.tasarim * eff.projNeed); }
  if (eff.projProgress && p) {
    p.done.kod = Math.min(p.need.kod, p.done.kod + p.need.kod * eff.projProgress);
    p.done.tasarim = Math.min(p.need.tasarim, p.done.tasarim + p.need.tasarim * eff.projProgress);
  }
  if (eff.cashFromProject) {
    if (!p) res.noProject = true;   // v2.1.1: result text may have an 'rNone' variant (events.viral.rbNone)
    const c = Math.round((p ? p.pay : 20) * eff.cashFromProject);
    state.money += c; state.totalEarned += c; res.cash += c;
  }
  if (eff.cashPct) {
    const c = Math.min(state.money, Math.max(eff.cashMin || 0, Math.round(state.money * eff.cashPct)));
    state.money -= c; res.cash -= c;
  }
  if (eff.buff) {
    const pm = EVENTS[id][choice === 'a' ? 'a' : 'b'].pmHalves && state.staff.some((x) => x.type === 'pm');
    res.buffSec = eff.buff.sec * (pm ? 0.5 : 1);   // shown in result texts as {s}
    state.buffs.push({ mult: eff.buff.mult, until: state.simSec + res.buffSec, src: id });
    if (pm) res.pm = true;
  }
  state.events.seen.push(id);
  state.events.pending = null;
  state.events.nextAt = state.playSec + R.range(state, CFG.eventEverySec[0], CFG.eventEverySec[1]);
  return res;
}
export function dismiss(state) { // "Sonra": card comes back a bit later
  if (!state.events.pending) return;
  state.events.pending = null;
  state.events.nextAt = state.playSec + 60;
}
