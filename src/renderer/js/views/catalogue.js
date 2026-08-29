/** Movies and Series browsers — same shell, different data source. */

import { h, icon, clear } from '../util/dom.js';
import { debounce } from '../util/format.js';
import { chipBar, lazyList } from '../ui/cards.js';
import { emptyState, spinnerBlock } from '../ui/feedback.js';
import { movieCard, seriesCard } from './home.js';
import * as store from '../state.js';

const ALL = '__all__';
const FAVS = '__fav__';

const SORTS = {
  movie: [
    { id: 'added', label: 'Recently added' },
    { id: 'name', label: 'A – Z' },
    { id: 'rating', label: 'Top rated' },
    { id: 'year', label: 'Newest first' }
  ],
  series: [
    { id: 'added', label: 'Recently added' },
    { id: 'name', label: 'A – Z' },
    { id: 'rating', label: 'Top rated' },
    { id: 'year', label: 'Newest first' }
  ]
};

const viewState = {
  movie: { category: ALL, sort: 'added', filter: '' },
  series: { category: ALL, sort: 'added', filter: '' }
};

export const renderMovies = (host) => renderCatalogue(host, 'movie');
export const renderSeries = (host) => renderCatalogue(host, 'series');

async function renderCatalogue(host, kind) {
  clear(host);
  const page = h('div.page');
  host.appendChild(page);
  page.appendChild(spinnerBlock(kind === 'movie' ? 'Loading films…' : 'Loading box sets…'));

  try {
    if (kind === 'movie') await store.ensureMovies();
    else await store.ensureSeries();
  } catch (err) {
    clear(page).appendChild(
      emptyState('alert', 'Could not load this library', err.message,
        h('button.btn.btn--primary', { onclick: () => renderCatalogue(host, kind) }, 'Try again'))
    );
    return;
  }

  const items = kind === 'movie' ? store.state.movies : store.state.series;
  const categories = kind === 'movie' ? store.state.vodCategories : store.state.seriesCategories;
  const st = viewState[kind];

  if (!items.length) {
    clear(page).appendChild(
      emptyState(kind === 'movie' ? 'film' : 'series', 'Nothing in this library',
        'Your line did not return any titles for this section.')
    );
    return;
  }

  const idOf = (item) => (kind === 'movie' ? item.stream_id : item.series_id);

  // ------------------------------------------------------------- controls
  const counts = new Map();
  for (const item of items) {
    const cat = String(item.category_id ?? '');
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  const chipItems = [
    { id: ALL, label: 'All', count: items.length },
    { id: FAVS, label: 'Favourites', count: (store.state.favorites[kind] || []).length },
    ...categories
      .map((c) => ({
        id: String(c.category_id),
        label: c.category_name || 'Unnamed',
        count: counts.get(String(c.category_id)) || 0
      }))
      .filter((c) => c.count > 0)
  ];

  const gridHost = h('div.grid');
  const countLabel = h('p.dim', { style: { fontSize: '13px' } }, '');

  const filterInput = h('input', {
    type: 'text',
    placeholder: kind === 'movie' ? 'Filter films…' : 'Filter box sets…',
    spellcheck: false,
    value: st.filter
  });

  const sortSelect = h(
    'select.select',
    { onchange: (e) => { st.sort = e.target.value; paint(); } },
    SORTS[kind].map((s) => h('option', { value: s.id, selected: s.id === st.sort }, s.label))
  );

  const chipHost = h('div');
  function refreshChips() {
    clear(chipHost).appendChild(
      chipBar(chipItems, st.category, (id) => {
        st.category = id;
        refreshChips();
        paint();
      })
    );
  }
  refreshChips();

  clear(page).append(
    h(
      'div.page__head',
      h('div.page__title',
        h('h1', kind === 'movie' ? 'Films' : 'Box sets'),
        countLabel),
      h(
        'div.row.gap-3',
        h('div.live-cats__search', { style: { width: '250px', height: '38px' } }, icon('search', 14), filterInput),
        sortSelect
      )
    ),
    chipHost,
    h('div', { style: { height: '20px' } }),
    gridHost
  );

  // -------------------------------------------------------------- painting
  function paint() {
    let list = items;

    if (st.category === FAVS) {
      const favs = new Set((store.state.favorites[kind] || []).map(String));
      list = list.filter((item) => favs.has(String(idOf(item))));
    } else if (st.category !== ALL) {
      list = list.filter((item) => String(item.category_id ?? '') === String(st.category));
    }

    const needle = st.filter.trim().toLowerCase();
    if (needle) list = list.filter((item) => String(item.name || '').toLowerCase().includes(needle));

    list = sortItems(list, st.sort, kind);

    countLabel.textContent = `${list.length.toLocaleString()} ${kind === 'movie' ? 'film' : 'title'}${list.length === 1 ? '' : 's'}`;

    if (!list.length) {
      clear(gridHost);
      gridHost.className = '';
      gridHost.appendChild(
        emptyState('search', 'Nothing found',
          needle ? `No titles match “${st.filter}”.` : 'This category is empty.')
      );
      return;
    }

    gridHost.className = 'grid';
    lazyList(gridHost, list, (item) => (kind === 'movie' ? movieCard(item) : seriesCard(item)), { chunk: 40 });
  }

  filterInput.addEventListener('input', debounce(() => {
    st.filter = filterInput.value;
    paint();
  }, 200));

  paint();
}

function sortItems(list, sort, kind) {
  const copy = [...list];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));
    case 'rating':
      return copy.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    case 'year':
      return copy.sort((a, b) => yearOf(b, kind) - yearOf(a, kind));
    case 'added':
    default:
      return copy.sort((a, b) => addedOf(b, kind) - addedOf(a, kind));
  }
}

function yearOf(item, kind) {
  const raw = kind === 'movie' ? item.year || item.releaseDate : item.releaseDate || item.year;
  const n = Number(String(raw || '').slice(0, 4));
  return Number.isFinite(n) ? n : 0;
}

function addedOf(item, kind) {
  const raw = kind === 'movie' ? item.added : item.last_modified || item.added;
  return Number(raw) || 0;
}
