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

  const favs = store.state.favorites;
  const [channels, movies, series] = await Promise.all([
    store.fetchByIds('live', favs.live).catch(() => []),
    store.fetchByIds('movie', favs.movie).catch(() => []),
    store.fetchByIds('series', favs.series).catch(() => [])
  ]);
  const cw = store.continueWatchingList();

  clear(page);
  page.appendChild(
    h('div.page__head',
      h('div.page__title',
        h('h1', 'My collection'),
        h('p', 'Favourites and everything you are part-way through')))
  );

  if (!channels.length && !movies.length && !series.length && !cw.length) {
    page.appendChild(
      emptyState('heart', 'Nothing saved yet',
        'Tap the heart on any channel, film or box set to keep it here. Anything you start watching also shows up automatically.',
        h('button.btn.btn--primary', { onclick: () => navigate('live') }, icon('tv', 16), 'Browse live TV'))
    );
    return;
  }

  // ------------------------------------------------------ continue watching
  if (cw.length) {
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head',
          h('h2', h('span.accent-bar'), 'Continue watching'),
          h('button.btn.btn--sm.btn--ghost',
            {
              onclick: async () => {
                for (const entry of cw) await store.removeProgress(entry.key);
                renderFavourites(host, { navigate });
              }
            },
            icon('trash', 14), 'Clear list')),
        h('div.grid', cw.map((entry) =>
          posterCard({
            id: entry.id,
            kind: entry.type === 'movie' ? 'movie' : 'series',
            title: entry.name,
            sub: entry.subtitle || `${clock(entry.position)} / ${clock(entry.duration)}`,
            cover: entry.cover,
            progress: entry.duration ? entry.position / entry.duration : 0,
            onOpen: () => resumeEntry(entry),
            onPlay: () => resumeEntry(entry)
          }))))
    );
  }

  // -------------------------------------------------------------- channels
  if (channels.length) {
    let epgMap = {};
    if (store.state.epg.ready) {
      try {
        epgMap = await store.epgNowNext(channels.map((c) => String(c.id)));
      } catch {
        /* optional */
      }
    }
    const ids = channels.map((c) => String(c.id));
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head', h('h2', h('span.accent-bar'), `Channels (${channels.length})`)),
        h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } },
          channels.map((channel, i) =>
            channelRow(channel, {
              epg: epgMap[String(channel.id)],
              index: i,
              onPlay: () => playChannel(channel, { ids })
            }))))
    );
  }

  if (movies.length) {
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head', h('h2', h('span.accent-bar'), `Films (${movies.length})`)),
        h('div.grid', movies.map(movieCard)))
    );
  }

  if (series.length) {
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head', h('h2', h('span.accent-bar'), `Box sets (${series.length})`)),
        h('div.grid', series.map(seriesCard)))
    );
  }
}
