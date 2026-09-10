/**
 * Live TV — category rail on the left, paged channel list on the right.
 *
 * Nothing is held in the renderer: categories and channel pages are queried
 * from the SQLite catalogue as the user scrolls, so a 50,000-channel line
 * behaves the same as a 50-channel one.
 */

import { h, icon, clear } from '../util/dom.js';
import { debounce } from '../util/format.js';
import { channelRow } from '../ui/cards.js';
import { emptyState, spinnerBlock, toastErr } from '../ui/feedback.js';
import { playChannel } from '../playback.js';
import * as store from '../state.js';

const ALL = '__all__';
const FAVS = '__fav__';
const RECENT = '__recent__';
const PAGE = 100;

let lastCategory = ALL;
let lastGroupId = null;
let lastFilter = '';

export async function renderLive(host) {
  clear(host);
  const page = h('div.page.page--flush');
  host.appendChild(page);
  page.appendChild(spinnerBlock('Loading channels…'));

  if (!store.state.catalogue.channels) {
    clear(page).appendChild(
      emptyState('tv', 'No channels yet', 'Your catalogue has not been downloaded. Use Refresh in the toolbar.',
        h('button.btn.btn--primary', { onclick: () => store.syncCatalogue(true).then(() => renderLive(host)) }, 'Download now'))
    );
    return;
  }

  try {
    if (!store.state.categories.live.length) await store.loadCategories('live');
    if (!store.state.groups.length) await store.loadGroups();
  } catch (err) {
    clear(page).appendChild(emptyState('alert', 'Could not load categories', err.message));
    return;
  }

  // ---------------------------------------------------------------- layout
  const catList = h('div.live-cats__list.thin-scroll');
  const catSearch = h('input', { type: 'text', placeholder: 'Filter categories…', spellcheck: false });

  const listScroll = h('div.live-list__scroll');
  const listBody = h('div.col.gap-1');
  const sentinel = h('div', { style: { height: '1px' } });
  listScroll.append(listBody, sentinel);

  const countLabel = h('span.dim', { style: { fontSize: '12.5px' } }, '');
  const titleLabel = h('h2', { style: { fontSize: '17px' } }, 'All channels');
  const search = h('input', { type: 'text', placeholder: 'Filter these channels…', spellcheck: false, value: lastFilter });
  const epgHint = h('span.badge', '');

  const manageBtn = h(
    'button.btn.btn--sm',
    { onclick: () => import('./manage.js').then((m) => m.openChannelManager(() => renderLive(host))) },
    icon('sliders', 14),
    'Manage'
  );

  const layout = h(
    'div.live-layout',
    h('aside.live-cats',
      h('div.live-cats__head', h('div.live-cats__search', icon('search', 14), catSearch)),
      catList),
    h('section.live-list',
      h('div.live-list__head',
        h('div.col.gap-1', titleLabel, countLabel),
        h('div.row.gap-3', epgHint, manageBtn,
          h('div.live-cats__search', { style: { width: '230px' } }, icon('search', 14), search))),
      listScroll)
  );
  clear(page).appendChild(layout);

  // ------------------------------------------------------------ categories
  const buildCategories = (filter) => {
    const needle = filter.trim().toLowerCase();
    clear(catList);

    const specials = [
      { id: ALL, name: 'All channels', count: store.state.catalogue.channels, iconName: 'tv' },
      { id: FAVS, name: 'Favourites', count: store.state.favorites.live.length, iconName: 'heart' },
      { id: RECENT, name: 'Recently watched', count: store.state.recentChannels.length, iconName: 'history' }
    ];

    for (const s of specials) {
      if (needle && !s.name.toLowerCase().includes(needle)) continue;
      catList.appendChild(
        h('button.cat-item',
          { class: lastCategory === s.id && lastGroupId == null ? 'active' : '', onclick: () => select(s.id, s.name) },
          icon(s.iconName, 15),
          h('span.cat-item__name', s.name),
          h('span.cat-item__count', String(s.count)))
      );
    }

    if (store.state.groups.length) {
      catList.appendChild(h('div.nav__section', { style: { padding: '14px 12px 6px' } }, 'My groups'));
      for (const g of store.state.groups) {
        if (needle && !g.name.toLowerCase().includes(needle)) continue;
        catList.appendChild(
          h('button.cat-item',
            { class: lastGroupId === g.id ? 'active' : '', onclick: () => selectGroup(g) },
            icon('list', 15),
            h('span.cat-item__name', g.name),
            h('span.cat-item__count', String(g.count)))
        );
      }
    }

    catList.appendChild(h('div.nav__section', { style: { padding: '14px 12px 6px' } }, 'Provider categories'));
    for (const cat of store.state.categories.live) {
      if (needle && !cat.name.toLowerCase().includes(needle)) continue;
      catList.appendChild(
        h('button.cat-item',
          { class: lastCategory === cat.id && lastGroupId == null ? 'active' : '', onclick: () => select(cat.id, cat.name) },
          h('span.cat-item__name', cat.name),
          h('span.cat-item__count', String(cat.count)))
      );
    }
  };

  catSearch.addEventListener('input', debounce(() => buildCategories(catSearch.value), 160));

  // --------------------------------------------------------------- paging
  let offset = 0;
  let total = 0;
  let loading = false;
  let exhausted = false;
  let token = 0;

  const queryFor = () => {
    const q = {};
    if (lastGroupId != null) q.groupId = lastGroupId;
    else if (lastCategory !== ALL && lastCategory !== FAVS && lastCategory !== RECENT) q.category = lastCategory;
    if (search.value.trim()) q.search = search.value.trim();
    return q;
  };

  /** Favourites and recents are explicit id lists, not a category filter. */
  const pinnedIds = () =>
    lastCategory === FAVS ? store.state.favorites.live
      : lastCategory === RECENT ? store.state.recentChannels
        : null;

  const appendRows = async (rows) => {
    if (!rows.length) return;
    const ids = rows.map((r) => String(r.id));
    let epgMap = {};
    if (store.state.epg.ready) {
      try {
        epgMap = await store.epgNowNext(ids);
      } catch {
        /* guide is optional */
      }
    }
    const frag = document.createDocumentFragment();
    rows.forEach((channel, i) => {
      frag.appendChild(
        channelRow(channel, {
          epg: epgMap[String(channel.id)],
          index: offset + i,
          onPlay: () => playChannel(channel, { query: queryFor(), ids: pinnedIds() })
        })
      );
    });
    listBody.appendChild(frag);
  };

  const loadMore = async () => {
    if (loading || exhausted) return;
    loading = true;
    const mine = token;
    try {
      const pinned = pinnedIds();
      if (pinned) {
        const slice = pinned.slice(offset, offset + PAGE);
        if (!slice.length) {
          exhausted = true;
        } else {
          const rows = await store.fetchByIds('live', slice);
          if (mine !== token) return;
          const needle = search.value.trim().toLowerCase();
          await appendRows(needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows);
          offset += slice.length;
          if (offset >= pinned.length) exhausted = true;
        }
        total = pinned.length;
      } else {
        const result = await store.fetchChannels({ ...queryFor(), limit: PAGE, offset });
        if (mine !== token) return;
        total = result.total;
        await appendRows(result.rows);
        offset += result.rows.length;
        if (result.rows.length < PAGE) exhausted = true;
      }
      countLabel.textContent = `${total.toLocaleString()} channel${total === 1 ? '' : 's'}`;
      if (!total) {
        clear(listBody).appendChild(
          emptyState('search', 'No channels here',
            search.value.trim() ? `Nothing matches “${search.value}”.` : 'This category is empty.')
        );
      }
    } catch (err) {
      toastErr('Could not load channels', err.message);
      exhausted = true;
    } finally {
      loading = false;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { root: listScroll, rootMargin: '800px' }
  );
  observer.observe(sentinel);

  const reset = () => {
    token += 1;
    offset = 0;
    exhausted = false;
    total = 0;
    clear(listBody);
    listScroll.scrollTop = 0;
    epgHint.textContent = store.state.epg.ready ? 'Guide active' : 'Guide not loaded';
    loadMore();
  };

  const select = (id, name) => {
    lastCategory = id;
    lastGroupId = null;
    titleLabel.textContent = name;
    buildCategories(catSearch.value);
    reset();
  };

  const selectGroup = (g) => {
    lastGroupId = g.id;
    lastCategory = ALL;
    titleLabel.textContent = g.name;
    buildCategories(catSearch.value);
    reset();
  };

  search.addEventListener('input', debounce(() => {
    lastFilter = search.value;
    reset();
  }, 220));

  buildCategories('');
  const initialName =
    lastGroupId != null ? (store.state.groups.find((g) => g.id === lastGroupId) || {}).name || 'Group'
      : lastCategory === ALL ? 'All channels'
        : lastCategory === FAVS ? 'Favourites'
          : lastCategory === RECENT ? 'Recently watched'
            : (store.state.categories.live.find((c) => c.id === lastCategory) || {}).name || 'All channels';
  titleLabel.textContent = initialName;
  reset();

  // stop observing once the view is replaced
  const watcher = new MutationObserver(() => {
    if (!document.body.contains(layout)) {
      observer.disconnect();
      watcher.disconnect();
    }
  });
  watcher.observe(host, { childList: true });
}
