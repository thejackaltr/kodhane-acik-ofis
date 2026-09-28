import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const tr = JSON.parse(fs.readFileSync(new URL('./src/locales/tr.json', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
function sha() { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return 'dev'; } }
const VERSION = pkg.version + '-' + (process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : sha()) + '-' + Date.now().toString(36);
const lookup = (k) => k.split('.').reduce((o, p) => (o ? o[p] : undefined), tr);

// %t:key% placeholders in index.html come from tr.json (no hardcoded UI text)
const i18nHtml = { name: 'i18n-html', transformIndexHtml: (html) => html.replace(/%t:([\w.]+)%/g, (m, k) => { const v = lookup(k); if (typeof v !== 'string') throw new Error('missing tr key ' + k); return v.replace(/"/g, '&quot;'); }) };

// write dist/sw.js with a versioned precache list of every built file
const swPlugin = {
  name: 'sw-precache',
  apply: 'build',
  closeBundle() {
    const dist = path.resolve('dist');
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(dist, p).split(path.sep).join('/')); } })(dist);
    const list = ['./', ...files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).map((f) => './' + f)];
    const src = fs.readFileSync('sw.template.js', 'utf8').replace('__VERSION__', VERSION).replace('__PRECACHE__', JSON.stringify(list, null, 0));
    fs.writeFileSync(path.join(dist, 'sw.js'), src);
    console.log('sw.js: ' + list.length + ' files, version ' + VERSION);
  }
};

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [i18nHtml, swPlugin],
  build: { target: 'es2019', assetsInlineLimit: 0, chunkSizeWarningLimit: 1600, sourcemap: false }
});
