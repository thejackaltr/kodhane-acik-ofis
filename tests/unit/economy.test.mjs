import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/logic/economy.js';
import * as G from '../../src/logic/grid.js';
import { CFG, STAGES } from '../../src/logic/config.js';

const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);

test('new state: founder at a desk, no money, first offer is the cafe', () => {
  const s = E.newState(T0, 1);
  assert.equal(s.money, 0);
  assert.equal(s.staff.length, 1);
  assert.equal(s.staff[0].type, 'kurucu');
  const o = E.giveFirstOffer(s);
  assert.equal(o.key, 'kafe');
  assert.equal(E.giveFirstOffer(s), null, 'only once');
});

test('first project: accept, tap laptop until delivered, get paid', () => {
  const s = E.newState(T0, 1);
  const o = E.giveFirstOffer(s);
  assert.ok(E.acceptOffer(s, o.id).ok);
  assert.equal(s.staff[0].projectId, o.id, 'founder auto-assigned');
  let taps = 0, res;
  do { res = E.tapLaptop(s); taps++; } while (!res.delivered.length && taps < 100);
  assert.ok(taps <= 12, 'first project needs few taps, got ' + taps);
  assert.equal(s.money, CFG.firstOffer.pay);
  assert.equal(s.projectsDone, 1);
  assert.equal(s.staff[0].projectId, null);
});

test('founder alone finishes the first project in < 30 s without taps', () => {
  const s = E.newState(T0, 1);
  E.acceptOffer(s, E.giveFirstOffer(s).id);
  const r = E.advance(s, 30);
  assert.equal(r.delivered.length, 1);
});

test('hire needs a desk; hire with desk placement pays both', () => {
  const s = E.newState(T0, 1);
  s.money = 1000;
  assert.equal(E.hire(s, 'stajyer').reason, 'masa');
  const spots = G.validSpots(s, 'masa_tekli_laptop_01');
  assert.ok(spots.length >= 3, 'stage 1 has room for several desks: ' + spots.length);
  const [gx, gy] = spots[0];
  const cost = E.staffCost(s, 'stajyer') + E.deskCost(s);
  const r = E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx, gy });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(s.money, 1000 - cost);
  assert.equal(s.desks.length, 2);
  assert.equal(r.staff.deskId, r.desk.id);
  assert.equal(E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx, gy }).reason, 'yer', 'same spot now taken');
});

test('first delivery pays enough for desk + intern', () => {
  const s = E.newState(T0, 1);
  assert.ok(CFG.firstOffer.pay >= E.staffCost(s, 'stajyer') + E.deskCost(s));
});

test('costs grow per owned unit', () => {
  const s = E.newState(T0, 1);
  const c0 = E.staffCost(s, 'stajyer');
  s.staff.push({ id: 99, type: 'stajyer', deskId: 1, projectId: null });
  assert.ok(E.staffCost(s, 'stajyer') > c0);
  const d0 = E.deskCost(s); s.desks.push({ id: 50, kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  assert.ok(E.deskCost(s) > d0);
});

test('not enough money is refused and changes nothing', () => {
  const s = E.newState(T0, 1);
  const before = JSON.stringify(s);
  assert.equal(E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 }).reason, 'para');
  assert.equal(JSON.stringify(s), before);
});

test('offers arrive over time, max 3', () => {
  const s = E.newState(T0, 1);
  E.advance(s, CFG.offerEverySec * 10);
  assert.equal(s.offers.length, CFG.maxOffers);
});

test('advance is deterministic for the same seed', () => {
  const a = E.newState(T0, 42), b = E.newState(T0, 42);
  for (const s of [a, b]) { s.money = 500; E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 }); E.advance(s, 3600, { auto: true }); }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.projectsDone > 10);
});

test('advance in one big step == many small steps (timestamp based, not frames)', () => {
  const a = E.newState(T0, 7), b = E.newState(T0, 7);
  for (const s of [a, b]) { s.money = 500; E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 }); }
  E.advance(a, 600, { auto: true });
  for (let i = 0; i < 600 * 4; i++) E.advance(b, 0.25, { auto: true });
  assert.ok(Math.abs(a.money - b.money) <= Math.max(1, a.money * 0.02), a.money + ' vs ' + b.money);
  assert.equal(a.projectsDone, b.projectsDone);
});

