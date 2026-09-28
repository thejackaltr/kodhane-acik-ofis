import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../../src/logic/economy.js';
import * as TU from '../../src/logic/tutorial.js';
import * as EV from '../../src/logic/events.js';
import * as OFF from '../../src/logic/offline.js';
import * as S from '../../src/logic/save.js';
import * as SY from '../../src/logic/sync.js';
import * as I from '../../src/logic/i18n.js';
import { fmt, tl, fmtDuration } from '../../src/logic/format.js';
import { CFG, EVENTS, EVENT_ORDER, STAFF_ORDER, UPGRADE_ORDER } from '../../src/logic/config.js';

const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);
const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));
I.setDict(tr);

function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }

test('tutorial: one hint at a time, in order, done after first hire + next offer', () => {
  const s = E.newState(T0, 1);
  assert.equal(TU.currentHint(s).key, 'tutorial.laptop');
  E.giveFirstOffer(s); TU.notify(s, 'laptop');
  const o = s.offers[0]; E.acceptOffer(s, o.id); TU.notify(s, 'accepted');
  assert.equal(TU.currentHint(s).key, 'tutorial.basla');
  while (!E.tapLaptop(s).delivered.length);
  TU.notify(s, 'delivered');
  assert.equal(TU.currentHint(s).key, 'tutorial.stajyer');
  assert.equal(TU.currentHint(s, { placingDesk: true }).key, 'tutorial.masa');
  E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 }); TU.notify(s, 'hired');
  E.advance(s, CFG.offerEverySec + 1);
  assert.equal(TU.currentHint(s).key, 'tutorial.teklif');
  E.acceptOffer(s, s.offers[0].id); TU.notify(s, 'accepted');
  assert.equal(s.tutorial.done, true);
  assert.equal(TU.currentHint(s), null);
});

test('tutorial copy: every hint is a single short sentence from tr.json', () => {
  for (const k of ['laptop', 'basla', 'stajyer', 'masa', 'teklif']) {
    const txt = I.t('tutorial.' + k);
    assert.notEqual(txt, 'tutorial.' + k);
    assert.ok(txt.length <= 60, txt);
  }
  assert.equal(I.t('tutorial.laptop'), 'Laptop açık, çay demde. İlk müşteri kapıda.');
  assert.equal(I.t('tutorial.basla'), 'Kafe menüsü için site istiyorlar. Başla!');
  assert.equal(I.t('tutorial.stajyer'), 'Yalnız yetişmiyor. Bir stajyer al?');
});

test('events: first card is the logo one, not before first hire; choices apply', () => {
  const s = E.newState(T0, 1);
  s.playSec = 999;
  assert.equal(EV.shouldTrigger(s), false, 'tutorial not far enough');
  s.tutorial.step = 3;
  assert.equal(EV.shouldTrigger(s), true);
  assert.equal(EV.trigger(s), 'logo');
  s.projects.push({ id: 9, key: 'kafe', need: { kod: 100, tasarim: 0 }, done: { kod: 0, tasarim: 0 }, pay: 100 });
  const r = EV.applyChoice(s, 'a');
  assert.equal(r.id, 'logo');
  assert.equal(s.projects[0].pay, 130); assert.equal(s.projects[0].need.kod, 125);
  assert.equal(s.events.pending, null);
  assert.ok(s.events.nextAt > s.playSec);
  for (const id of EVENT_ORDER) {
    const keys = ['text', 'a', 'b', 'ra', ...(EVENTS[id].b.chance ? ['rbWin', 'rbLose'] : ['rb'])];
    for (const k of keys) assert.ok(typeof tr.events[id][k] === 'string', id + '.' + k);
  }
  assert.equal(tr.events.logo.text, 'Müşteri: Logoyu biraz daha büyütebilir miyiz?');
});

test('events: cash choice never makes money negative', () => {
  const s = E.newState(T0, 1); s.tutorial.step = 3; s.money = 3;
  s.events.pending = 'cay';
  EV.applyChoice(s, 'a');
  assert.ok(s.money >= 0);
});

test('offline: earnings from timestamps, capped at 8 h, popup only for gaps >= 60 s', () => {
  const s = E.newState(T0, 5);
  s.money = 500; E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  s.lastTick = T0;
  const short = OFF.catchUp(JSON.parse(JSON.stringify(s)), T0 + 30e3);
  assert.equal(short, null);
  const a = JSON.parse(JSON.stringify(s)), b = JSON.parse(JSON.stringify(s));
  const r8 = OFF.catchUp(a, T0 + 8 * 3600e3);
  const r48 = OFF.catchUp(b, T0 + 48 * 3600e3);
  assert.ok(r8.earned > 0 && r8.projects > 0);
  assert.equal(r48.capped, true); assert.equal(r48.simulatedSec, CFG.offlineCapSec);
  assert.equal(a.money, b.money, '48 h pays the same as 8 h (cap)');
  assert.equal(b.lastTick, T0 + 48 * 3600e3);
  assert.ok(r8.catNaps >= 1);
});

