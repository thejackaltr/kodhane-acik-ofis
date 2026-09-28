// v2.1: free item moving (no selling/refund), v2 save compatibility, promo save fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../../src/logic/economy.js';
import * as G from '../../src/logic/grid.js';
import * as S from '../../src/logic/save.js';
import { Controller } from '../../src/game.js';
import { ITEMS, STAGES } from '../../src/logic/config.js';
import { ajansSave } from '../smoke/grown.mjs';

const T0 = Date.UTC(2026, 8, 28, 11, 0, 0);
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }

test('moveItem: free, only to a free tile inside the room, bonuses follow the item', () => {
  const s = ajansSave(T0);
  const it = s.items.find((x) => x.type === 'sunucu');
  const money = s.money, earned = s.totalEarned, n = s.items.length;
  // a desk that currently gets the sunucu bonus loses it when the rack moves far away
  const boosted = s.desks.find((d) => E.deskRewardBonus(s, d.id) > 0);
  assert.ok(boosted, 'ajansSave has a desk in the rack area');
  const far = G.validSpots(s, ITEMS.sunucu.kind).find(([x, y]) => G.chebDist(G.deskTiles(boosted), [[x, y]]) > 3);
  const r = E.moveItem(s, it.id, far[0], far[1]);
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.cost, 0);
  assert.equal(s.money, money); assert.equal(s.totalEarned, earned); assert.equal(s.items.length, n);
  assert.deepEqual([it.gx, it.gy], far);
  assert.equal(E.deskRewardBonus(s, boosted.id), 0, 'layout cache sees the new position');
  assert.ok(E.glowTiles(s).get(far[0] + ',' + far[1]) === 'reward');
  assert.equal(E.glowTiles(s, it.id).get(far[0] + ',' + far[1]), undefined, 'glow can leave out the item being moved');
  // invalid targets
  const other = s.items.find((x) => x.id !== it.id);
  assert.equal(E.moveItem(s, it.id, other.gx, other.gy).reason, 'yer', 'not onto another item');
  assert.equal(E.moveItem(s, it.id, s.desks[0].gx, s.desks[0].gy).reason, 'yer', 'not onto a desk');
  assert.equal(E.moveItem(s, it.id, 14, 3).reason, 'yer', 'not outside the room');
  assert.equal(E.moveItem(s, it.id, 1.5, 3).reason, 'yer');
  assert.equal(E.moveItem(s, it.id, far[0], far[1]).reason, 'ayni');
  assert.equal(E.moveItem(s, 99999, 3, 3).reason, 'yok');
  // there is no sell/refund
  assert.equal(E.sellItem, undefined);
});
test('moving back next to the old spot works (own old tile does not block)', () => {
  const s = ajansSave(T0);
  const it = s.items[0], old = [it.gx, it.gy];
  const near = G.areaTiles(s.stage, it.gx, it.gy, 1).find(([x, y]) => (x !== it.gx || y !== it.gy) && E.moveItem(JSON.parse(JSON.stringify(s)), it.id, x, y).ok);
  assert.ok(E.moveItem(s, it.id, near[0], near[1]).ok);
  assert.ok(E.moveItem(s, it.id, old[0], old[1]).ok, 'the freed tile is usable again');
});
test('controller: startMoveItem -> placeAt moves (no money), emits itemMoved, saves; cancel keeps it', () => {
  const st = memStorage(); st.setItem(S.SAVE_KEY, S.serialize(ajansSave(T0), T0));
  const c = new Controller(st, T0);
  const it = c.state.items[1], before = [it.gx, it.gy], money = c.state.money;
  assert.ok(c.startMoveItem(it.id).ok);
  assert.equal(c.placing.moveId, it.id);
  assert.equal(c.hint().key, 'items.area');
  c.cancelPlacing();
  assert.deepEqual([it.gx, it.gy], before);
  const moved = [];
  c.on('itemMoved', (x) => moved.push(x.id));
  c.startMoveItem(it.id);
  const spot = G.validSpots(c.state, ITEMS[it.type].kind)[0];
  const r = c.placeAt(spot[0], spot[1]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(moved, [it.id]); assert.equal(c.placing, null);
  assert.ok(Math.abs(c.state.money - money) < 1e-6);
  const again = S.load(st, T0 + 1000);
  assert.deepEqual(again.items.find((x) => x.id === it.id), { id: it.id, type: it.type, gx: spot[0], gy: spot[1] });
  assert.equal(c.startMoveItem(424242).ok, false);
});
test('v2.0.x saves load unchanged in v2.1 (same save version and fields)', () => {
  const s = ajansSave(T0), str = S.serialize(s, T0);
  const m = S.deserialize(str, T0);
  assert.deepEqual(JSON.parse(S.serialize(m, T0)), JSON.parse(str));
});
test('promo fixture: Butik Stüdyo, full room, Ajans move affordable (one tap before the stage-up)', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/promo-before-ajans.json', import.meta.url), 'utf8'));
  const s = S.migrate(raw, T0);
  assert.equal(s.stage, 1);
  assert.ok(E.canMove(s) && s.money >= STAGES[2].moveCost);
  assert.equal(E.freeDesk(s), null); assert.equal(G.validSpots(s, E.deskKindForStage(1)).length, 0, 'room is full');
  assert.equal(s.tutorial.done, true); assert.equal(s.events.pending, null);
  assert.ok(s.items.length >= 3 && s.staff.some((x) => x.type === 'pm'));
  assert.ok(E.moveOffice(s).ok);
});
