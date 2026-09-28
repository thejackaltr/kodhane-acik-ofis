// v2 (Ajans): lossless v1.0.1 save migration, area items + glow, Proje Yöneticisi, Tasarımcı/sunucu project bonus,
// visual event cards, tutorial.pm, anonymous stage counter, Ajans layout, leaderboard helpers, Yazı's copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../../src/logic/economy.js';
import * as G from '../../src/logic/grid.js';
import * as EV from '../../src/logic/events.js';
import * as TU from '../../src/logic/tutorial.js';
import * as S from '../../src/logic/save.js';
import * as I from '../../src/logic/i18n.js';
import * as LB from '../../src/cloud/leaderboard.js';
import { Controller } from '../../src/game.js';
import { CFG, STAFF, STAGES, ITEMS, ITEM_ORDER, EVENTS, EVENT_ORDER, SAVE_VERSION, STAFF_ORDER } from '../../src/logic/config.js';
import { aoPlausible } from '../../tools/plausible.mjs';

const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);
const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));
const V1 = fs.readFileSync(new URL('../fixtures/v1.0.1-save.json', import.meta.url), 'utf8');
I.registerLocales({ tr }); I.setLocale('tr'); I.setPointerFine(false);
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
const rich = (s) => { s.money = 1e9; s.totalEarned = Math.max(s.totalEarned, 1e9); return s; };
function studio(seed = 5) { const s = E.newState(T0, seed); s.tutorial = { step: 4, done: true }; rich(s); E.moveOffice(s); return s; }
function hireAt(s, type, gx, gy) { s.money += 1e9; const kind = E.deskKindForStage(s.stage); const r = E.hire(s, type, { kind, gx, gy }); assert.ok(r.ok, type + ' ' + gx + ',' + gy + ' ' + r.reason); return r; }

// ------------------------------------------------------------------ save migration
test('v1.0.1 save (made by the v1 code, tests/fixtures) -> v2 is lossless', () => {
  const v1 = JSON.parse(V1);
  assert.equal(v1.v, 1); assert.equal(v1.items, undefined);
  const s = S.deserialize(V1, T0 + 5000);
  assert.equal(s.v, SAVE_VERSION);
  for (const k of Object.keys(v1)) if (k !== 'v' && k !== 'flags') assert.deepEqual(s[k], v1[k], 'field ' + k);
  for (const [k, v] of Object.entries(v1.flags)) assert.deepEqual(s.flags[k], v, 'flag ' + k);
  assert.equal(s.stage, 1); assert.deepEqual(s.items, []);
  assert.equal(s.flags.pmTip, false);
  assert.deepEqual(s.flags.stagesCounted, [0, 1], 'stages reached in v1 are not counted again');
  assert.ok(s.staff.some((x) => x.type === 'tasarimci'), 'Tasarımcı keeps its v1 id');
  assert.equal(S.SAVE_KEY, 'acik_ofis_save_v1', 'same storage key: v1 players keep their office');
  // round trip stays identical and the office still runs
  const again = S.deserialize(S.serialize(s, T0 + 6000), T0 + 6000);
  assert.deepEqual({ ...again, lastSaved: 0 }, { ...s, lastSaved: 0 });
  const before = s.totalEarned; E.advance(s, 120); assert.ok(s.totalEarned > before);
});
test('v1 save loaded through the controller: nothing is counted for stages reached before v2', () => {
  const st = memStorage(); st.setItem(S.SAVE_KEY, V1);
  const c = new Controller(st, T0 + 1000), sent = [];
  c.on('count', (n) => sent.push(n)); c.countStage();
  assert.deepEqual(sent, []);
  assert.equal(c.state.stage, 1); assert.equal(c.state.staff.length, JSON.parse(V1).staff.length);
});
test('save validation: bad items dropped, nextId bumped, unknown staff types dropped, stage clamped', () => {
  const s = studio();
  const raw = JSON.parse(S.serialize(s, T0));
  raw.items = [{ id: 900, type: 'kahve', gx: 3, gy: 3 }, { id: 901, type: 'kahve', gx: 3, gy: 3 }, { id: 900, type: 'bitki', gx: 4, gy: 4 },
    { id: 902, type: 'havuz', gx: 5, gy: 5 }, { id: 903, type: 'bitki', gx: 1.5, gy: 2 }, { id: 904, type: 'bitki', gx: -1, gy: 2 }, null];
  raw.staff.push({ id: 950, type: 'ceo', deskId: raw.desks[0].id, projectId: null });
  raw.stage = 7; raw.flags.stagesCounted = [0, 9, 'x', 1];
  const m = S.migrate(raw, T0);
  assert.deepEqual(m.items, [{ id: 900, type: 'kahve', gx: 3, gy: 3 }]);
  assert.ok(m.nextId > 900);
  assert.ok(!m.staff.some((x) => x.type === 'ceo'));
  assert.equal(m.stage, STAGES.length - 1);
  assert.deepEqual(m.flags.stagesCounted, [0, 1]);
});

