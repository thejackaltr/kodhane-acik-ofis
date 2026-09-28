import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../src/logic/grid.js';
import * as E from '../../src/logic/economy.js';

test('iso math: tile <-> world round trip, 2:1 with 64x32 tiles', () => {
  for (let gx = -3; gx < 12; gx++) for (let gy = -3; gy < 12; gy++) {
    const w = G.tileToWorld(gx, gy);
    assert.deepEqual(G.worldToTile(w.x + 5, w.y - 3), { gx, gy });
  }
  const a = G.tileToWorld(1, 0), b = G.tileToWorld(0, 0);
  assert.equal(a.x - b.x, 32); assert.equal(a.y - b.y, 16);
});

test('depth: lower on screen draws later; x breaks ties without crossing rows', () => {
  assert.ok(G.depthOf(0, 16) > G.depthOf(0, 0));
  assert.ok(G.depthOf(10, 0) > G.depthOf(-10, 0));
  assert.ok(G.depthOf(-400, 16) > G.depthOf(400, 15));
});

test('furniture metadata: desk is 2x1 with a reserved seat row behind', () => {
  const f = G.furniture('masa_tekli_laptop_01');
  assert.deepEqual(f.boyut, [2, 1]);
  assert.deepEqual(f.pivotKaro, [0, 0]);
  assert.equal(f.pivotPx.length, 2);
  assert.deepEqual(G.seatTile('masa_tekli_laptop_01', 3, 3), [3, 2]);
  assert.equal(G.footprint('masa_tekli_laptop_01', 3, 3).length, 2);
});

test('placement: no overlap, inside stage area, door kept free', () => {
  const s = E.newState(0, 1);
  const fd = s.desks[0];
  assert.equal(G.canPlace(s, 'masa_tekli_laptop_01', fd.gx, fd.gy), false, 'on founder desk');
  assert.equal(G.canPlace(s, 'masa_tekli_laptop_01', 5, 3), false, 'sticks out of the 6x6 flat');
  assert.equal(G.canPlace(s, 'masa_tekli_laptop_01', 0, 4), false, 'door');
  const spots = G.validSpots(s, 'masa_tekli_laptop_01');
  for (const [gx, gy] of spots) {
    for (const [x, y] of G.footprint('masa_tekli_laptop_01', gx, gy)) assert.ok(G.inArea(0, x, y));
  }
});
