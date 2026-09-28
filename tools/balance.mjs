// Rough pacing check: greedy active player (1 tap/s, accepts offers, buys cheapest useful thing).
// Usage: node tools/balance.mjs [minutes]
import * as E from '../src/logic/economy.js';
import * as G from '../src/logic/grid.js';
import { STAFF_ORDER, UPGRADE_ORDER, UPGRADES, STAGES } from '../src/logic/config.js';
const mins = +process.argv[2] || 60;
const s = E.newState(0, 3); E.giveFirstOffer(s);
const log = (t, m) => console.log(String(Math.floor(t / 60)).padStart(3) + ':' + String(Math.floor(t % 60)).padStart(2, '0'), m);
for (let t = 0; t < mins * 60; t++) {
  E.tapLaptop(s);
  while (s.offers.length && s.projects.length < E.maxActiveProjects(s)) E.acceptOffer(s, s.offers[0].id);
  E.advance(s, 1);
  if (E.canMove(s) && s.money >= STAGES[s.stage + 1].moveCost && !G.validSpots(s, E.deskKindForStage(s.stage)).length) { E.moveOffice(s); log(t, 'MOVE stage ' + s.stage); }
  for (const u of UPGRADE_ORDER) if (!s.upgrades.includes(u) && s.money >= UPGRADES[u].cost * 1.5 && E.buyUpgrade(s, u).ok) log(t, 'upgrade ' + u);
  const types = STAFF_ORDER.filter((k) => E.isUnlocked(s, k));
  const best = types.map((k) => ({ k, c: E.staffCost(s, k) })).sort((a, b) => b.c - a.c).find((x) => x.c <= s.money * 0.8);
  if (best) {
    const kind = E.deskKindForStage(s.stage);
    const spot = G.validSpots(s, kind)[0];
    const r = E.hire(s, best.k, E.freeDesk(s) ? undefined : spot && { kind, gx: spot[0], gy: spot[1] });
    if (r.ok) log(t, 'hire ' + best.k + ' (' + r.cost + ') staff=' + s.staff.length);
  }
  if (t % 600 === 599) log(t, 'money ' + Math.round(s.money) + ' earned ' + Math.round(s.totalEarned) + ' /min ' + Math.round(E.incomePerMin(s)) + ' done ' + s.projectsDone);
}