test('offline: clock going backwards gives nothing', () => {
  const s = E.newState(T0, 5); s.money = 100;
  assert.equal(OFF.catchUp(s, T0 - 3600e3), null);
  assert.equal(s.money, 100);
});

test('welcome-back texts exist and fill in numbers', () => {
  const lines = I.list('welcome.lines');
  assert.ok(lines.length >= 3);
  assert.equal(lines[0].replace('{p}', 3).replace('{k}', 2), 'Sen yokken ekip 3 proje teslim etti, kedi 2 kez klavyeye yattı.');
  assert.equal(OFF.welcomeTemplate({ projects: 0 }).key, 'welcome.quiet');
});

test('save/load round trip + migration of broken saves', () => {
  const st = memStorage();
  const s = E.newState(T0, 9); s.money = 777; s.totalEarned = 1234;
  E.hire(s, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  assert.ok(S.store(st, s, T0 + 5));
  const l = S.load(st, T0 + 10);
  assert.equal(l.money, s.money); assert.equal(l.staff.length, 2); assert.equal(l.lastSaved, T0 + 5);
  assert.deepEqual(l.desks, s.desks);
  assert.equal(S.deserialize('{nope', T0), null);
  const m = S.migrate({ money: -5, totalEarned: 'x', staff: [{ id: 1, type: 'stajyer', deskId: 999 }], desks: [], stage: 7 }, T0);
  assert.equal(m.money, 0); assert.equal(m.totalEarned, 0); assert.equal(m.stage, 2, 'clamped to the last stage (v2: Ajans)');
  assert.ok(m.staff.some((x) => x.type === 'kurucu'));
  assert.ok(m.staff.every((x) => m.desks.some((d) => d.id === x.deskId)));
  assert.equal(S.load(memStorage(), T0), null);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.equal(S.load(throwing, T0), null); assert.equal(S.store(throwing, s, T0), false);
});

test('save keys are namespaced (same origin as Kodhane)', () => {
  assert.match(S.SAVE_KEY, /^acik_ofis_/); assert.match(S.BACKUP_KEY, /^acik_ofis_/);
});

test('cloud merge rule: higher lifetime earnings wins, tie -> newer', () => {
  assert.equal(SY.chooseWinner({ totalEarned: 10 }, 5, { totalEarned: 20 }, 1), 'cloud');
  assert.equal(SY.chooseWinner({ totalEarned: 30 }, 1, { totalEarned: 20 }, 9), 'local');
  assert.equal(SY.chooseWinner({ totalEarned: 20 }, 1, { totalEarned: 20 }, 9), 'cloud');
  assert.equal(SY.chooseWinner({ totalEarned: 20 }, 9, null, 0), 'local');
  assert.equal(SY.needsBackup({ totalEarned: 0 }, 1, { totalEarned: 5 }, 2), false);
  assert.equal(SY.needsBackup({ totalEarned: 5, startedAt: 1 }, 1, { totalEarned: 9, startedAt: 1 }, 2), false);
  assert.equal(SY.needsBackup({ totalEarned: 5, startedAt: 1 }, 1, { totalEarned: 9, startedAt: 2 }, 2), true);
});

test('format: Turkish numbers via Intl', () => {
  assert.equal(fmt(0), '0'); assert.equal(fmt(5.5), '5,5'); assert.equal(fmt(999), '999');
  const sp = (x) => x.replace(/\u00a0/g, ' ');
  assert.equal(sp(fmt(1500)), '1,5 B'); assert.equal(sp(fmt(2.25e6)), '2,25 Mn'); assert.equal(tl(90), '90 TL');
  assert.equal(sp(fmt(1234567890)), '1,23 Mr'); assert.match(fmt(3e18), /E/);
  assert.equal(fmtDuration(59), '59 sn'); assert.equal(fmtDuration(3 * 3600 + 120), '3 sa 2 dk');
});

test('tr.json covers every staff type, upgrade and project key', () => {
  for (const k of ['kurucu', ...STAFF_ORDER]) assert.ok(tr.staff[k] && tr.staff[k].name, k);
  for (const k of UPGRADE_ORDER) assert.ok(tr.upgrades[k] && tr.upgrades[k].name, k);
  for (const k of E.PROJECT_KEYS) assert.ok(typeof tr.projects[k] === 'string', k);
  assert.equal(tr.cloud.askText, 'Ofisin büyüyor. Kaybolmasın mı? E-postanı yaz, kodu gönderelim.');
  assert.equal(tr.cloud.sent, 'E-postana giriş kodu gönderdik.');
});

test('bubbles are 3–5 words at most (short)', () => {
  const all = [...tr.bubbles.work, ...tr.bubbles.design, ...tr.bubbles.robot, ...tr.bubbles.idle, ...tr.bubbles.cat, tr.bubbles.hired, tr.bubbles.catKeyboard, ...tr.bubbles.delivered];
  for (const b of all) assert.ok(b.split(/\s+/).length <= 5, b);
});
