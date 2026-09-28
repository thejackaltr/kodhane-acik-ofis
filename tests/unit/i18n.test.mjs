import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as I from '../../src/logic/i18n.js';
import { fmt, tl, fmtDuration } from '../../src/logic/format.js';
import * as E from '../../src/logic/economy.js';
import * as S from '../../src/logic/save.js';

const root = new URL('../../', import.meta.url);
const tr = JSON.parse(fs.readFileSync(new URL('src/locales/tr.json', root)));
const en = { hud: { money: 'Cash' }, fmt: { money: '{v} TL', hours: '{n} h', minutes: '{n} min', seconds: '{n} s', pair: '{a} {b}' } };

test('locale loader: detect from device, stored choice wins, unknown -> tr', () => {
  I.registerLocales({ tr, en });
  assert.equal(I.detect(['en-US', 'tr-TR']), 'en');
  assert.equal(I.detect(['de-DE', 'tr']), 'tr');
  assert.equal(I.detect(['fr-FR']), 'tr');
  assert.equal(I.detect(['en-US'], 'tr'), 'tr');
  assert.equal(I.detect(['tr'], 'xx'), 'tr');
});

test('fallback: missing English keys come from tr.json', () => {
  I.registerLocales({ tr, en });
  I.setLocale('en');
  assert.equal(I.t('hud.money'), 'Cash');
  assert.equal(I.t('tutorial.laptop'), 'Laptop açık, çay demde. İlk müşteri kapıda.');
  assert.equal(fmt(2.25e6), '2.25M', 'Intl formats per locale');
  assert.equal(fmtDuration(125), '2 min 5 s');
  I.setLocale('zz');
  assert.equal(I.locale(), 'tr');
});

test('Turkish case mapping uses toLocaleUpperCase(locale)', () => {
  I.registerLocales({ tr }); I.setLocale('tr');
  assert.equal(I.upper('kasa istanbul ılık'), 'KASA İSTANBUL ILIK');
  assert.equal(I.lower('IŞIK İZ'), 'ışık iz');
});

test('list items with variables; pseudo-locale stretches strings by 30%', () => {
  I.setLocale('tr');
  assert.equal(I.item('welcome.lines', 0, { p: 3, k: 2 }), 'Sen yokken ekip 3 proje teslim etti, kedi 2 kez klavyeye yattı.');
  I.setPseudo(30);
  const s = I.t('nav.team');
  assert.ok(s.length >= Math.ceil('Ekip'.length * 1.3), s);
  I.setPseudo(0);
  assert.equal(I.t('nav.team'), 'Ekip');
  assert.equal(tl(90), '90 TL');
});

test('no hardcoded UI text in src/*.js (Turkish letters only allowed in comments)', () => {
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(new URL('src', root).pathname);
  const bad = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (/[çğıöşüÇĞİÖŞÜ]/.test(m[2]) && !/^·ğüşİıöç$/.test(m[2])) bad.push(path.basename(f) + ': ' + m[2].slice(0, 40));
    }
  }
  assert.deepEqual(bad, []);
});

test('no text baked into images (atlas art uses no fillText)', () => {
  const art = fs.readFileSync(new URL('tools/atlas/art.js', root), 'utf8');
  assert.equal(/fillText|strokeText/.test(art), false);
});

test('saves store ids, never display names', () => {
  const names = new Set([...Object.values(tr.projects), ...Object.values(tr.staff).map((x) => x.name), ...Object.values(tr.stages)]);
  const st = E.newState(0, 1); st.money = 1e6; st.totalEarned = 1e6;
  E.acceptOffer(st, E.giveFirstOffer(st).id);
  E.hire(st, 'stajyer', { kind: 'masa_tekli_laptop_01', gx: 3, gy: 3 });
  E.advance(st, 600, { auto: true });
  const sample = S.serialize(st, 1);
  for (const n of names) assert.equal(sample.includes(n), false);
});
