/**
 * Unified search.
 *
 * Backed by one FTS5 index spanning channels, films and box sets, so a query
 * across a quarter of a million items returns in single-digit milliseconds
 * instead of scanning every title in the renderer.
 */

import { h, icon, clear } from '../util/dom.js';
import { timeHM, relativeDay, tidyChannelName } from '../util/format.js';
import { channelRow } from '../ui/cards.js';
import { emptyState, spinnerBlock } from '../ui/feedback.js';
import { movieCard, seriesCard } from './home.js';
import { playChannel } from '../playback.js';
import * as store from '../state.js';

export async function renderSearch(host, { query }) {
  clear(host);
  const page = h('div.page');
  host.appendChild(page);

  const term = String(query || '').trim();
  if (term.length < 2) {
    page.appendChild(
      emptyState('search', 'Search your whole line',
        'Type at least two characters to search live channels, films, box sets and everything coming up in the TV guide.')
    );
    return;
  }

  page.appendChild(
    h('div.page__head', h('div.page__title', h('h1', 'Search'), h('p', `Results for “${term}”`)))
  );

  const resultsHost = h('div');
  page.appendChild(resultsHost);
  resultsHost.appendChild(spinnerBlock('Searching…'));

  const started = performance.now();
  let results = { live: [], movie: [], series: [] };
  let programmes = [];

  try {
    [results, programmes] = await Promise.all([
      store.searchCatalogue(term, 60),
      store.state.epg.ready ? store.epgSearch(term, 60).catch(() => []) : Promise.resolve([])
    ]);
  } catch (err) {
    clear(resultsHost).appendChild(emptyState('alert', 'Search failed', err.message));
    return;
  }

  const elapsed = performance.now() - started;
  clear(resultsHost);

  const total = results.live.length + results.movie.length + results.series.length + programmes.length;
  if (!total) {
    resultsHost.appendChild(
      emptyState('search', 'No matches',
        `Nothing on this line matches “${term}”. Try a shorter or differently spelled term.`)
    );
    return;
  }

  resultsHost.appendChild(
    h('p.dim', { style: { fontSize: '11.5px', marginBottom: '18px' } },
      `${total} result${total === 1 ? '' : 's'} in ${elapsed.toFixed(0)} ms`)
  );

  // ------------------------------------------------------------- channels
  if (results.live.length) {
    const list = h('div.col.gap-1');
    let epgMap = {};
    if (store.state.epg.ready) {
      try {
        epgMap = await store.epgNowNext(results.live.map((c) => String(c.id)));
      } catch {
        /* optional */
      }
    }
    const ids = results.live.map((c) => String(c.id));
    results.live.forEach((channel, i) =>
      list.appendChild(
        channelRow(channel, {
          epg: epgMap[String(channel.id)],
          index: i,
          onPlay: () => playChannel(channel, { ids })
        })
      )
    );
    resultsHost.appendChild(section('Live channels', results.live.length, list));
  }

  if (results.movie.length) {
    resultsHost.appendChild(
      section('Films', results.movie.length, h('div.grid', results.movie.map(movieCard)))
    );
  }

  if (results.series.length) {
    resultsHost.appendChild(
      section('Box sets', results.series.length, h('div.grid', results.series.map(seriesCard)))
    );
  }

  // ------------------------------------------------------------ programmes
  if (programmes.length) {
    const ids = [...new Set(programmes.map((p) => String(p.streamId)))];
    const channels = await store.fetchByIds('live', ids).catch(() => []);
    const byId = new Map(channels.map((c) => [String(c.id), c]));

    const list = h('div.col.gap-1');
    programmes.forEach((p) => {
      const channel = byId.get(String(p.streamId));
      list.appendChild(
        h('button.result-row',
          { onclick: () => channel && playChannel(channel, { query: {} }) },
          h('span.result-row__time', `${relativeDay(p.s)} ${timeHM(p.s)}`),
          h('span.result-row__body',
            h('span.result-row__title.truncate', p.t),
            h('span.result-row__sub.truncate',
              `${p.channel || (channel ? tidyChannelName(channel.name) : '')} · until ${timeHM(p.e)}`)),
          icon('play', 15))
      );
    });
    resultsHost.appendChild(section('Coming up in the guide', programmes.length, list));
  } else if (!store.state.epg.ready) {
    resultsHost.appendChild(
      h('p.dim', { style: { fontSize: '12.5px', marginTop: '20px' } },
        'Load the TV guide to also search programmes that are coming up.')
    );
  }
}

function section(title, count, content) {
  return h('section.search-section',
    h('div.search-section__head', title, h('span.count', String(count))),
    content);
}
