// Umami (analiz.teserix.com): script tag, SW rule, event hooks, and track() safety when Umami is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { track, tracked, queued, flush, clearTracked, WEBSITE_ID, DOMAINS } from '../../src/analytics.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('index.html: one Umami script, Açık Ofis id + domains, defer, before </body>, no localhost', () => {
  const html = read('index.html');
  const tags = html.match(/<script[^>]*analiz\.teserix\.com[^>]*><\/script>/g) || [];
  assert.equal(tags.length, 1);
  const tag = tags[0];
  assert.match(tag, /\sdefer[\s>]/);
  assert.ok(tag.includes('src="https://analiz.teserix.com/script.js"'));
  assert.ok(tag.includes(`data-website-id="${WEBSITE_ID}"`));
  assert.equal(WEBSITE_ID, '5ebd71d2-4e8f-4822-a110-1f2c7d56f94e');
  assert.ok(tag.includes(`data-domains="${DOMAINS}"`));
  assert.equal(DOMAINS, 'acikofis.teserix.com,thejackaltr.github.io');
  assert.ok(!tag.includes('localhost'));
  assert.ok(html.indexOf(tag) < html.indexOf('</body>'));
  // only this game's id
  assert.ok(!html.includes('6a036eb3-5974-482f-bcce-dbdf0a383f36') && !html.includes('04257fdf-e069-4ecb-9b6a-196aa1e83242'));
});

test('service worker never caches cross-origin (Umami script / api)', () => {
  const sw = read('sw.template.js');
  assert.ok(sw.includes('if (url.origin !== location.origin) return;'));
  assert.ok(!sw.includes('analiz.teserix.com/script.js\''));
});

test('track() is a no-op when window.umami is absent', () => {
  clearTracked();
  const had = 'window' in globalThis; const prev = globalThis.window;
  globalThis.window = {};
  try { assert.doesNotThrow(() => track('game_start')); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
  assert.deepEqual(tracked(), ['game_start']);
  assert.doesNotThrow(() => track('share_click'));   // no window at all
});

test('events fired before the tracker is ready are queued (bounded) and flushed once it loads', () => {
  clearTracked();
  const prev = globalThis.window;
  globalThis.window = {};
  try {
    track('game_start');
    for (let i = 0; i < 40; i++) track('share_click');
    assert.equal(queued().length, 20);
    const calls = [];
    globalThis.window.umami = { track: (...a) => calls.push(a) };
    assert.equal(flush(), true);
    assert.deepEqual(calls[0], ['game_start']);
    assert.equal(calls.length, 20);
    assert.equal(queued().length, 0);
  } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
});

test('track() forwards only the event name; a throwing umami is swallowed', () => {
  const calls = [];
  const prev = globalThis.window;
  globalThis.window = { umami: { track: (...a) => calls.push(a) } };
  clearTracked();
  try {
    track('cloud_save');
    assert.deepEqual(calls, [['cloud_save']]);
    globalThis.window.umami.track = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => track('login_success'));
  } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
});

test('events wired at real action sites (names only)', () => {
  const src = ['src/main.js', 'src/cloud/cloud.js', 'src/cloud/resetFlow.js', 'src/ui/share.js', 'src/cloud/leaderboard.js'].map(read).join('\n');
  const names = [...new Set([...src.matchAll(/\btrack\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(names, ['cloud_save', 'game_start', 'login_success', 'reset_or_prestige', 'share_click']);
  assert.ok(!/\btrack\('[a-z_]+'\s*,/.test(src), 'no payloads');
});
