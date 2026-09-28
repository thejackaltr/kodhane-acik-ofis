// Kodhane: Açık Ofis — all game numbers in one place (no UI text here; text lives in src/locales/tr.json).
export const SAVE_VERSION = 1;

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
  deskCostGrowth: 1.45
};

// Employee types. kod/tasarim = work units per second. cost = first hire price.
export const STAFF = {
  kurucu:    { kod: 1,  tasarim: 0.4, cost: 0,     hireable: false },
  stajyer:   { kod: 1,  tasarim: 0.3, cost: 40,    hireable: true },
  junior:    { kod: 4.5, tasarim: 0.8, cost: 450,  hireable: true, unlockEarned: 150 },
  tasarimci: { kod: 1,  tasarim: 7,   cost: 1100,  hireable: true, unlockEarned: 500 },
  kidemli:   { kod: 16, tasarim: 2,   cost: 3800,  hireable: true, unlockEarned: 2000 },
  yzajan:    { kod: 60, tasarim: 12,  cost: 30000, hireable: true, unlockStage: 1, unlockEarned: 20000 }
};
// Promotion chain (in place, no new desk): stajyer -> junior -> kidemli
export const PROMOTE = { stajyer: 'junior', junior: 'kidemli' };
export const PROMOTE_DISCOUNT = 0.8; // promoting costs 80% of the target's hire price
export const STAFF_ORDER = ['stajyer', 'junior', 'tasarimci', 'kidemli', 'yzajan'];

// Desks: the first one (founder) is free and fixed. Extra desks cost deskBase * growth^(extra-1).
export const DESK = { base: 30, founderKind: 'masa_kurucu_01', kinds: ['masa_tekli_laptop_01', 'masa_tekli_monitor_01'] };

// One office floor on a fixed 10x10 grid. Stage = how much of it is usable + the look.
export const GRID = { w: 10, h: 10 };
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
  }
];
// Later stages shown as "yakında" in the UI (no art in v1).
export const FUTURE_STAGES = ['ajans'];

// One-time upgrades (Ofis panel)
export const UPGRADES = {
  demlik:   { cost: 120,  mult: 1.10 },            // Demlik çay: +10% team speed
  pano:     { cost: 600,  autoAccept: true },      // Proje panosu: team accepts offers by itself
  klavye:   { cost: 1500, mult: 1.15, tapMult: 2 },// Mekanik klavye
  sandalye: { cost: 6000, mult: 1.25, unlockStage: 1 }
};
export const UPGRADE_ORDER = ['demlik', 'pano', 'klavye', 'sandalye'];

// Event cards: effects only (texts in tr.json under events.<id>)
export const EVENTS = {
  logo:   { a: { projPay: 1.3, projNeed: 1.25 }, b: { buff: { mult: 1.1, sec: 60 } } },
  cuma:   { a: { cashFromProject: 0.25, buff: { mult: 0.7, sec: 90 } }, b: { buff: { mult: 1.1, sec: 60 } } },
  yegen:  { a: { projNeed: 1.3, projPay: 1.15 }, b: {} },
  cay:    { a: { cashPct: 0.05, cashMin: 15, buff: { mult: 1.2, sec: 120 } }, b: { buff: { mult: 0.9, sec: 120 } } },
  acil:   { a: { projProgress: 0.3, buff: { mult: 0.8, sec: 90 } }, b: {} }
};
export const EVENT_ORDER = ['logo', 'cuma', 'yegen', 'cay', 'acil'];
