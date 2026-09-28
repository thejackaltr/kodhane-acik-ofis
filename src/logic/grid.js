// Grid, isometric math and placement rules (pure).
import { GRID, STAGES } from './config.js';
import MOBILYA from '../data/mobilya.json' with { type: 'json' };

export const TILE_W = 64, TILE_H = 32; // in-game px (source art is 2x)

export function tileToWorld(gx, gy) { return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) }; }
export function worldToTile(x, y) {
  const a = x / (TILE_W / 2), b = y / (TILE_H / 2);
  return { gx: Math.round((a + b) / 2) + 0, gy: Math.round((b - a) / 2) + 0 };
}
// depth by pivot y, x as tie-breaker (|x| stays < 1000 so the tie-breaker never crosses a row)
export function depthOf(x, y) { return y + x * 0.0001; }

export function furniture(kind) { return MOBILYA[kind] || { boyut: [1, 1], pivotKaro: [0, 0], pivotPx: [64, 32] }; }

// tiles covered by a piece of furniture placed with its base tile at (gx,gy)
export function footprint(kind, gx, gy) {
  const f = furniture(kind), out = [];
  for (let i = 0; i < f.boyut[0]; i++) for (let j = 0; j < f.boyut[1]; j++) out.push([gx + i, gy + j]);
  return out;
}
export function reserved(kind, gx, gy) { return (furniture(kind).ayrilmis || []).map(([i, j]) => [gx + i, gy + j]); }
export function seatTile(kind, gx, gy) { const k = furniture(kind).koltuk; return k ? [gx + k[0], gy + k[1]] : null; }

export function stageArea(stage) { const a = (STAGES[stage] || STAGES[0]).area; return { w: Math.min(a[0], GRID.w), h: Math.min(a[1], GRID.h) }; }
export function inArea(stage, gx, gy) { const a = stageArea(stage); return gx >= 0 && gy >= 0 && gx < a.w && gy < a.h; }

// occupancy map "gx,gy" -> what
export function occupancy(state) {
  const occ = new Map(), st = STAGES[state.stage] || STAGES[0];
  const mark = (tiles, what) => tiles.forEach(([x, y]) => occ.set(x + ',' + y, what));
  for (const d of st.decor) mark(footprint(d.kind, d.gx, d.gy), 'decor');
  if (st.door) { mark([[st.door.gx, st.door.gy], [st.door.gx + 1, st.door.gy]], 'door'); }
  for (const d of state.desks) { mark(footprint(d.kind, d.gx, d.gy), 'desk:' + d.id); mark(reserved(d.kind, d.gx, d.gy), 'seat:' + d.id); }
  for (const it of state.items || []) mark([[it.gx, it.gy]], 'item:' + it.id);
  return occ;
}
// every tile a desk uses (desk + chair row) — a desk gets an area bonus when any of these tiles glows
export function deskTiles(d) { return footprint(d.kind, d.gx, d.gy).concat(reserved(d.kind, d.gx, d.gy)); }
// tiles within Chebyshev distance r of (gx,gy), clipped to the stage area
export function areaTiles(stage, gx, gy, r) {
  const out = [];
  for (let x = gx - r; x <= gx + r; x++) for (let y = gy - r; y <= gy + r; y++) if (inArea(stage, x, y)) out.push([x, y]);
  return out;
}
// ring of tiles around a set of tiles (distance 1), without the tiles themselves
export function ringTiles(stage, tiles) {
  const own = new Set(tiles.map(([x, y]) => x + ',' + y)), seen = new Set(), out = [];
  for (const [tx, ty] of tiles) for (let x = tx - 1; x <= tx + 1; x++) for (let y = ty - 1; y <= ty + 1; y++) {
    const k = x + ',' + y;
    if (own.has(k) || seen.has(k) || !inArea(stage, x, y)) continue;
    seen.add(k); out.push([x, y]);
  }
  return out;
}
export function chebDist(tilesA, tilesB) {
  let best = Infinity;
  for (const [ax, ay] of tilesA) for (const [bx, by] of tilesB) best = Math.min(best, Math.max(Math.abs(ax - bx), Math.abs(ay - by)));
  return best;
}

export function canPlace(state, kind, gx, gy, occ) {
  occ = occ || occupancy(state);
  const tiles = footprint(kind, gx, gy).concat(reserved(kind, gx, gy));
  for (const [x, y] of tiles) {
    if (!inArea(state.stage, x, y)) return false;
    if (occ.has(x + ',' + y)) return false;
  }
  return true;
}
export function validSpots(state, kind) {
  const occ = occupancy(state), a = stageArea(state.stage), out = [];
  for (let gx = 0; gx < a.w; gx++) for (let gy = 0; gy < a.h; gy++) if (canPlace(state, kind, gx, gy, occ)) out.push([gx, gy]);
  return out;
}
