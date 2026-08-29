/** Live TV: category rail on the left, channel list with now/next on the right. */

import { h, icon, clear, $ } from '../util/dom.js';
import { debounce, tidyChannelName } from '../util/format.js';
import { channelRow, lazyList } from '../ui/cards.js';
import { emptyState, spinnerBlock, toastErr } from '../ui/feedback.js';
import { playChannel } from '../playback.js';
import * as store from '../state.js';

const ALL = '__all__';
const FAVS = '__fav__';
const RECENT = '__recent__';

let lastCategory = ALL;
let lastFilter = '';

export async function renderLive(host) {
  clear(host);
  const page = h('div.page.page--flush');
  host.appendChild(page);
  page.appendChild(spinnerBlock('Loading channels…'));

  try {
    await store.ensureLive();
  } catch (err) {
    clear(page).appendChild(
      emptyState('alert', 'Could not load channels', err.message,
        h('button.btn.btn--primary', { onclick: () => renderLive(host) }, 'Try again'))
    );
    return;
  }

  const channels = store.state.liveChannels;
  if (!channels.length) {
    clear(page).appendChild(emptyState('tv', 'No live channels', 'This line did not return any live streams.'));
    return;
  }

  // -------------------------------------------------------------- layout
  const catList = h('div.live-cats__list.thin-scroll');
  const catSearch = h('input', { type: 'text', placeholder: 'Filter categories…', spellcheck: false });

  const listScroll = h('div.live-list__scroll');
  const listBody = h('div.col.gap-1');
  listScroll.appendChild(listBody);

  const countLabel = h('span.dim', { style: { fontSize: '12.5px' } }, '');
  const titleLabel = h('h2', { style: { fontSize: '17px' } }, 'All channels');
  const search = h('input', {
    type: 'text',
    placeholder: 'Filter these channels…',
    spellcheck: false,
    value: lastFilter
  });

  const epgHint = h('span.badge', '');

  const layout = h(
    'div.live-layout',
    h(
      'aside.live-cats',
      h('div.live-cats__head', h('div.live-cats__search', icon('search', 14), catSearch)),
      catList
    ),
    h(
      'section.live-list',
      h(
        'div.live-list__head',
        h('div.col.gap-1', titleLabel, countLabel),
        h(
          'div.row.gap-3',
          epgHint,
          h('div.live-cats__search', { style: { width: '240px' } }, icon('search', 14), search)
        )
      ),
      listScroll
    )
  );

  clear(page).appendChild(layout);

  // ----------------------------------------------------------- categories
  const counts = new Map();
  for (const c of channels) counts.set(c._cat, (counts.get(c._cat) || 0) + 1);

  const buildCategories = (filter) => {
    const needle = filter.trim().toLowerCase();
    clear(catList);

    const specials = [
      { id: ALL, name: 'All channels', count: channels.length, iconName: 'tv' },
      { id: FAVS, name: 'Favourites', count: store.state.favorites.live.length, iconName: 'heart' },
      { id: RECENT, name: 'Recently watched', count: store.state.recentChannels.length, iconName: 'history' }
    ];

    for (const s of specials) {
      if (needle && !s.name.toLowerCase().includes(needle)) continue;
      catList.appendChild(
        h(
          'button.cat-item',
          { class: lastCategory === s.id ? 'active' : '', onclick: () => selectCategory(s.id, s.name) },
          icon(s.iconName, 15),
          h('span.cat-item__name', s.name),
          h('span.cat-item__count', String(s.count))
        )
      );
    }

    catList.appendChild(h('div', { style: { height: '10px' } }));

    for (const cat of store.state.liveCategories) {
      const id = String(cat.category_id);
      const name = cat.category_name || 'Unnamed';
      if (needle && !name.toLowerCase().includes(needle)) continue;
      catList.appendChild(
        h(
          'button.cat-item',
          { class: lastCategory === id ? 'active' : '', onclick: () => selectCategory(id, name) },
          h('span.cat-item__name', name),
          h('span.cat-item__count', String(counts.get(id) || 0))
        )
      );
    }
  };

  catSearch.addEventListener('input', debounce(() => buildCategories(catSearch.value), 160));

  // ------------------------------------------------------------- rendering
  let currentList = [];
  let epgMap = {};

  const resolveList = (categoryId) => {
    if (categoryId === FAVS) {
      return store.state.favorites.live.map((id) => store.state.liveById.get(String(id))).filter(Boolean);
    }
    if (categoryId === RECENT) {
      return store.state.recentChannels.map((id) => store.state.liveById.get(String(id))).filter(Boolean);
    }
    if (categoryId === ALL) return channels;
    return channels.filter((c) => c._cat === String(categoryId));
  };

  const paint = () => {
    const needle = search.value.trim().toLowerCase();
    const filtered = needle
      ? currentList.filter((c) => String(c.name).toLowerCase().includes(needle))
      : currentList;

    countLabel.textContent = `${filtered.length.toLocaleString()} channel${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      clear(listBody).appendChild(
        emptyState('search', 'No channels here', needle ? `Nothing matches “${search.value}”.` : 'This category is empty.')
      );
      return;
    }

    lazyList(
      listBody,
      filtered,
      (channel, i) =>
        channelRow(channel, {
          epg: epgMap[String(channel.stream_id)],
          index: i,
          onPlay: () => playChannel(channel, filtered)
        }),
      { chunk: 50, scrollHost: listScroll }
    );
  };

  const loadEpg = async (list) => {
    if (!store.state.epg.ready) {
      epgHint.textContent = 'Guide not loaded';
      epgHint.title = 'Load the TV guide from the Guide page or Settings to see now/next here.';
      return;
    }
    epgHint.textContent = 'Guide active';
    try {
      epgMap = await store.epgNowNext(list.slice(0, 900).map((c) => String(c.stream_id)));
      paint();
    } catch {
      epgMap = {};
    }
  };

  const selectCategory = (id, name) => {
    lastCategory = id;
    titleLabel.textContent = name;
    currentList = resolveList(id);
    buildCategories(catSearch.value);
    listScroll.scrollTop = 0;
    epgMap = {};
    paint();
    loadEpg(currentList);
  };

  search.addEventListener('input', debounce(() => {
    lastFilter = search.value;
    paint();
  }, 180));

  buildCategories('');
  const initialName =
    lastCategory === ALL ? 'All channels'
      : lastCategory === FAVS ? 'Favourites'
        : lastCategory === RECENT ? 'Recently watched'
          : (store.state.liveCategories.find((c) => String(c.category_id) === lastCategory) || {}).category_name || 'All channels';
  selectCategory(lastCategory, initialName);

  // Keep now/next fresh while the page is open.
  const ticker = setInterval(() => {
    if (!document.body.contains(layout)) {
      clearInterval(ticker);
      return;
    }
    loadEpg(currentList);
  }, 120000);
}
