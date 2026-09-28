// Builds a "grown office" save (Butik Stüdyo, full team) with the real logic modules, for screenshots/tests.
import * as E from '../../src/logic/economy.js';
import * as G from '../../src/logic/grid.js';
export function grownSave(now = Date.now()) {
  const s = E.newState(now - 3 * 3600e3, 77);
  s.totalEarned = 60000; s.money = 250000; s.projectsDone = 48; s.catNaps = 17; s.playSec = 2400;
  s.tutorial = { step: 4, done: true }; s.flags.firstOfferGiven = true; s.flags.cloudAsked = true;
  s.events.seen = ['logo', 'cuma']; s.events.nextAt = 99999;
  s.upgrades = ['demlik', 'pano'];
  E.moveOffice(s);
  const types = ['stajyer', 'junior', 'tasarimci', 'kidemli', 'junior', 'yzajan', 'tasarimci', 'stajyer', 'kidemli', 'junior', 'yzajan', 'stajyer', 'junior', 'tasarimci'];
  for (const type of types) {
    const kind = E.deskKindForStage(s.stage);
    const spot = G.validSpots(s, kind)[0];
    if (!spot) break;
    s.money += 1e6;
    const r = E.hire(s, type, { kind, gx: spot[0], gy: spot[1] });
    if (!r.ok) throw new Error('hire failed ' + JSON.stringify(r));
  }
  s.money = 184250;
  E.advance(s, 30, { auto: true });
  s.lastTick = now; s.lastSaved = now;
  return s;
}