test('without auto-accept the team idles when projects are done (online manual loop)', () => {
  const s = E.newState(T0, 1);
  E.acceptOffer(s, E.giveFirstOffer(s).id);
  E.advance(s, 3600);
  assert.equal(s.projectsDone, 1);
  assert.equal(s.offers.length, 3);
});

test('project board upgrade enables online auto-accept', () => {
  const s = E.newState(T0, 1);
  s.money = 600;
  assert.ok(E.buyUpgrade(s, 'pano').ok);
  E.advance(s, 600);
  assert.ok(s.projectsDone >= 5);
});

test('upgrades multiply speed; buffs expire', () => {
  const s = E.newState(T0, 1);
  const r0 = E.teamRate(s).kod;
  s.money = 1000; E.buyUpgrade(s, 'demlik');
  assert.ok(Math.abs(E.teamRate(s).kod - r0 * 1.1) < 1e-9);
  s.buffs.push({ mult: 2, until: s.simSec + 10 });
  assert.ok(Math.abs(E.teamRate(s).kod - r0 * 2.2) < 1e-9);
  E.advance(s, 11);
  assert.equal(s.buffs.length, 0);
});

test('designer speeds up design-heavy projects', () => {
  const s = E.newState(T0, 3);
  const p = { id: 500, key: 'kafe', need: { kod: 10, tasarim: 100 }, done: { kod: 0, tasarim: 0 }, pay: 100 };
  s.projects.push(p); s.staff[0].projectId = 500;
  const slow = E.projectRemainingSec(s, p);
  s.desks.push({ id: 60, kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  s.staff.push({ id: 61, type: 'tasarimci', deskId: 60, projectId: 500 });
  assert.ok(E.projectRemainingSec(s, p) < slow / 5);
});

test('moving office needs lifetime earnings and money, grows the area', () => {
  const s = E.newState(T0, 1);
  assert.equal(E.moveOffice(s).reason, 'kilitli');
  s.totalEarned = STAGES[1].unlockEarned; s.money = STAGES[1].moveCost;
  const a0 = G.validSpots(s, 'masa_tekli_monitor_01').length;
  assert.ok(E.moveOffice(s).ok);
  assert.equal(s.stage, 1); assert.equal(s.money, 0);
  assert.ok(G.validSpots(s, 'masa_tekli_monitor_01').length > a0 * 2);
});

test('AI agent is a later unlock (stage 2 + earnings)', () => {
  const s = E.newState(T0, 1);
  s.totalEarned = 1e9;
  assert.equal(E.isUnlocked(s, 'yzajan'), false);
  s.stage = 1;
  assert.equal(E.isUnlocked(s, 'yzajan'), true);
});

test('pacing: scripted new player hires first intern well within 5 minutes', () => {
  const s = E.newState(T0, 11);
  let t = 0; const dt = 0.25; let hiredAt = null;
  E.acceptOffer(s, E.giveFirstOffer(s).id);
  while (t < 300 && hiredAt == null) {
    if (Math.round(t * 4) % 2 === 0) E.tapLaptop(s);   // 2 taps/s
    E.advance(s, dt); t += dt;
    if (s.projectsDone >= 1) {
      const [gx, gy] = G.validSpots(s, 'masa_tekli_laptop_01')[0];
      if (E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx, gy }).ok) hiredAt = t;
    }
  }
  assert.ok(hiredAt != null && hiredAt < 60, 'hired at ' + hiredAt);
});

test('promotion: intern becomes junior at the same desk', () => {
  const s = E.newState(T0, 1);
  s.money = 10000; s.totalEarned = 1000;
  const r = E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  const tgt = E.promoteTarget(s, r.staff.id);
  assert.equal(tgt.to, 'junior');
  const m0 = s.money, desk = r.staff.deskId;
  assert.ok(E.promote(s, r.staff.id).ok);
  assert.equal(r.staff.type, 'junior'); assert.equal(r.staff.deskId, desk); assert.equal(s.money, m0 - tgt.cost);
  assert.equal(E.promoteTarget(s, s.staff[0].id), null, 'founder cannot be promoted');
});
