/** Films and box sets — paged poster grids backed by the SQLite catalogue. */

import { h, icon, clear } from '../util/dom.js';
import { debounce } from '../util/format.js';
import { chipBar } from '../ui/cards.js';
import { emptyState, spinnerBlock, toastErr } from '../ui/feedback.js';
import { movieCard, seriesCard } from './home.js';
import * as store from '../state.js';

const ALL = '__all__';
const FAVS = '__fav__';
const PAGE = 60;

const SORTS = [
  { id: 'added', label: 'Recently added' },
  { id: 'name', label: 'A – Z' },
  { id: 'rating', label: 'Top rated' },
  { id: 'year', label: 'Newest first' }
];

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

  const totalInDb = kind === 'movie' ? store.state.catalogue.movies : store.state.catalogue.series;
  if (!totalInDb) {
    clear(page).appendChild(
      emptyState(kind === 'movie' ? 'film' : 'series', 'Nothing in this library',
        'Your line did not return any titles for this section, or the catalogue has not been downloaded yet.')
    );
    return;
  }

  try {
    if (!store.state.categories[kind].length) await store.loadCategories(kind);
  } catch {
    /* categories are optional — the grid still works */
  }

  const st = viewState[kind];

  const gridHost = h('div.grid');
  const sentinel = h('div', { style: { height: '1px' } });
  const countLabel = h('p.dim', { style: { fontSize: '13px' } }, '');

  const filterInput = h('input', {
    type: 'text',
    placeholder: kind === 'movie' ? 'Filter films…' : 'Filter box sets…',
    spellcheck: false,
    value: st.filter
  });

  const sortSelect = h(
    'select.select',
    { onchange: (e) => { st.sort = e.target.value; reset(); } },
    SORTS.map((s) => h('option', { value: s.id, selected: s.id === st.sort }, s.label))
  );

  const chipHost = h('div');
  const refreshChips = () => {
    const items = [
      { id: ALL, label: 'All', count: totalInDb },
      { id: FAVS, label: 'Favourites', count: (store.state.favorites[kind] || []).length },
      ...store.state.categories[kind].map((c) => ({ id: c.id, label: c.name, count: c.count }))
    ];
    clear(chipHost).appendChild(
      chipBar(items, st.category, (id) => {
        st.category = id;
        refreshChips();
        reset();
      })
    );
  };
  refreshChips();

  clear(page).append(
    h('div.page__head',
      h('div.page__title', h('h1', kind === 'movie' ? 'Films' : 'Box sets'), countLabel),
      h('div.row.gap-3',
        h('div.live-cats__search', { style: { width: '250px', height: '38px' } }, icon('search', 14), filterInput),
        sortSelect)),
    chipHost,
    h('div', { style: { height: '20px' } }),
    gridHost,
    sentinel
  );

  // --------------------------------------------------------------- paging
  let offset = 0;
  let total = 0;
  let loading = false;
  let exhausted = false;
  let token = 0;

  const loadMore = async () => {
    if (loading || exhausted) return;
    loading = true;
    const mine = token;
    try {
      let rows = [];
      if (st.category === FAVS) {
        const ids = (store.state.favorites[kind] || []).slice(offset, offset + PAGE);
        rows = ids.length ? await store.fetchByIds(kind, ids) : [];
        total = (store.state.favorites[kind] || []).length;
        offset += ids.length;
        if (!ids.length || offset >= total) exhausted = true;
      } else {
        const result = await store.fetchTitles(kind, {
          category: st.category === ALL ? null : st.category,
          search: st.filter.trim() || undefined,
          sort: st.sort,
          limit: PAGE,
          offset
        });
        if (mine !== token) return;
        rows = result.rows;
        total = result.total;
        offset += rows.length;
        if (rows.length < PAGE) exhausted = true;
      }
      if (mine !== token) return;

      countLabel.textContent = `${total.toLocaleString()} ${kind === 'movie' ? 'film' : 'title'}${total === 1 ? '' : 's'}`;

      if (!total) {
        gridHost.className = '';
        clear(gridHost).appendChild(
          emptyState('search', 'Nothing found',
            st.filter.trim() ? `No titles match “${st.filter}”.` : 'This category is empty.')
        );
        return;
      }

      gridHost.className = 'grid';
      const frag = document.createDocumentFragment();
      for (const row of rows) frag.appendChild(kind === 'movie' ? movieCard(row) : seriesCard(row));
      gridHost.appendChild(frag);
    } catch (err) {
      toastErr('Could not load titles', err.message);
      exhausted = true;
    } finally {
      loading = false;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { root: host, rootMargin: '900px' }
  );
  observer.observe(sentinel);

  function reset() {
    token += 1;
    offset = 0;
    exhausted = false;
    total = 0;
    gridHost.className = 'grid';
    clear(gridHost);
    host.scrollTop = 0;
    loadMore();
  }

  filterInput.addEventListener('input', debounce(() => {
    st.filter = filterInput.value;
    reset();
  }, 240));

  reset();

  const watcher = new MutationObserver(() => {
    if (!document.body.contains(gridHost)) {
      observer.disconnect();
      watcher.disconnect();
    }
  });
  watcher.observe(host, { childList: true });
}
