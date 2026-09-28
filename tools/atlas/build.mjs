// Builds public/assets/atlas.png + atlas.json (Phaser JSON hash), src/data/mobilya.json and PWA icons
// from the procedural art in art.js. Uses a local Chrome/Chromium via playwright-core.
// Usage: node tools/atlas/build.mjs   (CHROME=/path/to/chrome to override)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tools/atlas/art.js'), 'utf8') });

const out = await page.evaluate(() => {
  const { frames, meta } = window.ART;
  const PAD = 2, EX = 1, W = 1024;
  const names = Object.keys(frames).sort((a, b) => frames[b].h - frames[a].h || a.localeCompare(b));
  // shelf packing
  let x = PAD, y = PAD, rowH = 0; const pos = {};
  for (const n of names) {
    const f = frames[n], cw = f.w + 2 * EX, ch = f.h + 2 * EX;
    if (x + cw + PAD > W) { x = PAD; y += rowH + PAD; rowH = 0; }
    pos[n] = { x: x + EX, y: y + EX }; x += cw + PAD; rowH = Math.max(rowH, ch);
  }
  let H = y + rowH + PAD; H = Math.pow(2, Math.ceil(Math.log2(H)));
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = H;
  const a = atlas.getContext('2d');
  const json = { frames: {}, meta: { app: 'acik-ofis tools/atlas/build.mjs', image: 'atlas.png', format: 'RGBA8888', size: { w: W, h: H }, scale: '1' } };
  for (const n of names) {
    const f = frames[n], c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const ctx = c.getContext('2d'); f.draw(ctx);
    const p = pos[n];
    a.drawImage(c, p.x, p.y);
    // 1px extrude
    a.drawImage(c, 0, 0, f.w, 1, p.x, p.y - 1, f.w, 1);
    a.drawImage(c, 0, f.h - 1, f.w, 1, p.x, p.y + f.h, f.w, 1);
    a.drawImage(c, 0, 0, 1, f.h, p.x - 1, p.y, 1, f.h);
    a.drawImage(c, f.w - 1, 0, 1, f.h, p.x + f.w, p.y, 1, f.h);
    json.frames[n] = { frame: { x: p.x, y: p.y, w: f.w, h: f.h }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h },
      anchor: { x: +(f.pivot[0] / f.w).toFixed(4), y: +(f.pivot[1] / f.h).toFixed(4) } };
  }
  // icons: mini scene on warm background
  function icon(size, maskable) {
    const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size); g.addColorStop(0, '#ffb35c'); g.addColorStop(1, '#e0663a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const s = size / 512 * (maskable ? 0.72 : 0.95);
    ctx.save(); ctx.translate(size / 2, size / 2 + 40 * s); ctx.scale(s * 1.35, s * 1.35);
    const draw = (n, x, y) => { const f = frames[n], cc = document.createElement('canvas'); cc.width = f.w; cc.height = f.h; f.draw(cc.getContext('2d')); ctx.drawImage(cc, x - f.pivot[0], y - f.pivot[1]); };
    for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) draw('zemin_parke_0' + (((gx + gy) & 1) + 1), (gx - gy) * 64, (gx + gy) * 32);
    draw('calisan_kurucu_calis_01', -64 + 64, -6);
    draw('masa_kurucu_01', -64, 0);
    draw('kedi_ofis_yat_01', 70, 60);
    ctx.restore();
    return c.toDataURL('image/png');
  }
  return { png: atlas.toDataURL('image/png'), json, meta,
    icons: { 'icon-192.png': icon(192), 'icon-512.png': icon(512), 'icon-maskable-512.png': icon(512, true), 'apple-touch-icon.png': icon(180) } };
});
await browser.close();
const b64 = (d) => Buffer.from(d.split(',')[1], 'base64');
fs.writeFileSync(path.join(root, 'public/assets/atlas.png'), b64(out.png));
fs.writeFileSync(path.join(root, 'public/assets/atlas.json'), JSON.stringify(out.json));
fs.writeFileSync(path.join(root, 'src/data/mobilya.json'), JSON.stringify(out.meta, null, 1) + '\n');
for (const [n, d] of Object.entries(out.icons)) fs.writeFileSync(path.join(root, 'public/icons', n), b64(d));
console.log('frames:', Object.keys(out.json.frames).length, 'atlas:', out.json.meta.size, 'png bytes:', b64(out.png).length);