// ------------------------------------------------------------------ items + glow
test('items: stage unlocks, cost growth, max count, placement rules', () => {
  const s = E.newState(T0, 2); rich(s);
  assert.equal(E.buyItem(s, 'kahve', 3, 3).reason, 'kilitli', 'no items at home');
  E.moveOffice(s);
  assert.ok(E.itemAvailable(s, 'kahve') && E.itemAvailable(s, 'bitki'));
  assert.equal(E.itemAvailable(s, 'sunucu'), false, 'sunucu needs Ajans');
  const costs = [];
  const spots = [[3, 5], [5, 5], [7, 3], [3, 8], [6, 7]];
  for (let i = 0; i < ITEMS.kahve.max; i++) {
    costs.push(E.itemCost(s, 'kahve'));
    const m0 = s.money, r = E.buyItem(s, 'kahve', ...spots[i]);
    assert.ok(r.ok, JSON.stringify(r)); assert.equal(m0 - s.money, costs[i]);
  }
  assert.deepEqual(costs, [0, 1, 2, 3].map((n) => Math.round(ITEMS.kahve.cost * ITEMS.kahve.growth ** n)));
  assert.equal(E.itemAvailable(s, 'kahve'), false);
  assert.equal(E.buyItem(s, 'kahve', ...spots[4]).reason, 'max');
  assert.equal(E.buyItem(s, 'bitki', ...spots[0]).reason, 'yer', 'one thing per tile');
  assert.equal(E.buyItem(s, 'bitki', 1, 2).reason, 'yer', 'not on the founder desk');
  assert.equal(E.buyItem(s, 'bitki', 12, 12).reason, 'yer', 'not outside the room');
  s.money = 10; assert.equal(E.buyItem(s, 'bitki', 6, 7).reason, 'para');
  assert.ok(!G.canPlace(s, 'masa_tekli_monitor_01', 3, 5), 'desks cannot be put on an item');
});
test('glow: kahve lights radius 1, bitki radius 3, sunucu tiles are reward; desks in the area get the bonus', () => {
  const s = studio(); rich(s);
  E.buyItem(s, 'kahve', 5, 5);
  const g = E.glowTiles(s);
  assert.equal(g.size, 9); assert.equal(g.get('4,4'), 'speed'); assert.ok(!g.has('3,5'));
  E.buyItem(s, 'bitki', 5, 5 + 4);
  assert.equal(E.itemPreviewTiles(s, 'bitki', 5, 5).length, 49);
  assert.equal(E.itemPreviewTiles(s, 'kahve', 0, 0).length, 4, 'clipped to the room');
  const { desk } = hireAt(s, 'junior', 6, 3);
  const inArea = G.deskTiles(desk).some(([x, y]) => g.has(x + ',' + y));
  assert.equal(E.deskSpeedBonus(s, desk.id) > 0, inArea || G.chebDist(G.deskTiles(desk), [[5, 9]]) <= 3);
  // same type does not stack on one desk; different types add up
  const s2 = studio(); rich(s2);
  const r = hireAt(s2, 'junior', 5, 3), tiles = G.deskTiles(r.desk);
  E.buyItem(s2, 'kahve', tiles[0][0] - 1, tiles[0][1]);
  assert.equal(E.deskSpeedBonus(s2, r.desk.id), ITEMS.kahve.speed);
  const free = G.areaTiles(s2.stage, tiles[0][0], tiles[0][1], 1).find(([x, y]) => G.canPlace(s2, ITEMS.kahve.kind, x, y));
  E.buyItem(s2, 'kahve', free[0], free[1]);
  assert.equal(E.deskSpeedBonus(s2, r.desk.id), ITEMS.kahve.speed, 'two kahve = still +15%');
  const far = G.areaTiles(s2.stage, tiles[0][0], tiles[0][1], 3).find(([x, y]) => G.canPlace(s2, ITEMS.bitki.kind, x, y));
  E.buyItem(s2, 'bitki', far[0], far[1]);
  assert.ok(Math.abs(E.deskSpeedBonus(s2, r.desk.id) - (ITEMS.kahve.speed + ITEMS.bitki.speed)) < 1e-9);
  const base = STAFF.junior.kod * E.speedMult(s2);
  assert.ok(Math.abs(E.staffRate(s2, s2.staff.find((x) => x.deskId === r.desk.id)).kod - base * (1 + ITEMS.kahve.speed + ITEMS.bitki.speed)) < 1e-9);
});
test('Proje Yöneticisi: unlock, adjacent desks +25% (not their own), ring glows', () => {
  const s0 = E.newState(T0, 4); rich(s0);
  assert.equal(E.isUnlocked(s0, 'pm'), false, 'not at home');
  const s = studio();
  assert.equal(E.isUnlocked(s, 'pm'), true);
  assert.ok(STAFF_ORDER.indexOf('pm') < STAFF_ORDER.indexOf('yzajan'));
  const a = hireAt(s, 'junior', 5, 3), far = hireAt(s, 'junior', 5, 8);
  const pm = hireAt(s, 'pm', 7, 3);
  assert.ok(G.chebDist(G.deskTiles(a.desk), G.deskTiles(pm.desk)) <= 1);
  assert.equal(E.deskSpeedBonus(s, a.desk.id), STAFF.pm.adjSpeed);
  assert.equal(E.deskSpeedBonus(s, far.desk.id), 0);
  assert.equal(E.deskSpeedBonus(s, pm.desk.id), 0, 'the PM does not boost their own desk');
  const g = E.glowTiles(s);
  for (const [x, y] of G.ringTiles(s.stage, G.deskTiles(pm.desk))) assert.ok(g.has(x + ',' + y));
  const before = E.incomePerMin(s);
  hireAt(s, 'pm', 3, 3);
  assert.ok(E.incomePerMin(s) > before);
});
test('project reward bonus: Tasarımcı +20% (same id as v1), sunucu +25%, both add up, paid on delivery', () => {
  assert.equal(STAFF.tasarimci.projectBonus, 0.2); assert.equal(ITEMS.sunucu.reward, 0.25);
  const s = E.newState(T0, 9); s.tutorial = { step: 4, done: true }; rich(s); E.moveOffice(s); E.moveOffice(s);
  assert.equal(s.stage, 2);
  const t = hireAt(s, 'tasarimci', 5, 3), j = hireAt(s, 'junior', 9, 9);
  E.buyItem(s, 'sunucu', 11, 9);
  assert.ok(E.deskRewardBonus(s, j.desk.id) === 0.25 || G.chebDist(G.deskTiles(j.desk), [[11, 9]]) > 1);
  const give = (who) => {
    s.offers = []; s.projects = []; for (const x of s.staff) x.projectId = null;
    const o = E.makeOffer(s); s.offers.push(o); E.acceptOffer(s, o.id);
    const p = s.projects[0]; for (const x of s.staff) x.projectId = who.includes(x.id) ? p.id : null;
    return p;
  };
  let p = give([t.staff.id]);
  assert.equal(E.projectBonus(s, p), 0.2);
  p = give([s.staff[0].id]); assert.equal(E.projectBonus(s, p), 0);
  const jid = s.staff.find((x) => x.deskId === j.desk.id).id;
  const srvDesk = E.deskRewardBonus(s, j.desk.id);
  p = give([t.staff.id, jid]); assert.ok(Math.abs(E.projectBonus(s, p) - (0.2 + srvDesk)) < 1e-9);
  // delivery pays round(pay * (1 + bonus))
  p.done.kod = p.need.kod; p.done.tasarim = p.need.tasarim;
  const m0 = s.money, pay = p.pay, r = E.advance(s, 0.1);
  const d = r.delivered[0];
  assert.equal(d.base, pay); assert.ok(Math.abs(d.bonus - (0.2 + srvDesk)) < 1e-9);
  assert.equal(d.pay, Math.round(pay * (1 + 0.2 + srvDesk)));
  assert.ok(s.money - m0 >= d.pay);
});

