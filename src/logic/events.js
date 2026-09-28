// Two-choice event cards (effects here; texts in tr.json under events.<id>).
import { CFG, EVENTS, EVENT_ORDER } from './config.js';
import * as R from './rng.js';

export function shouldTrigger(state) {
  if (state.events.pending) return false;
  if (state.tutorial.step < 3) return false;                 // not before the first hire
  return state.playSec >= state.events.nextAt;
}
export function trigger(state) {
  // first card is always the logo one (minute 3–4), then unseen ones, then random
  let id;
  const unseen = EVENT_ORDER.filter((e) => !state.events.seen.includes(e));
  id = unseen.length ? unseen[0] : R.pick(state, EVENT_ORDER);
  state.events.pending = id;
  return id;
}
export function applyChoice(state, choice) {
  const id = state.events.pending;
  if (!id || !EVENTS[id]) return null;
  const eff = EVENTS[id][choice === 'a' ? 'a' : 'b'] || {};
  const res = { id, choice, cash: 0 };
  const p = state.projects[0];
  if (eff.projPay && p) p.pay = Math.round(p.pay * eff.projPay);
  if (eff.projNeed && p) { p.need.kod = Math.round(p.need.kod * eff.projNeed); p.need.tasarim = Math.round(p.need.tasarim * eff.projNeed); }
  if (eff.projProgress && p) {
    p.done.kod = Math.min(p.need.kod, p.done.kod + p.need.kod * eff.projProgress);
    p.done.tasarim = Math.min(p.need.tasarim, p.done.tasarim + p.need.tasarim * eff.projProgress);
  }
  if (eff.cashFromProject) {
    const c = Math.round((p ? p.pay : 20) * eff.cashFromProject);
    state.money += c; state.totalEarned += c; res.cash += c;
  }
  if (eff.cashPct) {
    const c = Math.min(state.money, Math.max(eff.cashMin || 0, Math.round(state.money * eff.cashPct)));
    state.money -= c; res.cash -= c;
  }
  if (eff.buff) state.buffs.push({ mult: eff.buff.mult, until: state.simSec + eff.buff.sec, src: id });
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
