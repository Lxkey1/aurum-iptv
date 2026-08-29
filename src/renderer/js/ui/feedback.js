/** Toasts, the shared modal, and the titlebar status pill. */

import { $, h, clear, icon } from '../util/dom.js';

// ------------------------------------------------------------------ toasts

const toastRoot = () => $('#toasts');

export function toast(title, message, kind = 'info', ms = 4200) {
  const node = h(
    `div.toast.toast--${kind}`,
    h('span.toast__icon', icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info')),
    h('div.grow', h('div.toast__title', title), message ? h('div.toast__msg', message) : null)
  );
  toastRoot().appendChild(node);

  const remove = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  };
  const timer = setTimeout(remove, ms);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

export const toastOk = (t, m) => toast(t, m, 'ok');
export const toastErr = (t, m) => toast(t, m, 'err', 6500);

// ------------------------------------------------------------------- modal

let modalOnClose = null;

export function openModal(content, { small = false, onClose } = {}) {
  const root = $('#modalRoot');
  const panel = $('#modalPanel');
  const body = $('#modalBody');

  panel.classList.toggle('modal__panel--sm', Boolean(small));
  clear(body);
  body.appendChild(content);
  root.classList.add('open');
  modalOnClose = onClose || null;
  return body;
}

export function closeModal() {
  const root = $('#modalRoot');
  if (!root.classList.contains('open')) return;
  root.classList.remove('open');
  if (modalOnClose) {
    const fn = modalOnClose;
    modalOnClose = null;
    fn();
  }
}

export const isModalOpen = () => $('#modalRoot').classList.contains('open');

/** Promise-based confirm dialog styled like the rest of the app. */
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const content = h(
      'div',
      { style: { padding: '28px' } },
      h('h2', { style: { fontSize: '19px', marginBottom: '10px' } }, title),
      h('p.muted', { style: { fontSize: '13.5px', lineHeight: '1.6' } }, message),
      h(
        'div.row.gap-3',
        { style: { marginTop: '24px', justifyContent: 'flex-end' } },
        h('button.btn.btn--ghost', { onclick: () => done(false) }, 'Cancel'),
        h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, { onclick: () => done(true) }, confirmText)
      )
    );

    openModal(content, { small: true, onClose: () => done(false) });
  });
}

// ----------------------------------------------------------- status pill

let statusResetTimer = null;

export function setStatus(text, state = 'idle', autoResetMs = 0) {
  const pill = $('#globalStatus');
  const label = $('#globalStatusText');
  if (!pill || !label) return;
  label.textContent = text;
  pill.dataset.state = state;

  clearTimeout(statusResetTimer);
  if (autoResetMs) {
    statusResetTimer = setTimeout(() => {
      label.textContent = 'Ready';
      pill.dataset.state = 'idle';
    }, autoResetMs);
  }
}

// ------------------------------------------------------------- boilerplate

export function emptyState(iconName, title, message, action) {
  return h(
    'div.empty',
    h('div.empty__icon', icon(iconName)),
    h('h3', title),
    message ? h('p', message) : null,
    action || null
  );
}

export function loadingGrid(count = 12) {
  return h(
    'div.grid',
    Array.from({ length: count }, () => h('div', h('div.skel.skel--poster'), h('div.skel.skel--line'), h('div.skel.skel--line', { style: { width: '60%' } })))
  );
}

export function loadingRows(count = 10) {
  return h('div', Array.from({ length: count }, () => h('div.skel.skel--row')));
}

export function spinnerBlock(text = 'Loading…') {
  return h(
    'div.empty',
    h('div.spinner.spinner--lg'),
    h('p', { style: { marginTop: '6px' } }, text)
  );
}
