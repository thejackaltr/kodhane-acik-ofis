// Save/load: JSON in localStorage (guest play). Storage is injected so it's testable and so a cloud
// adapter can reuse serialize/deserialize.
import { SAVE_VERSION, STAGES, STAFF, ITEMS } from './config.js';
import { newState } from './economy.js';

export const SAVE_KEY = 'acik_ofis_save_v1';
export const BACKUP_KEY = 'acik_ofis_save_backup';

export function serialize(state, now) {
  state.lastSaved = now;
  return JSON.stringify(state);
}
function num(x, d = 0) { return typeof x === 'number' && isFinite(x) ? x : d; }
function arr(x) { return Array.isArray(x) ? x : []; }

// Validate + migrate any stored object into a well-formed current state. Returns null if hopeless.
// v1 -> v2 is lossless: every v1 field is kept as is; v2 only adds items[] and flags (pmTip, stagesCounted).
// The storage key stays 'acik_ofis_save_v1' so v1 players keep their office.
export function migrate(obj, now) {
  if (!obj || typeof obj !== 'object') return null;
  const base = newState(num(obj.startedAt, now), num(obj.rng, 12345));
  const s = Object.assign(base, {
    money: Math.max(0, num(obj.money)), totalEarned: Math.max(0, num(obj.totalEarned)),
    projectsDone: Math.max(0, num(obj.projectsDone)), catNaps: Math.max(0, num(obj.catNaps)), taps: num(obj.taps),
    playSec: Math.max(0, num(obj.playSec)), simSec: Math.max(0, num(obj.simSec)),
    stage: Math.max(0, Math.min(STAGES.length - 1, Math.floor(num(obj.stage)))),
    nextId: Math.max(3, Math.floor(num(obj.nextId, 3))),
    lastSaved: num(obj.lastSaved, now), lastTick: num(obj.lastTick, num(obj.lastSaved, now)),
    offerTimer: num(obj.offerTimer)
  });
  const desks = arr(obj.desks).filter((d) => d && typeof d.kind === 'string' && Number.isInteger(d.gx) && Number.isInteger(d.gy) && Number.isInteger(d.id));
  if (desks.length) s.desks = desks;
  const deskIds = new Set(s.desks.map((d) => d.id));
  const staff = arr(obj.staff).filter((x) => x && typeof x.type === 'string' && STAFF[x.type] && Number.isInteger(x.id) && deskIds.has(x.deskId));
  if (staff.length) s.staff = staff;
  if (!s.staff.some((x) => x.type === 'kurucu')) s.staff.unshift({ id: s.nextId++, type: 'kurucu', deskId: s.desks[0].id, projectId: null });
  s.offers = arr(obj.offers).filter((o) => o && Number.isInteger(o.id) && num(o.pay) > 0).slice(0, 3);
  s.projects = arr(obj.projects).filter((p) => p && p.need && p.done && Number.isInteger(p.id));
  const pids = new Set(s.projects.map((p) => p.id));
  for (const x of s.staff) if (x.projectId != null && !pids.has(x.projectId)) x.projectId = null;
  s.buffs = arr(obj.buffs).filter((b) => b && num(b.mult) > 0 && num(b.until) > 0);
  s.upgrades = arr(obj.upgrades).filter((u) => typeof u === 'string');
  if (obj.tutorial && typeof obj.tutorial === 'object') s.tutorial = { step: Math.max(0, Math.floor(num(obj.tutorial.step))), done: !!obj.tutorial.done };
  if (obj.flags && typeof obj.flags === 'object') s.flags = Object.assign(s.flags, obj.flags);
  // v2 area items: known type, integer tile inside the grid, unique id, no two on one tile
  const used = new Set(), ids = new Set();
  s.items = arr(obj.items).filter((it) => {
    if (!it || !ITEMS[it.type] || !Number.isInteger(it.id) || !Number.isInteger(it.gx) || !Number.isInteger(it.gy)) return false;
    const k = it.gx + ',' + it.gy;
    if (ids.has(it.id) || used.has(k) || it.gx < 0 || it.gy < 0) return false;
    ids.add(it.id); used.add(k); return true;
  }).map((it) => ({ id: it.id, type: it.type, gx: it.gx, gy: it.gy }));
  for (const it of s.items) if (it.id >= s.nextId) s.nextId = it.id + 1;
  s.flags.pmTip = !!s.flags.pmTip;
  s.flags.stagesCounted = arr(s.flags.stagesCounted).filter((x) => Number.isInteger(x) && x >= 0 && x < STAGES.length);
  // a v1 save already reached its stages before the counter existed: do not count them again
  if (num(obj.v, 1) < 2) for (let i = 0; i <= s.stage; i++) if ((i > 0 || s.projectsDone > 0) && !s.flags.stagesCounted.includes(i)) s.flags.stagesCounted.push(i);
  if (obj.events && typeof obj.events === 'object') {
    s.events = { nextAt: num(obj.events.nextAt, s.events.nextAt), seen: arr(obj.events.seen).filter((x) => typeof x === 'string'), pending: typeof obj.events.pending === 'string' ? obj.events.pending : null };
  }
  s.v = SAVE_VERSION;
  return s;
}
export function deserialize(str, now) {
  try { return migrate(JSON.parse(str), now); } catch (e) { return null; }
}
export function load(storage, now) {
  let str = null;
  try { str = storage.getItem(SAVE_KEY); } catch (e) { /* private mode */ }
  return str ? deserialize(str, now) : null;
}
export function store(storage, state, now) {
  try { storage.setItem(SAVE_KEY, serialize(state, now)); return true; } catch (e) { return false; }
}