// ------------------------------------------------------------------ events
test('visual event cards: only from Butik Stüdyo on, chance outcome, PM halves the toplantı buff', () => {
  assert.equal(EVENT_ORDER.length, 10);
  for (const id of ['sunucu', 'kedi', 'toplanti', 'final', 'viral']) { assert.ok(EVENTS[id].visual); assert.equal(EVENTS[id].minStage, 1); }
  const home = E.newState(T0, 3); home.tutorial = { step: 4, done: true }; home.events.seen = [...EVENT_ORDER.slice(0, 5)];
  for (let i = 0; i < 40; i++) { const id = EV.trigger(home); assert.ok(!EVENTS[id].minStage, id); EV.applyChoice(home, 'b'); }
  const s = studio(); s.events.seen = EVENT_ORDER.slice(0, 5);
  assert.equal(EV.trigger(s), 'sunucu', 'first unseen v2 card');
  assert.equal(EV.hasRack(s), false);
  const outcomes = new Set();
  for (let seed = 1; seed < 60 && outcomes.size < 2; seed++) {
    const k = studio(seed); k.events.pending = 'kedi'; const m = k.money; E.acceptOffer(k, (k.offers[0] || E.makeOffer(k)).id);
    const r = EV.applyChoice(k, 'b'); outcomes.add(r.outcome);
    if (r.outcome === 'win') assert.ok(k.money > m - 1e-9 && r.cash > 0); else assert.equal(k.buffs.at(-1).mult, 0.75);
  }
  assert.deepEqual([...outcomes].sort(), ['lose', 'win']);
  const a = studio(); a.events.pending = 'toplanti'; EV.applyChoice(a, 'a');
  const b = studio(); hireAt(b, 'pm', 5, 3); b.events.pending = 'toplanti'; const rb = EV.applyChoice(b, 'a');
  assert.equal(rb.pm, true);
  assert.equal(b.buffs.at(-1).until - b.simSec, (a.buffs.at(-1).until - a.simSec) / 2);
});
test('every event text key exists (incl. sub/subRack, raWin/rbWin/rbLose, raPm)', () => {
  for (const id of EVENT_ORDER) {
    const e = tr.events[id];
    for (const k of ['text', 'a', 'b']) assert.ok(e[k], id + '.' + k);
    assert.ok(e.ra, id + '.ra');
    if (EVENTS[id].b.chance) assert.ok(e.rbWin && e.rbLose, id); else assert.ok(e.rb, id + '.rb');
    if (EVENTS[id].a.pmHalves) assert.ok(e.raPm, id + '.raPm');
  }
  assert.ok(tr.events.sunucu.subRack);
});

