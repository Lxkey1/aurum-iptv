/** Unified search across channels, films, box sets and the TV guide. */

import { h, icon, clear } from '../util/dom.js';
import { timeHM, relativeDay, tidyChannelName } from '../util/format.js';
import { channelRow, lazyList } from '../ui/cards.js';
import { emptyState, spinnerBlock } from '../ui/feedback.js';
import { movieCard, seriesCard } from './home.js';
import { playChannel } from '../playback.js';
import * as store from '../state.js';

const LIMIT = 60;

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

  // Load whatever is not cached yet, but do not block on failures.
  await Promise.allSettled([store.ensureLive(), store.ensureMovies(), store.ensureSeries()]);

  const needle = term.toLowerCase();
  const match = (value) => String(value || '').toLowerCase().includes(needle);

  const channels = store.state.liveChannels.filter((c) => match(c.name));
  const movies = store.state.movies.filter((m) => match(m.name));
  const series = store.state.series.filter((s) => match(s.name));

  let programmes = [];
  if (store.state.epg.ready) {
    try {
      programmes = await store.epgSearch(term, 120);
    } catch {
      programmes = [];
    }
  }

  clear(resultsHost);

  const total = channels.length + movies.length + series.length + programmes.length;
  if (!total) {
    resultsHost.appendChild(
      emptyState('search', 'No matches',
        `Nothing on this line matches “${term}”. Try a shorter or differently spelled term.`)
    );
    return;
  }

  // ------------------------------------------------------------- channels
  if (channels.length) {
    const list = h('div.col.gap-1');
    const shown = channels.slice(0, LIMIT);
    let epgMap = {};
    try {
      if (store.state.epg.ready) epgMap = await store.epgNowNext(shown.map((c) => String(c.stream_id)));
    } catch {
      /* optional */
    }
    shown.forEach((channel, i) =>
      list.appendChild(
        channelRow(channel, {
          epg: epgMap[String(channel.stream_id)],
          index: i,
          onPlay: () => playChannel(channel, channels)
        })
      )
    );
    resultsHost.appendChild(section('Live channels', channels.length, list, channels.length > LIMIT));
  }

  // ---------------------------------------------------------------- films
  if (movies.length) {
    const grid = h('div.grid');
    lazyList(grid, movies.slice(0, 120), (movie) => movieCard(movie), { chunk: 30 });
    resultsHost.appendChild(section('Films', movies.length, grid, movies.length > 120));
  }

  // -------------------------------------------------------------- box sets
  if (series.length) {
    const grid = h('div.grid');
    lazyList(grid, series.slice(0, 120), (item) => seriesCard(item), { chunk: 30 });
    resultsHost.appendChild(section('Box sets', series.length, grid, series.length > 120));
  }

  // ------------------------------------------------------------ programmes
  if (programmes.length) {
    const list = h('div.col.gap-1');
    programmes.slice(0, LIMIT).forEach((p) => {
      const channel = store.state.liveById.get(String(p.streamId));
      list.appendChild(
        h(
          'button.result-row',
          {
            onclick: () => {
              if (channel) playChannel(channel, store.state.liveChannels);
            }
          },
          h('span.result-row__time', `${relativeDay(p.s)} ${timeHM(p.s)}`),
          h(
            'span.result-row__body',
            h('span.result-row__title.truncate', p.t),
            h('span.result-row__sub.truncate', `${p.channel || (channel ? tidyChannelName(channel.name) : '')} · until ${timeHM(p.e)}`)
          ),
          icon('play', 15)
        )
      );
    });
    resultsHost.appendChild(section('Coming up in the guide', programmes.length, list, programmes.length > LIMIT));
  } else if (!store.state.epg.ready) {
    resultsHost.appendChild(
      h(
        'p.dim',
        { style: { fontSize: '12.5px', marginTop: '20px' } },
        'Load the TV guide to also search programmes that are coming up.'
      )
    );
  }
}

function section(title, count, content, truncated) {
  return h(
    'section.search-section',
    h(
      'div.search-section__head',
      title,
      h('span.count', String(count)),
      truncated ? h('span.dim', { style: { letterSpacing: 0, textTransform: 'none', fontWeight: '400' } }, '· showing the closest matches') : null
    ),
    content
  );
}
