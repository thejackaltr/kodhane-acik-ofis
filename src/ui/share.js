// "Ofisimi paylaş": Phaser snapshot -> branded PNG (stage name + game URL) -> navigator.share, fallback download + copy link.
import { h } from './dom.js';
import { t } from '../logic/i18n.js';
import { STAGES } from '../logic/config.js';

export const UTM = 'utm_source=share&utm_medium=office&utm_campaign=acik-ofis';
export function gameUrl(loc = location) {
  const path = loc.pathname.replace(/index\.html$/, '');
  return loc.origin + path;
}
export function shareUrl(loc = location) { return gameUrl(loc) + '?' + UTM; }
function prettyUrl(loc = location) { return gameUrl(loc).replace(/^https?:\/\//, '').replace(/\/$/, ''); }

export function composeImage(img, state, loc = location, crop = null) {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3a2c3f'); g.addColorStop(1, '#1f1822');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // office image (contain)
  if (img && img.width) {
    const c0 = crop || { x: 0, y: 0, w: img.width, h: img.height };
    const box = { x: 40, y: 170, w: W - 80, h: H - 330 };
    const s = Math.min(box.w / c0.w, box.h / c0.h);
    const w = c0.w * s, hh = c0.h * s;
    x.drawImage(img, c0.x, c0.y, c0.w, c0.h, box.x + (box.w - w) / 2, box.y + (box.h - hh) / 2, w, hh);
  }
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  x.fillStyle = '#ffb35c'; x.font = '700 40px ' + font; x.textAlign = 'center';
  x.fillText(t('meta.title'), W / 2, 72);
  x.fillStyle = '#ffffff'; x.font = '800 64px ' + font;
  x.fillText(t('stages.' + STAGES[state.stage].id), W / 2, 142);
  x.fillStyle = '#f3e6d8'; x.font = '500 36px ' + font;
  x.fillText(t('share.caption', { n: state.staff.length, p: state.projectsDone }), W / 2, H - 100);
  x.fillStyle = '#ffb35c'; x.font = '700 34px ' + font;
  x.fillText(prettyUrl(loc), W / 2, H - 46);
  return c;
}
function toBlob(canvas) { return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png')); }
export async function copyText(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
export function download(blobOrUrl, name) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openShare(ui, ctrl, snapshot) {
  const st = ctrl.state;
  const url = shareUrl();
  const text = t('share.text', { stage: t('stages.' + STAGES[st.stage].id), n: st.staff.length, p: st.projectsDone });
  snapshot((img, crop) => {
    const canvas = composeImage(img, st, location, crop);
    const dataUrl = canvas.toDataURL('image/png');
    window.__lastShare = { url, text, width: canvas.width, height: canvas.height }; // for tests
    ui.showModal((box, close) => {
      box.append(h('h2', { text: t('share.title') }), h('img', { class: 'share-img', src: dataUrl, alt: t('share.title'), 'data-test': 'share-img' }));
      const row = h('div', { class: 'col' });
      if (navigator.share) {
        row.append(h('button', { class: 'btn primary big', 'data-test': 'share-native', onclick: async () => {
          try {
            const blob = await toBlob(canvas);
            const file = blob && typeof File !== 'undefined' ? new File([blob], 'acik-ofis.png', { type: 'image/png' }) : null;
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: t('meta.title'), text: text + ' ' + url });
            else await navigator.share({ title: t('meta.title'), text, url });
          } catch (e) { if (!e || e.name !== 'AbortError') ui.toast(t('share.fail')); }
        } }, t('share.native')));
      }
      row.append(
        h('button', { class: 'btn big' + (navigator.share ? '' : ' primary'), 'data-test': 'share-download', onclick: async () => { download(await toBlob(canvas) || dataUrl, 'acik-ofis.png'); ui.toast(t('share.downloaded'), 'ok'); } }, t('share.download')),
        h('button', { class: 'btn big', 'data-test': 'share-copy', onclick: async () => { const ok = await copyText(text + ' ' + url); ui.toast(ok ? t('share.copied') : url, ok ? 'ok' : ''); } }, t('share.copy')),
        h('button', { class: 'btn ghost', onclick: close }, t('share.close')));
      box.append(row);
    }, { cls: 'share' });
  });
}
