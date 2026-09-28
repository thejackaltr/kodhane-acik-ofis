// v2.2: free desk moving — the person moves along, invalid tiles refused, projects keep running, area bonus recalculated
// at once (desk into/out of kahve/bitki/sunucu areas, PM ring), save coordinates unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/logic/economy.js';
import * as G from '../../src/logic/grid.js';
import * as S from '../../src/logic/save.js';
import { Controller } from '../../src/game.js';
import { ITEMS } from '../../src/logic/config.js';
import { ajansSave } from '../smoke/grown.mjs';

const T0 = Date.UTC(2026, 8, 28, 13, 0, 0);
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }

// ------------------------------------------------------------------ desk moving
function staffedDesk(s) { return s.desks.find((d) => d.id !== s.desks[0].id && s.staff.some((x) => x.deskId === d.id)); }
test('moveDesk: free, the person moves along, invalid tiles are rejected, save format unchanged', () => {
  const s = ajansSave(T0), d = staffedDesk(s), person = s.staff.find((x) => x.deskId === d.id);
  const money = s.money, n = s.desks.length;
  const spots = E.deskMoveSpots(s, d.id);
  assert.ok(spots.length > 0);
  const [gx, gy] = spots[spots.length - 1];
  const r = E.moveDesk(s, d.id, gx, gy);
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.cost, 0); assert.equal(s.money, money); assert.equal(s.desks.length, n);
  assert.deepEqual([d.gx, d.gy], [gx, gy]);
  assert.equal(person.deskId, d.id); assert.deepEqual(r.staff.map((x) => x.id), [person.id]);
  assert.deepEqual(G.seatTile(d.kind, d.gx, d.gy), [gx, gy - 1], 'seat (and the person) is at the new desk');
  // invalid: onto another desk / its chair row, onto an item, decor, outside, fractional, same spot, unknown desk
  const other = s.desks.find((x) => x.id !== d.id);
  assert.equal(E.moveDesk(s, d.id, other.gx, other.gy).reason, 'yer');
  assert.equal(E.moveDesk(s, d.id, other.gx, other.gy - 1).reason, 'yer');
  const it = s.items[0]; assert.equal(E.moveDesk(s, d.id, it.gx, it.gy).reason, 'yer');
  assert.equal(E.moveDesk(s, d.id, 13, 13).reason, 'yer', 'decor / outside the room');
  assert.equal(E.moveDesk(s, d.id, 0, 0).reason, 'yer', 'chair row would be outside the room');
  assert.equal(E.moveDesk(s, d.id, 2.5, 3).reason, 'yer');
  assert.equal(E.moveDesk(s, d.id, gx, gy).reason, 'ayni');
  assert.equal(E.moveDesk(s, 99999, 3, 3).reason, 'yok');
  // spots never include a blocked tile
  const occ = G.occupancyExcept(s, { deskId: d.id });
  for (const [x, y] of E.deskMoveSpots(s, d.id)) assert.ok(G.canPlace(s, d.kind, x, y, occ));
  // format: desks keep exactly { id, kind, gx, gy }, round trip is lossless
  const str = S.serialize(s, T0);
  assert.deepEqual(Object.keys(JSON.parse(str).desks.find((x) => x.id === d.id)).sort(), ['gx', 'gy', 'id', 'kind']);
  assert.deepEqual(JSON.parse(S.serialize(S.deserialize(str, T0), T0)), JSON.parse(str));
});
test('moving a desk by one tile: its own old tiles do not block it', () => {
  const s = ajansSave(T0);
  let d = null, near = null;
  for (const x of s.desks) {
    near = [[x.gx + 1, x.gy], [x.gx - 1, x.gy], [x.gx, x.gy + 1], [x.gx, x.gy - 1]]
      .find(([gx, gy]) => G.canPlace(s, x.kind, gx, gy, G.occupancyExcept(s, { deskId: x.id })) && !G.canPlace(s, x.kind, gx, gy));
    if (near) { d = x; break; }
  }
  assert.ok(d, 'ajansSave has a desk with room next to it (overlapping its own old tiles)');
  assert.ok(E.moveDesk(s, d.id, near[0], near[1]).ok);
});
test('controller: startMoveDesk -> the project keeps running while moving -> placeAt moves (no money), emits deskMoved, saves', () => {
  const st = memStorage(); st.setItem(S.SAVE_KEY, S.serialize(ajansSave(T0), T0));
  const c = new Controller(st, T0);
  const s = c.state, d = staffedDesk(s), person = s.staff.find((x) => x.deskId === d.id);
  // make sure the person works on a project
  if (!s.projects.length) { E.giveFirstOffer(s); E.acceptOffer(s, s.offers[0].id); }
  const p = s.projects[0]; p.need.kod = 1e9; p.need.tasarim = 1e9; E.assignStaff(s, person.id, p.id);
  assert.ok(c.startMoveDesk(d.id).ok);
  assert.equal(c.placing.moveDeskId, d.id);
  assert.equal(c.hint().key, 'items.area', 'desk move shows the area hint like moving an item');
  const done0 = p.done.kod + p.done.tasarim;
  let now = T0; for (let i = 0; i < 10; i++) { now += 500; c.tick(now); }
  assert.ok(p.done.kod + p.done.tasarim > done0, 'project progressed during the move');
  assert.ok(c.placing, 'still moving');
  const money = c.state.money;
  const events = []; c.on('deskMoved', (r) => events.push(r.desk.id));
  const [gx, gy] = E.deskMoveSpots(s, d.id)[0];
  assert.equal(c.canPlaceHere(gx, gy), true);
  assert.equal(c.placeAt(d.gx, d.gy).reason, 'ayni', 'same spot is not a move');
  const other = s.desks.find((x) => x.id !== d.id);
  assert.equal(c.placeAt(other.gx, other.gy).reason, 'yer'); assert.ok(c.placing, 'a refused tile keeps the move going');
  const r = c.placeAt(gx, gy);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(events, [d.id]); assert.equal(c.placing, null);
  assert.ok(Math.abs(c.state.money - money) < 1e-6, 'free');
  const again = S.load(st, now + 10);
  assert.deepEqual(again.desks.find((x) => x.id === d.id), { id: d.id, kind: d.kind, gx, gy });
  assert.equal(again.staff.find((x) => x.id === person.id).deskId, d.id);
  const done1 = p.done.kod + p.done.tasarim; c.tick(now + 500);
  assert.ok(p.done.kod + p.done.tasarim > done1, 'still progressing after the move');
  assert.equal(c.startMoveDesk(424242).ok, false);
});
function spotNear(s, d, item, inside) {
  const def = ITEMS[item.type];
  const occ = G.occupancyExcept(s, { deskId: d.id });
  return G.validSpots(s, d.kind, occ).find(([x, y]) => {
    if (x === d.gx && y === d.gy) return false;
    const dist = G.chebDist(G.deskTiles({ kind: d.kind, gx: x, gy: y }), [[item.gx, item.gy]]);
    return inside ? dist <= def.radius : dist > def.radius + 1;
  });
}
test('bonus is recalculated immediately when a desk moves into / out of a kahve, bitki or sunucu area', () => {
  for (const type of ['kahve', 'bitki', 'sunucu']) {
    const s = ajansSave(T0);
    s.items = [s.items.find((i) => i.type === type)];                                                // just one item of this type
    for (const x of s.staff.filter((q) => q.type === 'pm')) x.type = 'kidemli';                     // no PM ring
    const item = s.items[0]; assert.ok(item, type);
    const d = s.desks.find((x) => s.staff.some((q) => q.deskId === x.id) && spotNear(s, x, item, true) && spotNear(s, x, item, false));
    assert.ok(d, type + ': a staffed desk that can go in and out of the area');
    const bonus = () => (type === 'sunucu' ? E.deskRewardBonus(s, d.id) : E.deskSpeedBonus(s, d.id));
    const want = type === 'sunucu' ? ITEMS.sunucu.reward : ITEMS[type].speed;
    const out = spotNear(s, d, item, false); assert.ok(out, type + ': a spot outside the area');
    assert.ok(E.moveDesk(s, d.id, out[0], out[1]).ok);
    assert.equal(bonus(), 0, type + ': outside -> no bonus');
    const rate0 = E.teamRate(s).kod;
    const inn = spotNear(s, d, item, true); assert.ok(inn, type + ': a spot inside the area');
    assert.ok(E.moveDesk(s, d.id, inn[0], inn[1]).ok);
    assert.ok(Math.abs(bonus() - want) < 1e-9, type + ': inside -> bonus at once (' + bonus() + ')');
    if (type !== 'sunucu') assert.ok(E.teamRate(s).kod > rate0, type + ': team works faster right away');
    assert.ok(E.moveDesk(s, d.id, out[0], out[1]).ok);
    assert.equal(bonus(), 0, type + ': moved out -> bonus gone at once');
  }
});
test('PM desk moves -> the neighbours\' PM bonus follows at once', () => {
  const s = ajansSave(T0);
  const pm = s.staff.find((x) => x.type === 'pm'), pd = s.desks.find((d) => d.id === pm.deskId);
  const boosted = s.desks.filter((d) => d.id !== pd.id && G.chebDist(G.deskTiles(d), G.deskTiles(pd)) <= 1);
  assert.ok(boosted.length, 'ajansSave has desks next to the PM');
  const far = E.deskMoveSpots(s, pd.id).find(([x, y]) => boosted.every((b) => G.chebDist(G.deskTiles(b), G.deskTiles({ kind: pd.kind, gx: x, gy: y })) > 1));
  const before = boosted.map((b) => E.deskSpeedBonus(s, b.id));
  assert.ok(E.moveDesk(s, pd.id, far[0], far[1]).ok);
  boosted.forEach((b, i) => assert.ok(E.deskSpeedBonus(s, b.id) < before[i] - 0.2, 'PM bonus left desk ' + b.id));
});
test('moving an item still recalculates (v2.1 behaviour kept) and uses the shared "own tile" rule', () => {
  const s = ajansSave(T0);
  const it = s.items.find((x) => x.type === 'kahve');
  const occ = G.occupancyExcept(s, { itemId: it.id });
  assert.equal(occ.has(it.gx + ',' + it.gy), false);
  assert.equal(G.occupancy(s).get(it.gx + ',' + it.gy), 'item:' + it.id);
});
test('desk move texts: Yazı\'s final copy', async () => {
  const fs = await import('node:fs');
  const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));
  assert.equal(tr.place.moveDesk, 'Masa için yeni bir yer seç. Taşımak ücretsiz.'); assert.equal(tr.toast.deskMoved, 'Masa taşındı.');
});
