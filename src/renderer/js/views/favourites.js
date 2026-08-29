/** Favourites: saved channels, films and box sets in one place. */

import { h, icon, clear } from '../util/dom.js';
import { clock } from '../util/format.js';
import { channelRow, posterCard } from '../ui/cards.js';
import { emptyState, spinnerBlock } from '../ui/feedback.js';
import { movieCard, seriesCard } from './home.js';
import { playChannel, resumeEntry } from '../playback.js';
import * as store from '../state.js';

export async function renderFavourites(host, { navigate }) {
  clear(host);
  const page = h('div.page');
  host.appendChild(page);
  page.appendChild(spinnerBlock('Loading your collection…'));

  await Promise.allSettled([store.ensureLive(), store.ensureMovies(), store.ensureSeries()]);

  clear(page);
  page.appendChild(
    h('div.page__head', h('div.page__title', h('h1', 'My collection'), h('p', 'Favourites and everything you are part-way through')))
  );

  const channels = store.state.favorites.live
    .map((id) => store.state.liveById.get(String(id)))
    .filter(Boolean);

  const movieIds = new Set(store.state.favorites.movie.map(String));
  const movies = store.state.movies.filter((m) => movieIds.has(String(m.stream_id)));

  const seriesIds = new Set(store.state.favorites.series.map(String));
  const series = store.state.series.filter((s) => seriesIds.has(String(s.series_id)));

  const cw = store.continueWatchingList();

  if (!channels.length && !movies.length && !series.length && !cw.length) {
    page.appendChild(
      emptyState(
        'heart',
        'Nothing saved yet',
        'Tap the heart on any channel, film or box set to keep it here. Anything you start watching also shows up automatically.',
        h('button.btn.btn--primary', { onclick: () => navigate('live') }, icon('tv', 16), 'Browse live TV')
      )
    );
    return;
  }

  // ------------------------------------------------------ continue watching
  if (cw.length) {
    const grid = h('div.grid');
    cw.forEach((entry) => {
      grid.appendChild(
        posterCard({
          id: entry.id,
          kind: entry.type === 'movie' ? 'movie' : 'series',
          title: entry.name,
          sub: entry.subtitle || `${clock(entry.position)} / ${clock(entry.duration)}`,
          cover: entry.cover,
          progress: entry.duration ? entry.position / entry.duration : 0,
          onOpen: () => resumeEntry(entry),
          onPlay: () => resumeEntry(entry)
        })
      );
    });
    page.appendChild(
      h(
        'section.row-block',
        h(
          'div.row-block__head',
          h('h2', h('span.accent-bar'), 'Continue watching'),
          h(
            'button.btn.btn--sm.btn--ghost',
            {
              onclick: async () => {
                for (const entry of cw) await store.removeProgress(entry.key);
                renderFavourites(host, { navigate });
              }
            },
            icon('trash', 14),
            'Clear list'
          )
        ),
        grid
      )
    );
  }

  // -------------------------------------------------------------- channels
  if (channels.length) {
    let epgMap = {};
    try {
      if (store.state.epg.ready) epgMap = await store.epgNowNext(channels.map((c) => String(c.stream_id)));
    } catch {
      /* optional */
    }
    const grid = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } });
    channels.forEach((channel, i) =>
      grid.appendChild(
        channelRow(channel, {
          epg: epgMap[String(channel.stream_id)],
          index: i,
          onPlay: () => playChannel(channel, channels)
        })
      )
    );
    page.appendChild(
      h('section.row-block', h('div.row-block__head', h('h2', h('span.accent-bar'), `Channels (${channels.length})`)), grid)
    );
  }

  // ----------------------------------------------------------------- films
  if (movies.length) {
    const grid = h('div.grid', movies.map((m) => movieCard(m)));
    page.appendChild(
      h('section.row-block', h('div.row-block__head', h('h2', h('span.accent-bar'), `Films (${movies.length})`)), grid)
    );
  }

  // -------------------------------------------------------------- box sets
  if (series.length) {
    const grid = h('div.grid', series.map((s) => seriesCard(s)));
    page.appendChild(
      h('section.row-block', h('div.row-block__head', h('h2', h('span.accent-bar'), `Box sets (${series.length})`)), grid)
    );
  }
}
