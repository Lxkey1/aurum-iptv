/** Home: a hero carousel plus rails for continue watching, favourites and new arrivals. */

import { h, icon, clear } from '../util/dom.js';
import { plainText, clock, tidyChannelName, progressKey, runtime } from '../util/format.js';
import { posterCard, rail, channelRow } from '../ui/cards.js';
import { emptyState, spinnerBlock } from '../ui/feedback.js';
import { openMovieDetail, openSeriesDetail } from './detail.js';
import { playChannel, resumeEntry } from '../playback.js';
import * as store from '../state.js';

export async function renderHome(host, { navigate }) {
  clear(host);
  const page = h('div.page');
  host.appendChild(page);
  page.appendChild(spinnerBlock('Building your home screen…'));

  try {
    await Promise.all([
      store.ensureLive().catch(() => []),
      store.ensureMovies().catch(() => []),
      store.ensureSeries().catch(() => [])
    ]);
  } catch {
    /* individual sections handle their own emptiness */
  }

  clear(page);

  const movies = store.state.movies;
  const series = store.state.series;
  const channels = store.state.liveChannels;

  if (!movies.length && !series.length && !channels.length) {
    page.appendChild(
      emptyState('inbox', 'Nothing to show yet', 'Your line returned no channels, films or series. Try refreshing, or check the account in Settings.')
    );
    return;
  }

  // ---------------------------------------------------------------- hero
  const featured = pickFeatured(movies, series);
  if (featured.length) page.appendChild(buildHero(featured));

  // ------------------------------------------------------ continue watching
  const cw = store.continueWatchingList().slice(0, 18);
  if (cw.length) {
    const cards = cw.map((entry) =>
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
    page.appendChild(rail('Continue watching', cards));
  }

  // ----------------------------------------------------- favourite channels
  const favChannels = store.state.favorites.live
    .map((id) => store.state.liveById.get(String(id)))
    .filter(Boolean)
    .slice(0, 14);

  if (favChannels.length) {
    const epgMap = await safeNowNext(favChannels.map((c) => String(c.stream_id)));
    const grid = h(
      'div.grid.grid--wide',
      { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } },
      favChannels.map((channel, i) =>
        channelRow(channel, {
          epg: epgMap[String(channel.stream_id)],
          index: i,
          onPlay: () => playChannel(channel, favChannels)
        })
      )
    );
    page.appendChild(
      h(
        'section.row-block',
        h(
          'div.row-block__head',
          h('h2', h('span.accent-bar'), 'Favourite channels'),
          h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('live') }, 'All channels', icon('chevronRight', 14))
        ),
        grid
      )
    );
  }

  // ------------------------------------------------------- recent channels
  const recent = store.state.recentChannels
    .map((id) => store.state.liveById.get(String(id)))
    .filter(Boolean)
    .filter((c) => !favChannels.includes(c))
    .slice(0, 12);

  if (recent.length) {
    const epgMap = await safeNowNext(recent.map((c) => String(c.stream_id)));
    const grid = h(
      'div.grid',
      { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } },
      recent.map((channel, i) =>
        channelRow(channel, {
          epg: epgMap[String(channel.stream_id)],
          index: i,
          onPlay: () => playChannel(channel, recent)
        })
      )
    );
    page.appendChild(h('section.row-block', h('div.row-block__head', h('h2', h('span.accent-bar'), 'Recently watched')), grid));
  }

  // ------------------------------------------------------------ new films
  const newMovies = [...movies]
    .sort((a, b) => Number(b.added || 0) - Number(a.added || 0))
    .slice(0, 24);

  if (newMovies.length) {
    page.appendChild(
      rail(
        'Recently added films',
        newMovies.map((movie) => movieCard(movie)),
        {
          action: h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('movies') }, 'Browse all', icon('chevronRight', 14))
        }
      )
    );
  }

  // ----------------------------------------------------------- new series
  const newSeries = [...series]
    .sort((a, b) => Number(b.last_modified || 0) - Number(a.last_modified || 0))
    .slice(0, 24);

  if (newSeries.length) {
    page.appendChild(
      rail(
        'Recently added box sets',
        newSeries.map((s) => seriesCard(s)),
        {
          action: h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('series') }, 'Browse all', icon('chevronRight', 14))
        }
      )
    );
  }

  // ------------------------------------------------------- top rated films
  const topRated = movies
    .filter((m) => Number(m.rating) >= 7.5)
    .sort((a, b) => Number(b.rating) - Number(a.rating))
    .slice(0, 24);

  if (topRated.length) {
    page.appendChild(rail('Highly rated', topRated.map((movie) => movieCard(movie))));
  }
}

