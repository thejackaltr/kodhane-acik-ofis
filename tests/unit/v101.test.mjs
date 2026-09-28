// v1.0.1: copy fixes, pointer-aware texts ("dokun" / "tıkla"), Senior rename, Kodhane referral counter (once, anonymous).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as I from '../../src/logic/i18n.js';

const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));

test('copy: tutorial.masa, share text/caption, cloud.spam', () => {
  I.registerLocales({ tr }); I.setLocale('tr'); I.setPointerFine(false);
  assert.equal(I.t('tutorial.masa'), 'Stajyerin masa istiyor. Boş bir yere dokun.');
  assert.equal(I.t('share.text', { n: 7, p: 42 }), "Kodhane: Açık Ofis'te ekibim 7 kişi oldu, 42 proje teslim ettik. Sen de ofisini kur:");
  assert.equal(I.t('share.caption', { stage: 'Butik Stüdyo', n: 7, p: 42 }), 'Butik Stüdyo · 7 kişilik ekip · 42 proje teslim');
  assert.equal(I.t('cloud.spam'), 'Gelmediyse spam klasörüne de bak.');
});

test('pointer-aware: touch = dokun, fine pointer = tıkla (separate keys)', () => {
  I.registerLocales({ tr }); I.setLocale('tr');
  I.setPointerFine(false);
  assert.equal(I.tp('tutorial.masa'), 'Stajyerin masa istiyor. Boş bir yere dokun.');
  assert.equal(I.tp('team.you'), 'Laptopa dokun, daha hızlı yaz.');
  assert.equal(I.tp('staff.kurucu.desc'), 'Kurucu. Laptopa dokununca daha hızlı yazar.');
  I.setPointerFine(true);
  assert.equal(I.tp('tutorial.masa'), 'Stajyerin masa istiyor. Boş bir yere tıkla.');
  assert.equal(I.tp('team.you'), 'Laptopa tıkla, daha hızlı yaz.');
  assert.equal(I.tp('staff.kurucu.desc'), 'Kurucu. Laptopa tıklayınca daha hızlı yazar.');
  assert.equal(I.tp('tutorial.laptop'), I.t('tutorial.laptop'), 'keys without a Fine variant fall back');
  I.setPointerFine(false);
});

test('Senior rename: display name only, id and description unchanged', () => {
  assert.equal(tr.staff.kidemli.name, 'Senior');
  assert.equal(tr.staff.kidemli.desc, 'Her hatayı daha önce görmüş.');
  const all = JSON.stringify(tr);
  assert.ok(!/Kıdemli/i.test(all));
});

test('Kodhane referral: remembered from utm_source=kodhane, counted once on first cloud save', async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const { rememberReferral, CloudSync } = await import('../../src/cloud/cloud.js');
  rememberReferral('?utm_source=share');
  assert.equal(store.acik_ofis_from_kodhane, undefined);
  rememberReferral('?utm_source=kodhane&utm_medium=news&utm_campaign=acikofis_v1');
  assert.equal(store.acik_ofis_from_kodhane, '1');
  const calls = [];
  const ctrl = { state: { lastSaved: 1 }, save() {}, replaceState() {} };
  const cs = new CloudSync(ctrl, { url: 'https://example.invalid' });
  cs.client.countEvent = (name) => { calls.push(name); return Promise.resolve(true); };
  // v2.3: the referral count follows the "İsimsiz sayaç" consent (GATE_SUPABASE_COUNTER): not answered / "Kapat" -> no
  // request and not marked as counted
  assert.equal(cs.countKodhaneSignup(), false, 'no consent -> not counted');
  store.acik_ofis_tel_notice = '1'; store.acik_ofis_tel = 'off';
  assert.equal(cs.countKodhaneSignup(), false, '"Kapat" -> not counted');
  assert.deepEqual(calls, []); assert.equal(store.acik_ofis_kodhane_signup_counted, undefined);
  store.acik_ofis_tel = 'on';
  assert.equal(cs.countKodhaneSignup(), true);
  assert.equal(cs.countKodhaneSignup(), false, 'only once');
  assert.deepEqual(calls, ['acikofis_cloud_signup_kodhane']);
  delete store.acik_ofis_from_kodhane; delete store.acik_ofis_kodhane_signup_counted;
  assert.equal(cs.countKodhaneSignup(), false, 'not from Kodhane -> nothing');
  delete globalThis.localStorage;
});
