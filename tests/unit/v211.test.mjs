// v2.1.1: Yazı's copy fixes (viral card, typographic quotes, item-moving texts) + viral b result without a running project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../../src/logic/economy.js';
import * as EV from '../../src/logic/events.js';
import * as I from '../../src/logic/i18n.js';
import { EVENTS } from '../../src/logic/config.js';

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const tr = JSON.parse(fs.readFileSync(new URL('../../src/locales/tr.json', import.meta.url)));
I.registerLocales({ tr }); I.setLocale('tr'); I.setPointerFine(false);
function studio(seed = 5) { const s = E.newState(T0, seed); s.tutorial = { step: 4, done: true }; s.money = 1e9; s.totalEarned = 1e9; E.moveOffice(s); return s; }

test('v2.1.1 copy: viral card, stage-up / video quotes, item-moving texts', () => {
  assert.equal(I.t('events.viral.b'), 'Hemen paraya çevir');
  assert.equal(I.t('events.viral.rb'), 'Müşteri paylaşımı görünce ödemenin bir kısmını hemen yaptı.');
  assert.equal(I.t('events.viral.rbNone'), 'Süren bir proje yoktu, paylaşım yalnızca beğeni topladı.');
  assert.equal(I.t('stageUp.ajans'), 'Artık “biz” diyorsunuz ve bunu gerçekten ciddi söylüyorsunuz.');
  assert.equal(I.t('stageUp.studyo'), 'Kapıda adınız yazıyor. Müşteri artık “ekibiniz kaç kişi?” diye sormaya çekinmiyor.');
  assert.equal(I.t('video.s2'), 'Şimdi “biz” diyoruz.');
  assert.equal(I.t('hud.zoomFit'), 'Tüm ofisi göster');
  assert.equal(I.t('items.move'), 'Taşı');
  assert.equal(I.t('toast.itemMoved', { name: 'Sunucu rafı' }), 'Sunucu rafı taşındı.');
  assert.equal(I.t('place.moveItem', { name: 'Sunucu rafı' }), 'Sunucu rafı için yeni bir yer seç. Taşımak ücretsiz.');
});

test('viral b: noProject flag only when no project is running (UI then uses events.viral.rbNone)', () => {
  const a = studio(); a.projects = []; a.events.pending = 'viral';
  const r0 = EV.applyChoice(a, 'b');
  assert.equal(r0.noProject, true);
  const b = studio(); b.events.pending = 'viral';
  if (!b.offers.length) E.giveFirstOffer(b);
  assert.ok(E.acceptOffer(b, b.offers[0].id).ok);
  assert.ok(b.projects.length, 'a running project');
  const pay = b.projects[0].pay;
  const r1 = EV.applyChoice(b, 'b');
  assert.equal(r1.noProject, undefined);
  assert.equal(r1.cash, Math.round(pay * EVENTS.viral.b.cashFromProject));
  // events without an 'rNone' text keep their usual key (the UI checks the key exists)
  assert.equal(typeof I.raw('events.final.rbNone'), 'undefined');
  assert.equal(typeof I.raw('events.viral.rbNone'), 'string');
});