export function movieCard(movie) {
  const key = progressKey('movie', movie.stream_id);
  const saved = store.getProgress(key);
  return posterCard({
    id: movie.stream_id,
    kind: 'movie',
    title: movie.name,
    sub: [movie.year, movie.rating ? `★ ${movie.rating}` : ''].filter(Boolean).join(' · '),
    cover: movie.stream_icon || movie.cover,
    rating: movie.rating && Number(movie.rating) > 0 ? Number(movie.rating).toFixed(1) : null,
    progress: saved && saved.duration ? saved.position / saved.duration : 0,
    onOpen: () => openMovieDetail(movie),
    onPlay: () => openMovieDetail(movie)
  });
}

export function seriesCard(item) {
  return posterCard({
    id: item.series_id,
    kind: 'series',
    title: item.name,
    sub: [String(item.releaseDate || '').slice(0, 4), item.rating ? `★ ${item.rating}` : ''].filter(Boolean).join(' · '),
    cover: item.cover,
    rating: item.rating && Number(item.rating) > 0 ? Number(item.rating).toFixed(1) : null,
    onOpen: () => openSeriesDetail(item),
    onPlay: () => openSeriesDetail(item)
  });
}

// ------------------------------------------------------------------- hero

function pickFeatured(movies, series) {
  const pool = [
    ...movies
      .filter((m) => Number(m.rating) >= 7 && (m.stream_icon || m.cover))
      .slice(0, 400)
      .map((m) => ({ kind: 'movie', item: m })),
    ...series
      .filter((s) => Number(s.rating) >= 7 && s.cover)
      .slice(0, 400)
      .map((s) => ({ kind: 'series', item: s }))
  ];
  if (!pool.length) return [];

  // Deterministic per-day shuffle so the hero feels curated, not jumpy.
  const seed = Math.floor(Date.now() / 86400000);
  const picked = [];
  const used = new Set();
  for (let i = 0; i < 5 && picked.length < 5; i += 1) {
    const idx = (seed * 7919 + i * 104729) % pool.length;
    for (let probe = 0; probe < pool.length; probe += 1) {
      const at = (idx + probe) % pool.length;
      if (!used.has(at)) {
        used.add(at);
        picked.push(pool[at]);
        break;
      }
    }
  }
  return picked;
}

function buildHero(featured) {
  const hero = h('div.hero');
  const bg = h('div.hero__bg');
  const body = h('div.hero__body');
  const dots = h('div.hero__dots');
  hero.append(bg, h('div.hero__scrim'), body, dots);

  let index = 0;
  let timer = null;

  const draw = () => {
    const entry = featured[index];
    const item = entry.item;
    const isMovie = entry.kind === 'movie';
    const cover = isMovie ? item.stream_icon || item.cover : item.cover;

    bg.style.backgroundImage = cover ? `url("${String(cover).replace(/["'()\\]/g, encodeURIComponent)}")` : '';

    const chips = [
      h('span.badge.badge--gold', isMovie ? 'Film' : 'Box set'),
      item.rating && Number(item.rating) > 0 ? h('span.row.gap-1', icon('star', 12), Number(item.rating).toFixed(1)) : null,
      isMovie && item.year ? h('span', String(item.year)) : null,
      !isMovie && item.releaseDate ? h('span', String(item.releaseDate).slice(0, 4)) : null,
      item.genre ? h('span.truncate', { style: { maxWidth: '260px' } }, plainText(item.genre)) : null
    ].filter(Boolean);

    clear(body).append(
      h('div.hero__meta', chips),
      h('h1.hero__title.clamp-2', item.name),
      item.plot ? h('p.hero__desc.clamp-3', plainText(item.plot)) : null,
      h(
        'div.hero__actions',
        h(
          'button.btn.btn--primary.btn--lg',
          { onclick: () => (isMovie ? openMovieDetail(item) : openSeriesDetail(item)) },
          icon('play', 16),
          'Watch now'
        ),
        h(
          'button.btn.btn--lg',
          { onclick: () => (isMovie ? openMovieDetail(item) : openSeriesDetail(item)) },
          icon('info', 16),
          'More info'
        )
      )
    );

    clear(dots);
    featured.forEach((_, i) => {
      dots.appendChild(
        h('button', {
          class: i === index ? 'active' : '',
          onclick: () => {
            index = i;
            draw();
            restart();
          }
        })
      );
    });
  };

  const restart = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      index = (index + 1) % featured.length;
      draw();
    }, 9000);
  };

  draw();
  restart();

  // stop the carousel when the hero leaves the DOM
  const observer = new MutationObserver(() => {
    if (!document.body.contains(hero)) {
      clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('content'), { childList: true, subtree: true });

  return hero;
}

async function safeNowNext(ids) {
  try {
    return await store.epgNowNext(ids);
  } catch {
    return {};
  }
}
