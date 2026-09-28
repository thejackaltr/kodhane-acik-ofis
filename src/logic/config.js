// Kodhane: Açık Ofis — all game numbers in one place (no UI text here; text lives in src/locales/tr.json).
export const SAVE_VERSION = 2;

export const CFG = {
  offlineCapSec: 8 * 3600,      // offline earnings are capped at 8 h
  offlineMinSec: 60,            // gaps shorter than this are simulated silently (no popup)
  maxOffers: 3,
  offerEverySec: 14,            // a new offer arrives every N s (while below maxOffers)
  firstOffer: { key: 'kafe', kod: 22, tasarim: 0, pay: 90 },
  payPerUnit: 1.0,              // TL per work unit (kod)
  tasarimPremium: 1.35,         // tasarım units pay more
  projectSec: [35, 80],         // target duration of a project for the current team
  minWork: 18,
  tap: { kod: 2, tasarim: 0.6, teamShare: 0.04 }, // laptop tap: base + share of team rate
  catNapEverySec: [70, 150],    // online: cat walks to a keyboard every 70–150 s
  catNapSec: 12,
  catNapOfflineEverySec: 420,   // offline estimate: one nap per 7 min, max 30
  catNapOfflineMax: 30,
  eventFirstAtPlaySec: 170,     // first event card around minute 3
  eventEverySec: [150, 300],
  cloudAskAtPlaySec: 300,       // "İlerlemeni buluta kaydet" around minute 5
  autosaveSec: 10,
  staffCostGrowth: 1.15,
  deskCostGrowth: 1.45,
  deskCostGrowthFrom: 16,       // v2: from the 16th extra desk on (Ajans room) desks get cheaper to add
  deskCostGrowthLate: 1.3
};

// Employee types. kod/tasarim = work units per second. cost = first hire price.
export const STAFF = {
  kurucu:    { kod: 1,  tasarim: 0.4, cost: 0,     hireable: false },
  stajyer:   { kod: 1,  tasarim: 0.3, cost: 40,    hireable: true },
  junior:    { kod: 4.5, tasarim: 0.8, cost: 450,  hireable: true, unlockEarned: 150 },
  tasarimci: { kod: 1,  tasarim: 7,   cost: 1100,  hireable: true, unlockEarned: 500, projectBonus: 0.2 }, // v2: projects they worked on pay +20%
  kidemli:   { kod: 16, tasarim: 2,   cost: 3800,  hireable: true, unlockEarned: 2000 },
  yzajan:    { kod: 60, tasarim: 12,  cost: 30000, hireable: true, unlockStage: 1, unlockEarned: 20000 },
  // v2: Proje Yöneticisi — little own work, but desks next to theirs work +25% faster
  pm:        { kod: 2,  tasarim: 2,   cost: 8000,  hireable: true, unlockStage: 1, unlockEarned: 12000, adjSpeed: 0.25 }
};
// Promotion chain (in place, no new desk): stajyer -> junior -> kidemli
export const PROMOTE = { stajyer: 'junior', junior: 'kidemli' };
export const PROMOTE_DISCOUNT = 0.8; // promoting costs 80% of the target's hire price
export const STAFF_ORDER = ['stajyer', 'junior', 'tasarimci', 'kidemli', 'pm', 'yzajan'];

// Desks: the first one (founder) is free and fixed. Extra desks cost deskBase * growth^(extra-1).
export const DESK = { base: 30, founderKind: 'masa_kurucu_01', kinds: ['masa_tekli_laptop_01', 'masa_tekli_monitor_01'] };

// One office floor on a fixed grid (v2: 14x14 for Ajans). Stage = how much of it is usable + the look.
// Moving keeps every desk/item where it is, so a later stage may only add decor OUTSIDE the previous area
// (or reuse a tile the previous stage already had decor on); freeing tiles is always fine.
export const GRID = { w: 14, h: 14 };
export const STAGES = [
  { id: 'ev', look: 'ev', area: [6, 6], mult: 1.0, moveCost: 0,
    founderDesk: { gx: 1, gy: 2 },
    decor: [
      { kind: 'esya_cayocagi_01', gx: 0, gy: 5 },
      { kind: 'esya_kanepe_01', gx: 3, gy: 0 },
      { kind: 'esya_bitki_01', gx: 5, gy: 0 },
      { kind: 'esya_kitaplik_01', gx: 0, gy: 0 }
    ],
    rug: [[3, 3], [4, 3], [3, 4], [4, 4]],
    walls: { sag: { 1: 'pencere', 4: 'poster' }, sol: { 2: 'raf', 4: 'kapi' } },
    door: { gx: 0, gy: 4 }
  },
  { id: 'studyo', look: 'studyo', area: [10, 10], mult: 1.5, moveCost: 3000, unlockEarned: 3000,
    founderDesk: { gx: 1, gy: 2 },
    decor: [
      { kind: 'esya_cayocagi_01', gx: 0, gy: 9 },
      { kind: 'esya_sebil_01', gx: 0, gy: 8 },
      { kind: 'esya_tahta_01', gx: 6, gy: 0 },
      { kind: 'esya_bitki_01', gx: 9, gy: 0 },
      { kind: 'esya_bitki_01', gx: 0, gy: 0 },
      { kind: 'esya_puf_01', gx: 8, gy: 8 },
      { kind: 'esya_puf_01', gx: 9, gy: 7 },
      { kind: 'esya_kitaplik_01', gx: 4, gy: 0 }
    ],
    rug: [[7, 7], [8, 7], [7, 6], [8, 6]],
    walls: { sag: { 2: 'pencere', 3: 'logo', 7: 'pencere', 8: 'raf' }, sol: { 3: 'pencere', 5: 'raf', 8: 'kapi' } },
    door: { gx: 0, gy: 8 }
  },
  // v2: Ajans — 14x14, glass-front walls, grey oak floor. New decor only at gx>=10 or gy>=10 (see GRID note).
  { id: 'ajans', look: 'ajans', area: [14, 14], mult: 2.25, moveCost: 100000, unlockEarned: 200000,
    founderDesk: { gx: 1, gy: 2 },
    decor: [
      { kind: 'esya_cayocagi_01', gx: 0, gy: 9 },
      { kind: 'esya_sebil_01', gx: 0, gy: 8 },
      { kind: 'esya_tahta_01', gx: 6, gy: 0 },
      { kind: 'esya_bitki_01', gx: 9, gy: 0 },
      { kind: 'esya_bitki_01', gx: 0, gy: 0 },
      { kind: 'esya_kitaplik_01', gx: 4, gy: 0 },
      { kind: 'esya_kanepe_01', gx: 11, gy: 0 },
      { kind: 'esya_bitki_01', gx: 13, gy: 0 },
      { kind: 'esya_toplanti_01', gx: 11, gy: 11 },
      { kind: 'esya_puf_01', gx: 13, gy: 13 },
      { kind: 'esya_kitaplik_01', gx: 0, gy: 13 }
    ],
    rug: [[11, 2], [12, 2], [11, 3], [12, 3]],
    walls: { sag: { 2: 'vitrin', 3: 'logo', 7: 'vitrin', 8: 'vitrin', 12: 'pencere' }, sol: { 3: 'vitrin', 5: 'raf', 10: 'vitrin', 12: 'kapi' } },
    door: { gx: 0, gy: 12 }
  }
];
// Later stages shown as "yakında" in the UI (none after Ajans in v2).
export const FUTURE_STAGES = [];

