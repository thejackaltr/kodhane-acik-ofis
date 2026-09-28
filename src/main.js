// Kodhane: Açık Ofis — entry point.
import Phaser from 'phaser';
const LOCALES = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });
import { registerLocales, detect, setLocale, setPseudo, setPointerFine, locale, t } from './logic/i18n.js';
import { Controller } from './game.js';
import { OfficeScene } from './render/OfficeScene.js';
import { UI } from './ui/ui.js';
import { CloudSync, rememberReferral } from './cloud/cloud.js';
import { CloudUI } from './cloud/cloudUi.js';
import { LeaderboardUI } from './cloud/leaderboard.js';
import { createSaveApi, resolveMode } from './cloud/resetApi.js';
import { ResetFlow } from './cloud/resetFlow.js';
import { SAVE_KEY } from './logic/save.js';
import './style.css';

// Locales: every src/locales/<code>.json is picked up automatically (tr = source + fallback).
const LOCALE_KEY = 'acik_ofis_locale';
registerLocales(Object.fromEntries(Object.entries(LOCALES).map(([p, d]) => [p.match(/([\w-]+)\.json$/)[1], d])));
let storedLocale = null; try { storedLocale = localStorage.getItem(LOCALE_KEY); } catch (e) { /* private mode */ }
setLocale(detect(navigator.languages || [navigator.language], storedLocale));
rememberReferral(location.search); // came from Kodhane? (local flag only)
// mouse/trackpad: "tıkla" texts instead of "dokun"
try { const mq = window.matchMedia('(pointer: fine)'); setPointerFine(mq.matches); if (mq.addEventListener) mq.addEventListener('change', (e) => setPointerFine(e.matches)); } catch (e) { /* old browsers: touch texts */ }
const pseudo = new URLSearchParams(location.search).get('pseudo'); if (pseudo) setPseudo(pseudo); // layout test aid
document.documentElement.lang = locale();
document.title = t('meta.title');
{ const md = document.querySelector('meta[name=description]'); if (md) md.setAttribute('content', t('meta.description')); const bt = document.getElementById('boot'); if (bt) bt.textContent = t('meta.loading'); }
function changeLocale(code) { try { localStorage.setItem(LOCALE_KEY, code); } catch (e) { /* ignore */ } ctrl.save(); location.reload(); }

const DPR = Math.min(2, window.devicePixelRatio || 1);   // capped at 2
const storage = (() => { try { return window.localStorage; } catch (e) { return { getItem: () => null, setItem: () => {}, removeItem: () => {} }; } })();
const ctrl = new Controller(storage);
// v2.2: reset/restore only through Backend's RPC.reset / RPC.restore (cloud.js) (VITE_RESET_MOCK=1: in-browser mock; see cloud/resetApi.js)
const cloud = new CloudSync(ctrl, null, { saveApi: (client) => createSaveApi({ mode: resolveMode(), client, storage }) });
const resetApi = cloud.saveApi;
const cloudUi = new CloudUI(cloud);
const resetFlow = new ResetFlow(ctrl, resetApi, { storage, beforeReset: () => cloud.cancelPending(), pushNow: () => cloud.pushNow(true), ui: {
  undoShown: (p) => ui.showUndo(p, () => resetFlow.undo()),
  undoGone: () => ui.hideUndo(),
  restored: () => ui.toast(t('reset.restored'), 'ok'),
  otherDevice: () => { ui.hideUndo(); ui.toast(t('reset.otherDevice'), '', 6000); },
  failed: (key) => ui.toast(t(key), '', 4000)
} });
// 409 on a push: load the server copy; it is the cloud copy, so do not push it straight back
cloud.onStale = (cur) => resetFlow.handleStale(cur).then((ok) => { if (ok) cloud.lastSig = cloud.sig(ctrl.state); });
// another tab of this browser saved: if it reset/restored (newer revision), load it instead of overwriting it
window.addEventListener('storage', (e) => { if (e.key === SAVE_KEY) ctrl.checkStale(); });

const parent = document.getElementById('game');
const size = () => ({ w: Math.max(1, parent.clientWidth), h: Math.max(1, parent.clientHeight) });
let scene = null;

// install prompt (Android/desktop Chrome) + iOS hint
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
const install = {
  available: () => !!deferredPrompt,
  prompt: async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ } deferredPrompt = null; },
  ios: () => isIos
};