// ------------------------------------------------------------------ tutorial.pm + stage counter
test('tutorial.pm: while placing the first PM, and as a 9 s tip when auto-placed; once per save', () => {
  const s = studio();
  assert.equal(TU.currentHint(s, { placingPm: true }).key, 'tutorial.pm');
  assert.equal(TU.currentHint(s, { placingItem: true }).key, 'items.area');
  assert.equal(TU.currentHint(s, { placingDesk: true, glow: true }).key, 'items.area');
  assert.equal(TU.currentHint(s, {}), null);
  const st = memStorage(); st.setItem(S.SAVE_KEY, S.serialize(s, T0));
  const c = new Controller(st, T0);
  c.state.money = 1e9;
  const d = c.state; d.desks.push({ id: d.nextId++, kind: 'masa_tekli_monitor_01', gx: 5, gy: 5 });   // a free desk -> auto seat
  const r = c.hire('pm');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(c.state.flags.pmTip, true);
  assert.equal(c.hint().key, 'tutorial.pm');
  c.tip.until = Date.now() - 1; c.handleAdvance({ delivered: [] });
  assert.equal(c.tip, null);
  assert.equal(TU.currentHint(c.state, { placingPm: true }), null, 'only once');
});
test('stage counter: acikofis_stage_0 at the first delivery, _1/_2 on moves, never twice, survives reload', () => {
  const st = memStorage(), c = new Controller(st, T0), sent = [];
  c.on('count', (n) => sent.push(n));
  c.countStage(); assert.deepEqual(sent, [], 'nothing before the first delivery');
  c.state.projectsDone = 1; c.countStage(); c.countStage();
  assert.deepEqual(sent, ['acikofis_stage_0']);
  rich(c.state); c.move(); c.move();
  assert.deepEqual(sent, ['acikofis_stage_0', 'acikofis_stage_1', 'acikofis_stage_2']);
  c.save(T0 + 1);
  const c2 = new Controller(st, T0 + 2), sent2 = [];
  c2.on('count', (n) => sent2.push(n)); c2.countStage();
  assert.deepEqual(sent2, []);
});