// v2: placeable area items. radius = Chebyshev distance in tiles around the item (glowing tiles).
// speed: desks touching the area work faster; reward: projects delivered by someone sitting in it pay more.
// The same item type never stacks on one desk (the best one counts); different types add up.
export const ITEMS = {
  kahve:  { kind: 'esya_kahve_01',  cost: 2500,  growth: 1.9, max: 4, radius: 1, speed: 0.15, unlockStage: 1 },
  bitki:  { kind: 'esya_bitki_02',  cost: 1500,  growth: 1.9, max: 4, radius: 3, speed: 0.08, unlockStage: 1 },
  sunucu: { kind: 'esya_sunucu_01', cost: 40000, growth: 1.9, max: 3, radius: 1, reward: 0.25, unlockStage: 2 }
};
export const ITEM_ORDER = ['kahve', 'bitki', 'sunucu'];

// One-time upgrades (Ofis panel)
export const UPGRADES = {
  demlik:   { cost: 120,  mult: 1.10 },            // Demlik çay: +10% team speed
  pano:     { cost: 600,  autoAccept: true },      // Proje panosu: team accepts offers by itself
  klavye:   { cost: 1500, mult: 1.15, tapMult: 2 },// Mekanik klavye
  sandalye: { cost: 6000, mult: 1.25, unlockStage: 1 }
};
export const UPGRADE_ORDER = ['demlik', 'pano', 'klavye', 'sandalye'];

// Event cards: effects only (texts in tr.json under events.<id>)
// v2 adds five "visual" cards (the office shows something: smoke, the cat, a calendar, papers, likes). Texts come
// from Kodhane's event cards. chance: { p, win, lose } = random outcome for that choice. pmHalves: buff lasts half as
// long when there is a Proje Yöneticisi. v2 cards need stage >= 1 (after the five v1 cards).
export const EVENTS = {
  logo:   { a: { projPay: 1.3, projNeed: 1.25 }, b: { buff: { mult: 1.1, sec: 60 } } },
  cuma:   { a: { cashFromProject: 0.25, buff: { mult: 0.7, sec: 90 } }, b: { buff: { mult: 1.1, sec: 60 } } },
  yegen:  { a: { projNeed: 1.3, projPay: 1.15 }, b: {} },
  cay:    { a: { cashPct: 0.05, cashMin: 15, buff: { mult: 1.2, sec: 120 } }, b: { buff: { mult: 0.9, sec: 120 } } },
  acil:   { a: { projProgress: 0.3, buff: { mult: 0.8, sec: 90 } }, b: {} },
  sunucu:   { visual: 'duman', minStage: 1, a: { cashPct: 0.04, cashMin: 50, buff: { mult: 0.7, sec: 20 } }, b: { buff: { mult: 0.6, sec: 45 } } },
  kedi:     { visual: 'kedi', minStage: 1, a: { buff: { mult: 0.9, sec: 20 } },
              b: { chance: { p: 0.3, win: { cashFromProject: 0.5 }, lose: { buff: { mult: 0.75, sec: 30 } } } } },
  toplanti: { visual: 'takvim', minStage: 1, a: { projPay: 1.15, buff: { mult: 0.85, sec: 40 }, pmHalves: true }, b: { projPay: 0.95 } },
  final:    { visual: 'kagit', minStage: 1, a: { projPay: 1.25, projNeed: 1.2 }, b: { cashFromProject: 0.1 } },
  viral:    { visual: 'begeni', minStage: 1, a: { buff: { mult: 1.3, sec: 60 } }, b: { cashFromProject: 0.3 } }
};
export const EVENT_ORDER = ['logo', 'cuma', 'yegen', 'cay', 'acil', 'sunucu', 'kedi', 'toplanti', 'final', 'viral'];

// v2: anonymous stage counter names (kodhane_count_event whitelist): stage 0 = first delivery, then each move.
export const STAGE_COUNTER_PREFIX = 'acikofis_stage_';