const lbHolder = { show: () => leaderboard && leaderboard.show() };
let leaderboard = null;
const ui = new UI(document.getElementById('ui'), ctrl, {
  cloud: cloudUi,
  leaderboard: lbHolder,
  install,
  zoom: (f) => scene && scene.zoomBy(f, scene.scale.width / 2, scene.scale.height / 2),
  fit: () => scene && scene.fitView(),
  snapshot: (cb) => snapshot(cb),
  onReset: () => resetFlow.reset(),
  resetContext: () => ({ signedIn: cloud.signedIn(), email: cloud.client.user ? cloud.client.user.email : '' }),
  changeLocale
});

leaderboard = new LeaderboardUI(cloud, ui);
resetFlow.resume();   // reloaded inside the 10 s undo window -> the undo toast comes back
// v2: anonymous stage counter (event name only; no user id, works for guests too)
ctrl.on('count', (name) => { cloud.client.countEvent(name).catch(() => {}); });
ctrl.countStage();

const s0 = size();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  backgroundColor: '#2a2230',
  scale: { mode: Phaser.Scale.NONE, width: s0.w * DPR, height: s0.h * DPR, zoom: 1 / DPR },
  render: { antialias: true, roundPixels: false, powerPreference: 'default' },
  input: { activePointers: 3 },
  disableContextMenu: true,
  banner: false,
  fps: { target: 60, smoothStep: true },
  scene: new OfficeScene(ctrl, {
    dpr: DPR,
    padTop: 96, padBottom: 90,
    onInfo: (hit) => ui.showInfo(hit),
    onPlaceFail: (reason) => reason !== 'ayni' && ui.toast(reason === 'para' ? t('place.noMoney') : t('place.bad')),
    onReady: (sc) => { scene = sc; window.__acikOfis.scene = sc; document.body.classList.add('ready'); }
  })
});
function resize() {
  const s = size();
  game.scale.resize(s.w * DPR, s.h * DPR);
  game.scale.setZoom(1 / DPR);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// Share snapshot: fit whole room, hide helpers, grab the canvas, restore.
function snapshot(cb) {
  if (!scene) { cb(null); return; }
  const cam = scene.cameras.main, prev = { z: cam.zoom, x: cam.scrollX, y: cam.scrollY, uz: scene.userZoom };
  const arrowVis = scene.arrow.visible; scene.arrow.setVisible(false);
  for (const b of scene.bubbles) b.setAlpha(0);
  const b = scene.bounds;
  const W = scene.scale.width, H = scene.scale.height;
  const z = Math.min(W / (b.w + 40), H / (b.h + 40));
  cam.setZoom(z); cam.centerOn(b.cx, b.cy);
  const cw = Math.min(W, (b.w + 40) * z), ch = Math.min(H, (b.h + 40) * z);
  const crop = { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch };  // just the room, not the empty canvas
  game.renderer.snapshot((img) => {
    cam.setZoom(prev.z); cam.scrollX = prev.x; cam.scrollY = prev.y; scene.userZoom = prev.uz;
    scene.arrow.setVisible(arrowVis); for (const bb of scene.bubbles) bb.setAlpha(1);
    cb(img, crop);
  });
}

// Pause the loop while hidden; on return compute offline progress from timestamps.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ctrl.save(); game.loop.sleep(); }
  else { ctrl.resume(Date.now()); game.loop.wake(); }
});
window.addEventListener('pagehide', () => ctrl.save());

// Welcome back on load (computed in the controller constructor)
if (ctrl.pendingWelcome) ui.showWelcome(ctrl.pendingWelcome);

// Test/debug handle (no secrets; read-only helpers + controller)
window.__acikOfis = { ctrl, ui, cloud, leaderboard, game, resetFlow, scene: null, version: __APP_VERSION__ };

// Service worker (production only): versioned cache-first; show "new version" toast.
let updateRequested = false;
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const offer = (w) => {
        const bar = document.createElement('div'); bar.className = 'update';
        const btn = document.createElement('button'); btn.className = 'btn primary'; btn.textContent = t('update.reload');
        btn.onclick = () => { updateRequested = true; w.postMessage('skipWaiting'); };
        bar.append(document.createTextNode(t('update.ready') + ' '), btn); document.body.appendChild(bar);
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
    }).catch(() => {});
    // Reload only when the player tapped "Yenile" (never on the first install's clients.claim()).
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested && !reloaded) { reloaded = true; ctrl.save(); location.reload(); } });
  });
}