// ------------------------------------------------------------------ Ajans layout
test('Ajans: 14x14, new decor only outside the old 10x10 or on old decor tiles -> every Stüdyo office fits', () => {
  assert.deepEqual(STAGES[2].area, [14, 14]);
  const tiles = (st) => new Set(STAGES[st].decor.flatMap((d) => G.footprint(d.kind, d.gx, d.gy)).map(([x, y]) => x + ',' + y));
  const stud = tiles(1);
  for (const k of tiles(2)) { const [x, y] = k.split(',').map(Number); assert.ok(x >= 10 || y >= 10 || stud.has(k), 'decor tile ' + k); }
  const d2 = STAGES[2].door; assert.ok(d2.gx >= 10 || d2.gy >= 10);
  // a studio filled with desks and items keeps everything, with no overlap, after the move
  const s = studio(11);
  E.buyItem(s, 'kahve', 5, 5); E.buyItem(s, 'bitki', 7, 7);
  for (let i = 0; i < 40; i++) { const sp = G.validSpots(s, E.deskKindForStage(1))[0]; if (!sp) break; s.money += 1e9; E.buyDesk(s, E.deskKindForStage(1), sp[0], sp[1]); }
  const desks = JSON.stringify(s.desks), items = JSON.stringify(s.items);
  rich(s); assert.ok(E.moveOffice(s).ok);
  assert.equal(JSON.stringify(s.desks), desks); assert.equal(JSON.stringify(s.items), items);
  const occ = new Map();
  const put = (ts, what) => { for (const [x, y] of ts) { const k = x + ',' + y; assert.ok(!occ.has(k) || occ.get(k) === what, k + ' ' + occ.get(k) + ' vs ' + what); occ.set(k, what); } };
  for (const d of STAGES[2].decor) put(G.footprint(d.kind, d.gx, d.gy), 'decor');
  for (const d of s.desks) put(G.footprint(d.kind, d.gx, d.gy), 'desk' + d.id);
  for (const it of s.items) put([[it.gx, it.gy]], 'item' + it.id);
  assert.ok(G.validSpots(s, E.deskKindForStage(2)).length > 5, 'room to grow in the Ajans');
});
test('desk cost: unchanged from v1 for the first 16 desks, then gentler growth', () => {
  const s = E.newState(T0, 1);
  for (let n = 1; n <= 16; n++) { s.desks.length = n; assert.equal(E.deskCost(s), Math.round(30 * 1.45 ** (n - 1))); }
  s.desks.length = 20;
  assert.equal(E.deskCost(s), Math.round(30 * 1.45 ** 15 * CFG.deskCostGrowthLate ** 4)); assert.equal(CFG.deskCostGrowthLate, 1.36);
});

