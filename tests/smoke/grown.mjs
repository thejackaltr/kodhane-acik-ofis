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

// v2: an Ajans office (14x14) with Proje Yöneticileri placed in the middle of desk clusters and area items.
export function ajansSave(now = Date.now()) {
  const s = grownSave(now);
  s.totalEarned = 900000; s.money = 5e6; s.playSec = 3600; s.projectsDone = 90;
  s.events.seen = ['logo', 'cuma', 'yegen', 'cay', 'acil'];
  s.upgrades = ['demlik', 'pano', 'klavye', 'sandalye'];
  s.flags.stagesCounted = [0, 1];
  E.moveOffice(s); s.flags.stagesCounted.push(2);
  const put = (type, gx, gy) => { s.money += 1e7; const r = E.buyItem(s, type, gx, gy); if (!r.ok) throw new Error('item ' + type + ' ' + gx + ',' + gy + ' ' + r.reason); };
  const hireAt = (type, gx, gy) => { s.money += 1e7; const kind = E.deskKindForStage(s.stage); const r = E.hire(s, type, { kind, gx, gy }); if (!r.ok) throw new Error('hire ' + type + ' ' + gx + ',' + gy + ' ' + r.reason); };
  hireAt('pm', 11, 6); hireAt('yzajan', 9, 6); hireAt('yzajan', 11, 8); hireAt('kidemli', 11, 4);
  hireAt('tasarimci', 9, 8); hireAt('yzajan', 7, 11);
  put('kahve', 10, 9); put('bitki', 8, 9); put('sunucu', 13, 5); put('kahve', 3, 9);
  s.flags.pmTip = true;
  s.money = 1250000;
  E.advance(s, 20, { auto: true });
  s.lastTick = now; s.lastSaved = now;
  return s;
}
