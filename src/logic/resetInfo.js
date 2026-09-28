// v2.2: what "Baştan başla" deletes and what stays, derived from the real save (see economy.newState / save.migrate).
// Returns tr.json keys + variables only (no text here). ctx: { signedIn, email, languages }.
import { STAGES } from './config.js';

export function resetLists(state, ctx = {}) {
  const s = state || {}, remove = [], keep = [];
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const len = (a) => (Array.isArray(a) ? a.length : 0);
  const st = STAGES[n(s.stage)] || STAGES[0];
  // stage + desks: the office itself (stage, desks[])
  remove.push({ key: 'reset.del.office', vars: { stage: { t: 'stages.' + st.id }, n: len(s.desks) } });
  remove.push({ key: 'reset.del.money', vars: { v: { tl: n(s.money) } } });
  // staff[] (the founder always stays in a new game, so count the hired people)
  const hired = (s.staff || []).filter((x) => x && x.type !== 'kurucu').length;
  if (hired) remove.push({ key: 'reset.del.staff', vars: { n: hired } });
  if (len(s.items)) remove.push({ key: 'reset.del.items', vars: { n: len(s.items) } });
  if (len(s.upgrades)) remove.push({ key: 'reset.del.upgrades', vars: { n: len(s.upgrades) } });
  if (len(s.projects) || len(s.offers)) remove.push({ key: 'reset.del.projects', vars: { n: len(s.projects), o: len(s.offers) } });
  // projectsDone, catNaps, totalEarned (the numbers shown in the menu)
  remove.push({ key: 'reset.del.stats', vars: { p: n(s.projectsDone), k: n(s.catNaps), v: { tl: n(s.totalEarned) } } });
  // kept: not part of the save
  if (ctx.signedIn) {
    keep.push({ key: 'reset.keep.account', vars: { email: ctx.email || '' } });
    keep.push({ key: 'reset.keep.leaderboard', vars: {} });   // best_score + kodhane_profiles nickname survive the reset RPC
    keep.push({ key: 'reset.keep.backup', vars: {} });        // the reset RPC keeps a server backup for 30 days
  }
  if ((ctx.languages || 1) > 1) keep.push({ key: 'reset.keep.language', vars: {} });
  if (!keep.length) keep.push({ key: 'reset.keep.nothing', vars: {} });
  return { remove, keep };
}
