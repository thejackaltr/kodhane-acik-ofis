// Cloud save UI (ask step around minute 5 + menu panel). Non-technical copy from tr.json.
import { h, clear, add } from '../ui/dom.js';
import { t } from '../logic/i18n.js';

function hhmm(ts) { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

export class CloudUI {
  constructor(sync) {
    this.sync = sync; this.box = null; this.mode = null; this.ui = null;
    sync.onChange(() => {
      if (this.box && this.box.isConnected) this.render();
      if (sync.toastKey && this.ui) { this.ui.toast(t(sync.toastKey), 'ok'); sync.toastKey = ''; }
    });
  }
  renderAsk(ui) { return (box, close) => { this.ui = ui; this.mode = 'ask'; this.box = box; this.close = close; this.render(); }; }
  renderPanel(ui) { this.ui = ui; ui.showModal((box, close) => { this.mode = 'panel'; this.box = box; this.close = close; this.render(); }, { cls: 'cloud' }); }
  render() {
    const s = this.sync, box = clear(this.box);
    box.classList.add('cloud');
    if (s.signedIn()) {
      const u = s.client.user;
      let st = t('cloud.ready');
      if (s.status === 'syncing') st = t('cloud.syncing');
      else if (s.status === 'error') st = t(s.message || 'cloud.unreachable');
      else if (s.lastPushAt) st = t('cloud.synced', { t: hhmm(s.lastPushAt) });
      add(box, h('h2', { text: t('cloud.menu') }), h('p', { text: t('cloud.signedIn', { email: u.email || '' }) }),
        h('p', { class: 'sync ' + (s.status === 'error' ? 'err' : 'ok'), 'data-test': 'cloud-status', text: st }),
        h('p', { class: 'dim', text: t('cloud.sameAccount') }),
        h('button', { class: 'btn primary', onclick: () => { s.ctrl.save(); s.reconciled ? s.pushNow(true) : s.reconcile(); } }, t('cloud.syncNow')),
        h('button', { class: 'btn ghost', onclick: () => s.signOut() }, t('cloud.signOut')),
        h('button', { class: 'btn ghost', onclick: () => this.close() }, t('menu.close')));
      return;
    }
    add(box, h('h2', { text: t('cloud.askTitle') }));
    if (this.mode === 'ask') add(box, h('p', { 'data-test': 'cloud-ask', text: t('cloud.askText') }));
    const msg = h('p', { class: 'msg' + (s.status === 'error' ? ' err' : ''), 'data-test': 'cloud-msg', text: s.message ? t(s.message) : '' });
    if (s.pendingEmail && s.status !== 'sending') {
      const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', 'aria-label': t('cloud.codeLabel'), placeholder: '••••••', class: 'code', 'data-test': 'cloud-code' });
      input.addEventListener('input', () => { const v = input.value.replace(/\D+/g, '').slice(0, 6); if (v !== input.value) input.value = v; if (v.length === 6 && s.status !== 'verifying') go(); });
      const go = async () => { const ok = await s.verify(input.value); if (ok && this.close) this.close(); };
      const left = Math.max(0, Math.ceil((s.cooldownUntil - Date.now()) / 1000));
      const resend = h('button', { class: 'btn ghost', disabled: left > 0, onclick: () => s.sendCode(s.pendingEmail) }, left > 0 ? t('cloud.resendIn', { s: left }) : t('cloud.resend'));
      if (left > 0) setTimeout(() => { if (this.box && this.box.isConnected && s.pendingEmail) this.render(); }, 1000);
      add(box, h('p', null, t('cloud.sent') + ' ', h('b', { text: s.pendingEmail })), h('p', { class: 'dim', text: t('cloud.spam') }),
        h('form', { class: 'col', onsubmit: (e) => { e.preventDefault(); go(); } },
          h('label', { class: 'dim', text: t('cloud.codeLabel') }), input,
          h('button', { class: 'btn primary', type: 'submit', disabled: s.status === 'verifying' }, s.status === 'verifying' ? t('cloud.verifying') : t('cloud.verify'))),
        msg.textContent === t('cloud.sent') ? null : msg, resend,
        h('button', { class: 'btn ghost', onclick: () => { s.setPending(''); s.set('guest'); } }, t('cloud.changeEmail')));
      setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
    } else {
      const input = h('input', { type: 'email', autocomplete: 'email', 'aria-label': t('cloud.emailLabel'), placeholder: t('cloud.emailPh'), 'data-test': 'cloud-email' });
      add(box, h('form', { class: 'col', novalidate: true, onsubmit: (e) => { e.preventDefault(); s.sendCode(input.value.trim()); } },
        h('label', { class: 'dim', text: t('cloud.emailLabel') }), input,
        h('button', { class: 'btn primary', type: 'submit', disabled: s.status === 'sending', 'data-test': 'cloud-send' }, s.status === 'sending' ? t('cloud.sending') : t('cloud.send'))), msg,
        h('p', { class: 'dim', text: t('cloud.guestNote') }));
    }
    add(box, h('button', { class: 'btn ghost', 'data-test': 'cloud-later', onclick: () => this.close() }, this.mode === 'ask' ? t('cloud.later') : t('menu.close')));
  }
}