// ------------------------------------------------------------------ server plausibility mirror
test('honest Açık Ofis runs stay far inside the leaderboard plausibility bound (JS mirror of leaderboard.sql v5)', () => {
  const s = studio(); const now = T0 + 3600e3;
  s.startedAt = T0; s.lastSaved = now;
  const r = aoPlausible(JSON.parse(S.serialize(s, now)), now);
  assert.ok(r.ok);
  assert.equal(aoPlausible({ totalEarned: 1e20, stage: 2, startedAt: T0 }, now).ok, false);
  assert.equal(aoPlausible({ totalEarned: 5000, stage: 2, startedAt: T0 }, now).ok, false, 'Ajans needs 200k earned');
});

// ------------------------------------------------------------------ copy (Yazı) + leaderboard helpers
test("Yazı's copy is used verbatim", () => {
  assert.equal(I.t('staff.tasarimci.name'), 'Tasarımcı');
  assert.equal(I.t('staff.tasarimci.desc', { n: 20 }), 'Tasarım işlerini uçurur. Katıldığı projeler %20 daha kazançlı.');
  assert.equal(I.t('staff.pm.name'), 'Proje Yöneticisi');
  assert.equal(I.t('staff.pm.desc', { n: 25 }), 'Toplantıyı beş dakikada bitirir. Yanındaki masalar %25 daha hızlı.');
  assert.deepEqual([I.t('items.kahve.name'), I.t('items.kahve.desc'), I.t('items.kahve.effect', { n: 15 })],
    ['Kahve makinesi', 'Çay kadar sevilmese de iş görür.', 'Çevresindeki masalar %15 daha hızlı.']);
  assert.deepEqual([I.t('items.bitki.name'), I.t('items.bitki.desc'), I.t('items.bitki.effect', { n: 8 })],
    ['Ofis bitkisi', 'Kimse sulamıyor ama hâlâ yaşıyor.', 'Geniş bir alandaki masalar %8 daha hızlı.']);
  assert.deepEqual([I.t('items.sunucu.name'), I.t('items.sunucu.desc'), I.t('items.sunucu.effect', { n: 25 })],
    ['Sunucu rafı', 'Vınlıyor, ısınıyor, bir şeyler çalıştırıyor.', 'Çevresindeki masaların teslim ettiği projeler %25 daha kazançlı.']);
  assert.equal(I.t('items.area'), 'Parlayan kareler bonus alır.');
  assert.equal(I.t('tutorial.pm'), 'Proje Yöneticisini masaların ortasına koy, yanındaki herkes hızlanır.');
  assert.deepEqual(tr.bubbles.pm, ['Bunu bir toplantıda konuşalım.', 'Takvime ekledim.', 'Hangi sprintteyiz?']);
  for (const b of tr.bubbles.pm) assert.ok(b.split(/\s+/).length <= 5);
  assert.equal(I.t('stageUp.ajans'), 'Artık “biz” diyorsunuz ve bunu gerçekten ciddi söylüyorsunuz.');
  for (const st of STAGES.slice(1)) assert.ok(tr.stageUp[st.id], 'stageUp.' + st.id);
  for (const k of ['share', 'ok']) assert.ok(tr.stageUp[k]);
  for (const id of ITEM_ORDER) assert.ok(tr.items[id].name && tr.items[id].desc && tr.items[id].effect.includes('%{n}'));
  assert.ok(tr.stages.ajans);
  for (const k of ['title', 'tab', 'refresh', 'join', 'shared', 'shareText']) assert.ok(tr.lb[k], 'lb.' + k);
  assert.ok(tr.menu.leaderboard);
});
test('leaderboard helpers: nickname rules = Kodhane, server errors, view with pinned/pending rows', () => {
  assert.equal(LB.validateNickname('  Ali   Veli ').value, 'Ali Veli');
  assert.equal(LB.validateNickname('ab').error, 'too_short');
  assert.equal(LB.validateNickname('abcdefghijklmnopq').error, 'too_long');
  assert.equal(LB.validateNickname('a.b').error, 'invalid_chars');
  assert.equal(LB.validateNickname('K o d-h_a n e').error, 'blocked');
  assert.equal(LB.validateNickname('kod-ustası_1').ok, true);
  assert.equal(LB.nickKey('IŞIK'), LB.nickKey('ışık'));
  assert.equal(LB.serverNickError({ code: '23505' }), 'taken');
  assert.equal(LB.serverNickError({ code: '23514', message: 'nickname_blocked' }), 'blocked');
  assert.equal(LB.serverNickError({ message: 'Failed to fetch' }), 'offline');
  const rows = [1, 2, 3].map((i) => ({ rank: i, nickname: 'p' + i, score: 1000 - i, stage: 2, is_me: false, status: 'ok' }));
  let v = LB.buildView(rows.concat([{ rank: 60, nickname: 'ben', score: 5, stage: 1, is_me: true, status: 'ok' }]), 3);
  assert.equal(v.top.length, 3); assert.equal(v.pinned.nickname, 'ben');
  v = LB.buildView(rows.concat([{ rank: null, nickname: 'ben', score: null, stage: null, is_me: true, status: 'pending' }]));
  assert.equal(v.meStatus, 'pending'); assert.equal(v.me, null);
  assert.equal(LB.buildView([]).empty, true);
  assert.equal(LB.stageName(2), tr.stages.ajans); assert.equal(LB.rankBadge(4), '#4');
});

