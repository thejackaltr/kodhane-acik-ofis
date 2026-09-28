// Writes the promo-video save (one tap before the Ajans stage-up):
//   tests/fixtures/promo-before-ajans.json      (plain save; used by the unit test)
//   tools/promo/before-ajans.console.js         (paste into the browser console on the game page; resets the clock so there is
//                                                no "sen yokken" popup, stores the save and reloads)
// Usage: node tools/promo/make-promo-save.mjs
import fs from 'node:fs';
import { promoSave } from '../../tests/smoke/grown.mjs';
import { serialize } from '../../src/logic/save.js';
const T = Date.UTC(2026, 8, 28, 12, 0, 0);
const json = serialize(promoSave(T), T);
fs.writeFileSync(new URL('../../tests/fixtures/promo-before-ajans.json', import.meta.url), json + '\n');
fs.writeFileSync(new URL('./before-ajans.console.js', import.meta.url),
  '// Kodhane: Açık Ofis promo save: Butik Stüdyo, full room, Ajans move affordable. Paste on the game page, then tap Ofis -> Taşın.\n' +
  '(() => { const s = ' + json + ';\n  const now = Date.now(), age = s.lastSaved - s.startedAt; s.startedAt = now - age; s.lastSaved = s.lastTick = now;\n' +
  "  localStorage.setItem('acik_ofis_save_v1', JSON.stringify(s)); location.reload(); })();\n");
const s = JSON.parse(json);
console.log('stage', s.stage, 'staff', s.staff.length, 'desks', s.desks.length, 'items', s.items.map((i) => i.type).join(','), 'money', s.money, 'earned', s.totalEarned);
