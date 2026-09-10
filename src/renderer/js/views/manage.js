/**
 * Channel manager.
 *
 * With 50,000 channels across 875 provider categories, curation is what makes
 * the app usable. Hide the dead and duplicate channels, renumber the ones you
 * actually watch, and collect them into your own groups.
 */

import { h, icon, clear } from '../util/dom.js';
import { debounce } from '../util/format.js';
import { openModal, closeModal, toast, toastOk, toastErr, confirmDialog, spinnerBlock } from '../ui/feedback.js';
import { logoNode } from '../ui/cards.js';
import * as store from '../state.js';

const PAGE = 80;

export async function openChannelManager(onClose) {
  const body = openModal(spinnerBlock('Loading channels…'), { onClose });

  try {
    if (!store.state.categories.live.length) await store.loadCategories('live');
    await store.loadGroups();
  } catch (err) {
    clear(body).appendChild(h('div', { style: { padding: '40px' } }, h('p', err.message)));
    return;
  }

  const selection = new Set();
  let category = null;
  let filter = '';
  let showHidden = false;
  let offset = 0;
  let total = 0;
  let loading = false;
  let exhausted = false;
  let token = 0;

  // ---------------------------------------------------------------- chrome
  const listHost = h('div.col.gap-1', { style: { padding: '0 4px' } });
  const sentinel = h('div', { style: { height: '1px' } });
  const scroll = h('div.thin-scroll',
    { style: { flex: '1', overflowY: 'auto', minHeight: '0', padding: '4px 0' } },
    listHost, sentinel);

  const countLabel = h('span.dim', { style: { fontSize: '12.5px' } }, '');
  const selLabel = h('span.badge', '0 selected');

  const catSelect = h('select.select', { style: { maxWidth: '260px' } },
    h('option', { value: '' }, `All channels (${store.state.catalogue.channels.toLocaleString()})`),
    store.state.categories.live.map((c) => h('option', { value: c.id }, `${c.name} (${c.count})`)));

  const filterInput = h('input', { type: 'text', placeholder: 'Find a channel…', spellcheck: false });

  const hiddenToggle = h('button.chip', { onclick: () => { showHidden = !showHidden; syncToggles(); reset(); } },
    'Show hidden');

  const syncToggles = () => hiddenToggle.classList.toggle('active', showHidden);

  // ------------------------------------------------------------ list paging
  const rowFor = (channel) => {
    const checked = selection.has(String(channel.id));
    const box = h('span.checkbox', { class: checked ? 'on' : '' }, icon('check', 11));

    const numInput = h('input', {
      type: 'text',
      value: String(channel.num ?? ''),
      style: {
        width: '52px', textAlign: 'center', background: 'var(--bg-void)',
        border: '1px solid var(--glass-border)', borderRadius: '6px', padding: '5px 4px',
        fontSize: '12px', color: 'var(--text-2)'
      },
      onclick: (e) => e.stopPropagation(),
      onchange: async (e) => {
        const n = parseInt(e.target.value, 10);
        try {
          await store.setChannelNumber(channel.id, Number.isFinite(n) ? n : null);
          toast('Number updated', `${channel.name} is now ${Number.isFinite(n) ? n : 'unnumbered'}.`);
        } catch (err) {
          toastErr('Could not set number', err.message);
        }
      }
    });

    const nameInput = h('input', {
      type: 'text',
      value: channel.name,
      style: {
        flex: '1', minWidth: '0', background: 'transparent', border: '1px solid transparent',
        borderRadius: '6px', padding: '6px 8px', fontSize: '13.5px', color: 'var(--text-1)'
      },
      onclick: (e) => e.stopPropagation(),
      onfocus: (e) => { e.target.style.borderColor = 'var(--glass-border)'; e.target.style.background = 'var(--bg-void)'; },
      onblur: async (e) => {
        e.target.style.borderColor = 'transparent';
        e.target.style.background = 'transparent';
        const next = e.target.value.trim();
        if (!next || next === channel.name) return;
        try {
          await store.renameChannel(channel.id, next);
          channel.name = next;
          toast('Renamed', next);
        } catch (err) {
          toastErr('Could not rename', err.message);
        }
      }
    });

    const row = h('div.chan',
      {
        style: { opacity: channel.hidden ? '0.45' : '1', cursor: 'pointer' },
        onclick: () => {
          const key = String(channel.id);
          if (selection.has(key)) selection.delete(key);
          else selection.add(key);
          box.classList.toggle('on', selection.has(key));
          selLabel.textContent = `${selection.size} selected`;
        }
      },
      box,
      numInput,
      h('span.chan__logo', logoNode(channel)),
      nameInput,
      channel.hidden ? h('span.badge', 'Hidden') : null
    );
    return row;
  };

  const loadMore = async () => {
    if (loading || exhausted) return;
    loading = true;
    const mine = token;
    try {
      const result = await store.fetchChannels({
        category,
        search: filter || undefined,
        includeHidden: true,
        limit: PAGE,
        offset
      });
      if (mine !== token) return;

      const rows = showHidden ? result.rows.filter((r) => r.hidden) : result.rows;
      total = result.total;
      offset += result.rows.length;
      if (result.rows.length < PAGE) exhausted = true;

      const frag = document.createDocumentFragment();
      for (const channel of rows) frag.appendChild(rowFor(channel));
      listHost.appendChild(frag);

      countLabel.textContent = `${total.toLocaleString()} channel${total === 1 ? '' : 's'}`;
      if (!listHost.children.length && exhausted) {
        listHost.appendChild(h('p.dim', { style: { padding: '30px', textAlign: 'center' } }, 'Nothing here.'));
      }
    } catch (err) {
      toastErr('Could not load channels', err.message);
      exhausted = true;
    } finally {
      loading = false;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
    { root: scroll, rootMargin: '600px' }
  );
  observer.observe(sentinel);

  const reset = () => {
    token += 1;
    offset = 0;
    exhausted = false;
    clear(listHost);
    scroll.scrollTop = 0;
    loadMore();
  };

  catSelect.onchange = () => { category = catSelect.value || null; reset(); };
  filterInput.addEventListener('input', debounce(() => { filter = filterInput.value.trim(); reset(); }, 240));

  // ---------------------------------------------------------------- actions
  const requireSelection = () => {
    if (!selection.size) {
      toast('Nothing selected', 'Click channels in the list to select them first.');
      return false;
    }
    return true;
  };

  const actions = h('div.row.gap-3.wrap', { style: { padding: '16px 0 0' } },
    h('button.btn.btn--sm', {
      onclick: async () => {
        if (!requireSelection()) return;
        const n = selection.size;
        await store.setChannelsHidden([...selection], true);
        selection.clear();
        selLabel.textContent = '0 selected';
        toastOk('Hidden', `${n} channel${n === 1 ? '' : 's'} hidden from every list.`);
        reset();
      }
    }, icon('x', 14), 'Hide selected'),

    h('button.btn.btn--sm', {
      onclick: async () => {
        if (!requireSelection()) return;
        const n = selection.size;
        await store.setChannelsHidden([...selection], false);
        selection.clear();
        selLabel.textContent = '0 selected';
        toastOk('Restored', `${n} channel${n === 1 ? '' : 's'} unhidden.`);
        reset();
      }
    }, icon('check', 14), 'Unhide selected'),

    h('button.btn.btn--sm', {
      onclick: async () => {
        if (!requireSelection()) return;
        const name = await promptText('New group', 'Name this group', 'My channels');
        if (!name) return;
        const id = await store.createGroup(name);
        await store.addToGroup(id, [...selection]);
        toastOk('Group created', `${name} · ${selection.size} channels`);
        selection.clear();
        selLabel.textContent = '0 selected';
        renderGroups();
      }
    }, icon('list', 14), 'Group selected'),

    h('div.grow'),

    h('button.btn.btn--sm.btn--danger', {
      onclick: async () => {
        const yes = await confirmDialog({
          title: 'Reset all customisation?',
          message: 'Hidden channels, custom names, custom numbers and ordering will all be forgotten. Your groups are kept.',
          confirmText: 'Reset',
          danger: true
        });
        if (!yes) return;
        await store.resetChannelPrefs();
        toast('Reset', 'All channel customisation cleared.');
        reset();
      }
    }, icon('refresh', 14), 'Reset all')
  );

  // ----------------------------------------------------------------- groups
  const groupsHost = h('div.row.gap-2.wrap', { style: { padding: '12px 0 0' } });

  const renderGroups = () => {
    clear(groupsHost);
    if (!store.state.groups.length) {
      groupsHost.appendChild(h('p.dim', { style: { fontSize: '12px' } },
        'No groups yet — select some channels and choose “Group selected”.'));
      return;
    }
    for (const g of store.state.groups) {
      groupsHost.appendChild(
        h('span.chip', { style: { cursor: 'default' } },
          g.name,
          h('span.chip__count', String(g.count)),
          h('button.iconbtn', {
            style: { width: '20px', height: '20px' },
            title: `Add ${selection.size} selected`,
            onclick: async () => {
              if (!requireSelection()) return;
              await store.addToGroup(g.id, [...selection]);
              toastOk('Added', `${selection.size} channel(s) added to ${g.name}.`);
              selection.clear();
              selLabel.textContent = '0 selected';
              renderGroups();
            }
          }, icon('check', 12)),
          h('button.iconbtn', {
            style: { width: '20px', height: '20px' },
            title: 'Delete group',
            onclick: async () => {
              const yes = await confirmDialog({
                title: `Delete “${g.name}”?`,
                message: 'The group is removed. The channels themselves are untouched.',
                confirmText: 'Delete',
                danger: true
              });
              if (!yes) return;
              await store.deleteGroup(g.id);
              renderGroups();
            }
          }, icon('trash', 12)))
      );
    }
  };
  renderGroups();

  // ----------------------------------------------------------------- layout
  clear(body).append(
    h('div', { style: { display: 'flex', flexDirection: 'column', height: 'min(78vh, 760px)', padding: '28px 30px' } },
      h('div.page__head', { style: { marginBottom: '14px' } },
        h('div.page__title',
          h('h1', { style: { fontSize: '23px' } }, 'Manage channels'),
          h('p', 'Hide what you never watch, renumber what you do, and build your own groups.')),
        selLabel),

      h('div.row.gap-3', { style: { marginBottom: '12px' } },
        catSelect,
        h('div.live-cats__search', { style: { width: '240px' } }, icon('search', 14), filterInput),
        hiddenToggle,
        h('div.grow'),
        countLabel),

      scroll,
      actions,
      h('div.card__title', { style: { marginTop: '18px', marginBottom: '0' } }, icon('list'), 'Your groups'),
      groupsHost)
  );

  syncToggles();
  reset();

  const watcher = new MutationObserver(() => {
    if (!document.body.contains(scroll)) {
      observer.disconnect();
      watcher.disconnect();
    }
  });
  watcher.observe(document.getElementById('modalBody'), { childList: true });
}

/** Small promise-based text prompt matching the app's styling. */
function promptText(title, label, placeholder) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const input = h('input', {
      type: 'text',
      placeholder: placeholder || '',
      style: {
        width: '100%', height: '44px', padding: '0 14px', borderRadius: '10px',
        background: 'var(--bg-void)', border: '1px solid var(--glass-border)',
        fontSize: '14px', color: 'var(--text)'
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') done(input.value.trim() || null);
        if (e.key === 'Escape') done(null);
      }
    });

    openModal(
      h('div', { style: { padding: '28px' } },
        h('h2', { style: { fontSize: '19px', marginBottom: '6px' } }, title),
        h('p.dim', { style: { fontSize: '13px', marginBottom: '16px' } }, label),
        input,
        h('div.row.gap-3', { style: { marginTop: '22px', justifyContent: 'flex-end' } },
          h('button.btn.btn--ghost', { onclick: () => done(null) }, 'Cancel'),
          h('button.btn.btn--primary', { onclick: () => done(input.value.trim() || null) }, 'Create'))),
      { small: true, onClose: () => done(null) }
    );
    setTimeout(() => input.focus(), 60);
  });
}
