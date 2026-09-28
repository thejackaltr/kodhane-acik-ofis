// Umami (analiz.teserix.com): thin wrapper. Event names only — never email, nickname, or ids.
// If the script is blocked/offline, track is a no-op and the game runs unchanged.
// The tracker is a deferred script placed after the game module, so it runs after main.js: events fired before it
// is ready (game_start) wait in a small in-memory queue and are sent when the script's load event fires.
export const WEBSITE_ID = '5ebd71d2-4e8f-4822-a110-1f2c7d56f94e';
export const DOMAINS = 'acikofis.teserix.com,thejackaltr.github.io';
export const SCRIPT_SRC = 'https://analiz.teserix.com/script.js';
const QUEUE_MAX = 20;

const recent = [];
const queue = [];
let hooked = false;
function umami() {
  try { const u = typeof window !== 'undefined' ? window.umami : null; return u && typeof u.track === 'function' ? u : null; } catch (e) { return null; }
}
function send(u, name) { try { u.track(name); } catch (e) { /* ignore */ } }
export function flush() {
  const u = umami(); if (!u) return false;
  while (queue.length) send(u, queue.shift());
  return true;
}
function hookLoad() {
  if (hooked || typeof document === 'undefined' || !document.querySelector) return;
  hooked = true;
  const el = document.querySelector('script[src="' + SCRIPT_SRC + '"]');
  if (el) el.addEventListener('load', flush);
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('load', flush);   // fallback
}
export function track(name) {
  if (typeof name !== 'string' || !name) return;
  recent.push(name); if (recent.length > 50) recent.shift();
  const u = umami();
  if (u) { flush(); send(u, name); return; }
  if (queue.length < QUEUE_MAX) queue.push(name);   // blocked/offline: stays in memory, dropped with the page
  hookLoad();
}
export function tracked() { return recent.slice(); }
export function queued() { return queue.slice(); }
export function clearTracked() { recent.length = 0; queue.length = 0; }