// v2.0.1: Yazı's fixes, quotes, promo video keys, {s} from the event config
test('v2.0.1 copy: viral/kedi texts, {s} filled from EVENTS, typographic quotes, video.* keys', () => {
  assert.equal(I.t('events.viral.text'), 'Paylaşımın viral oldu!');
  assert.equal(I.t('events.viral.b'), 'Hemen paraya çevir');   // v2.1.1
  assert.equal(I.t('events.kedi.ra'), 'Commit geri alındı, kedi başka bir klavyeye geçti.');
  const s = studio(); s.events.pending = 'viral'; const r = EV.applyChoice(s, 'a');
  assert.equal(r.buffSec, EVENTS.viral.a.buff.sec);
  assert.equal(I.t('events.viral.ra', { s: r.buffSec }), 'Herkes kod yazıyor: ' + EVENTS.viral.a.buff.sec + ' sn boyunca ekip daha hızlı!');
  const b = studio(); b.events.pending = 'viral'; const m0 = b.money; const rb = EV.applyChoice(b, 'b');
  assert.ok(rb.cash >= 0 && b.money >= m0 && !rb.buffSec, 'viral b = instant cash (30% of the running project pay), no requests/offers');
  assert.deepEqual([I.t('video.s1'), I.t('video.s2'), I.t('video.s3'), I.t('video.s4')],
    ['Bir laptop ve bir demlik çayla başladık.', 'Şimdi “biz” diyoruz.', 'Kahveyi nereye koyduğun önemli.', 'Kodhane: Açık Ofis. Tarayıcıda ve telefonda oyna.']);
  const bad = [];
  (function walk(o, p) { for (const [k, v] of Object.entries(o)) { const q = p ? p + '.' + k : k; if (typeof v === 'string') { if (/[‘’"„«»]|(^|[\s(])'[^']+'/.test(v)) bad.push(q); } else if (v && typeof v === 'object') walk(v, q); } })(tr, '');
  assert.deepEqual(bad, [], 'quotes are “ ” and the apostrophe is a straight \'');
  for (const k of ['deskCostGrowth', 'deskCostGrowthFrom', 'deskCostGrowthLate']) assert.equal(typeof CFG[k], 'number', 'CFG.' + k);
});
