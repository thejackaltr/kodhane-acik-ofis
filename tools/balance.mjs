// Pacing check (v2): a greedy ACTIVE player (1 laptop tap/s, accepts offers at once, answers event cards) who buys
// whatever adds the most income per TL (hires, promotions, upgrades, area items; desks/items placed on the best tile)
// and moves as soon as the room is full and the move is affordable.
// Usage: node tools/balance.mjs [minutes] [--quiet] [--json] [--naive] [--dump=file.json]
// --dump writes the serialized save every 5 min ({ name, elapsedMs, save }) for the server plausibility e2e.
import * as E from '../src/logic/economy.js';
import * as G from '../src/logic/grid.js';
import * as EV from '../src/logic/events.js';
import { serialize } from '../src/logic/save.js';
import { writeFileSync } from 'node:fs';
import { STAFF, STAFF_ORDER, UPGRADE_ORDER, UPGRADES, STAGES, ITEMS, ITEM_ORDER, PROMOTE } from '../src/logic/config.js';

const args = process.argv.slice(2);
const mins = +args.find((a) => /^\d+$/.test(a)) || 90;
const quiet = args.includes('--quiet'), asJson = args.includes('--json');
// --naive: the v1 pacing player (hires the most expensive affordable type at the first free tile, never promotes;
// v2 items are bought once they cost <= half the cash, on the tile that covers the most staffed desks)
const naive = args.includes('--naive');
const dumpFile = (args.find((a) => a.startsWith('--dump=')) || '').slice(7);
const dumps = [];
const s = E.newState(0, 3); E.giveFirstOffer(s); s.tutorial = { step: 4, done: true };
const fmtT = (t) => String(Math.floor(t / 60)).padStart(3) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const log = (t, m) => { if (!quiet && !asJson) console.log(fmtT(t), m); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const milestones = {};
const mark = (k, t) => { if (!(k in milestones)) milestones[k] = t; };
let lastBuy = 0;

// cheap spot scores: desk speed bonus there (items / PM ring); for a PM, the staffed desks it would touch
function bestDeskSpot(st, type) {
  const kind = E.deskKindForStage(st.stage), spots = G.validSpots(st, kind);
  if (!spots.length) return null;
  const glow = E.glowTiles(st);
  const staffed = st.desks.filter((d) => st.staff.some((x) => x.deskId === d.id && x.type !== 'pm'));
  let best = null, bestV = -Infinity;
  for (const [gx, gy] of spots) {
    const tiles = G.deskTiles({ kind, gx, gy });
    let v;
    if (STAFF[type].adjSpeed) v = staffed.filter((d) => G.chebDist(tiles, G.deskTiles(d)) <= 1).length;
    else v = tiles.filter(([x, y]) => glow.has(x + ',' + y)).length > 0 ? 1 : 0;
    v -= 0.001 * (gx + gy); // keep the room compact
    if (v > bestV) { bestV = v; best = { kind, gx, gy }; }
  }
  return best;
}
function bestItemSpot(st, type) {
  const def = ITEMS[type]; let best = null, bestV = 0;
  const staffDesks = st.desks.filter((d) => st.staff.some((x) => x.deskId === d.id));
  const have = st.items.filter((i) => i.type === type);
  for (const [gx, gy] of G.validSpots(st, def.kind)) {
    let v = 0;
    for (const d of staffDesks) {
      const tiles = G.deskTiles(d);
      if (G.chebDist(tiles, [[gx, gy]]) > def.radius) continue;
      if (have.some((i) => G.chebDist(tiles, [[i.gx, i.gy]]) <= def.radius)) continue;
      v += 1;
    }
    if (v > bestV) { bestV = v; best = { gx, gy }; }
  }
  return best;
}
function candidates(st) {
  const base = E.incomePerMin(st), out = [];
  const add = (label, cost, apply) => { const c = clone(st); c.money = 1e15; if (!apply(c)) return; const gain = E.incomePerMin(c) - base; if (gain > 0) out.push({ label, cost, gain, apply }); };
  for (const type of STAFF_ORDER) {
    if (!E.isUnlocked(st, type)) continue;
    const spot = E.freeDesk(st) ? null : bestDeskSpot(st, type);
    if (!E.freeDesk(st) && !spot) continue;
    const cost = E.staffCost(st, type) + (E.freeDesk(st) ? 0 : E.deskCost(st));
    add('hire ' + type, cost, (c) => E.hire(c, type, spot || undefined).ok);
  }
  let bestPro = null;
  for (const x of st.staff) { const tg = E.promoteTarget(st, x.id); if (tg && (!bestPro || tg.cost < bestPro.cost)) bestPro = { id: x.id, ...tg }; }
  if (bestPro) add('promote -> ' + bestPro.to, bestPro.cost, (c) => E.promote(c, bestPro.id).ok);
  for (const u of UPGRADE_ORDER) {
    if (st.upgrades.includes(u) || (UPGRADES[u].unlockStage && st.stage < UPGRADES[u].unlockStage)) continue;
    if (UPGRADES[u].autoAccept) { out.push({ label: 'upgrade ' + u, cost: UPGRADES[u].cost, gain: 1e9, apply: (c) => E.buyUpgrade(c, u).ok }); continue; }
    add('upgrade ' + u, UPGRADES[u].cost, (c) => E.buyUpgrade(c, u).ok);
  }
  for (const type of ITEM_ORDER) {
    if (!E.itemAvailable(st, type)) continue;
    const spot = bestItemSpot(st, type); if (!spot) continue;
    add('item ' + type + ' @' + spot.gx + ',' + spot.gy, E.itemCost(st, type), (c) => E.buyItem(c, type, spot.gx, spot.gy).ok);
  }
  return out.sort((a, b) => b.gain / b.cost - a.gain / a.cost);
}
function nothingLeft(st) {
  if (STAGES[st.stage + 1]) return false;
  const kind = E.deskKindForStage(st.stage);
  const roomFull = !E.freeDesk(st) && !G.validSpots(st, kind).length;
  const itemsDone = ITEM_ORDER.every((t) => !E.itemAvailable(st, t) || !G.validSpots(st, ITEMS[t].kind).length);
  const upgradesDone = UPGRADE_ORDER.every((u) => st.upgrades.includes(u));
  return roomFull && itemsDone && upgradesDone;
}
const timeline = [];
for (let t = 0; t < mins * 60; t++) {
  E.tapLaptop(s);
  while (s.offers.length && s.projects.length < E.maxActiveProjects(s)) E.acceptOffer(s, s.offers.reduce((a, b) => (b.pay > a.pay ? b : a)).id);
  s.playSec += 1;
  E.advance(s, 1);
  if (EV.shouldTrigger(s)) { EV.trigger(s); EV.applyChoice(s, 'a'); }
  const nx = STAGES[s.stage + 1];
  if (nx && E.canMove(s)) mark('unlock_' + nx.id, t);
  if (nx && E.canMove(s) && s.money >= nx.moveCost && !E.freeDesk(s) && !G.validSpots(s, E.deskKindForStage(s.stage)).length) {
    E.moveOffice(s); log(t, 'MOVE -> ' + STAGES[s.stage].id); mark('move_' + STAGES[s.stage].id, t); lastBuy = t;
  }
  if (naive) {
    for (const u of UPGRADE_ORDER) if (!s.upgrades.includes(u) && s.money >= UPGRADES[u].cost * 1.5 && E.buyUpgrade(s, u).ok) { log(t, 'upgrade ' + u); lastBuy = t; }
    for (const type of ITEM_ORDER) {
      if (!E.itemAvailable(s, type) || E.itemCost(s, type) > s.money * 0.5) continue;
      const spot = bestItemSpot(s, type);
      if (spot && E.buyItem(s, type, spot.gx, spot.gy).ok) { log(t, 'item ' + type); mark('first_item_' + type, t); lastBuy = t; }
    }
    const types = STAFF_ORDER.filter((k) => E.isUnlocked(s, k));
    const best = types.map((k) => ({ k, c: E.staffCost(s, k) })).sort((a, b) => b.c - a.c).find((x) => x.c <= s.money * 0.8);
    if (best) {
      const kind = E.deskKindForStage(s.stage);
      const spot = G.validSpots(s, kind)[0];
      const r = E.hire(s, best.k, E.freeDesk(s) ? undefined : spot && { kind, gx: spot[0], gy: spot[1] });
      if (r.ok) { log(t, 'hire ' + best.k + ' (' + r.cost + ') staff=' + s.staff.length); mark('first_' + best.k, t); lastBuy = t; }
    }
  } else if (t % 2 === 0) {
    for (let k = 0; k < 3; k++) {
      const c = candidates(s)[0];
      if (!c || c.cost > s.money) break;
      if (c.apply(s)) {
        lastBuy = t; log(t, c.label + ' (' + Math.round(c.cost) + ') staff=' + s.staff.length + ' /min ' + Math.round(E.incomePerMin(s)));
        const kind = c.label.split(' ')[0];
        if (kind === 'hire') mark('first_' + c.label.split(' ')[1], t);
        if (kind === 'item') mark('first_item_' + c.label.split(' ')[1], t);
      }
    }
  }
  const kind = E.deskKindForStage(s.stage);
  if (!STAGES[s.stage + 1] && !E.freeDesk(s) && !G.validSpots(s, kind).length) mark('room_full_final', t);
  if (nothingLeft(s)) { mark('content_end', t); }
  if (t % 300 === 299) timeline.push({ min: (t + 1) / 60, stage: STAGES[s.stage].id, staff: s.staff.length, items: s.items.length, earned: Math.round(s.totalEarned), perMin: Math.round(E.incomePerMin(s)) });
  if (dumpFile && t % 300 === 299) dumps.push({ name: (naive ? 'naive' : 'smart') + '-' + (t + 1) / 60 + 'dk', elapsedMs: (t + 1) * 1000, save: JSON.parse(serialize(s, (t + 1) * 1000)) });
  if (t % 600 === 599) log(t, '— ' + STAGES[s.stage].id + ' staff ' + s.staff.length + ' items ' + s.items.length + ' money ' + Math.round(s.money) + ' earned ' + Math.round(s.totalEarned) + ' /min ' + Math.round(E.incomePerMin(s)) + ' done ' + s.projectsDone);
  if ('content_end' in milestones && t > milestones.content_end + 60) break;
}
const promosLeft = s.staff.filter((x) => PROMOTE[x.type]).length;
const summary = { mode: naive ? 'naive (v1 pacing player)' : 'smart (best income per TL)', milestonesMin: Object.fromEntries(Object.entries(milestones).map(([k, v]) => [k, +(v / 60).toFixed(1)])), lastPurchaseMin: +(lastBuy / 60).toFixed(1),
  final: { stage: STAGES[s.stage].id, staff: s.staff.length, types: Object.fromEntries(Object.keys(STAFF).map((k) => [k, E.countType(s, k)]).filter(([, n]) => n)), items: s.items.map((i) => i.type).join(','), earned: Math.round(s.totalEarned), perMin: Math.round(E.incomePerMin(s)), promotionsLeft: promosLeft } };
if (dumpFile) writeFileSync(dumpFile, JSON.stringify(dumps));
if (asJson) console.log(JSON.stringify({ summary, timeline }, null, 1));
else console.log(JSON.stringify(summary, null, 1));
