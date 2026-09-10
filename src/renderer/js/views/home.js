/** Home: a hero carousel plus rails for continue watching, favourites and new arrivals. */

import { h, icon, clear } from '../util/dom.js';
import { plainText, clock, tidyChannelName, progressKey } from '../util/format.js';
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

  const cat = store.state.catalogue;
  if (!cat.channels && !cat.movies && !cat.series) {
    clear(page).appendChild(
      emptyState('inbox', 'Nothing to show yet',
        'Your catalogue has not been downloaded yet. Use Refresh in the toolbar to pull it from your provider.',
        h('button.btn.btn--primary', { onclick: () => store.syncCatalogue(true).then(() => renderHome(host, { navigate })) },
          icon('download', 16), 'Download catalogue'))
    );
    return;
  }

  // Everything below is a handful of small indexed queries, not a full scan.
  const [newMovies, newSeries, topRated, featuredPool] = await Promise.all([
    store.fetchTitles('movie', { sort: 'added', limit: 24 }).then((r) => r.rows).catch(() => []),
    store.fetchTitles('series', { sort: 'added', limit: 24 }).then((r) => r.rows).catch(() => []),
    store.fetchTitles('movie', { sort: 'rating', limit: 24 }).then((r) => r.rows).catch(() => []),
    store.fetchTitles('movie', { sort: 'rating', limit: 40 }).then((r) => r.rows).catch(() => [])
  ]);

  const cw = store.continueWatchingList().slice(0, 18);
  const favChannels = await store.fetchByIds('live', store.state.favorites.live.slice(0, 14)).catch(() => []);
  const favIds = new Set(favChannels.map((c) => String(c.id)));
  const recentChannels = (
    await store.fetchByIds('live', store.state.recentChannels.slice(0, 16)).catch(() => [])
  ).filter((c) => !favIds.has(String(c.id))).slice(0, 12);

  clear(page);

  // ---------------------------------------------------------------- hero
  const featured = pickFeatured(featuredPool, newSeries);
  if (featured.length) page.appendChild(buildHero(featured));

  // ------------------------------------------------------ continue watching
  if (cw.length) {
    page.appendChild(
      rail('Continue watching', cw.map((entry) =>
        posterCard({
          id: entry.id,
          kind: entry.type === 'movie' ? 'movie' : 'series',
          title: entry.name,
          sub: entry.subtitle || `${clock(entry.position)} / ${clock(entry.duration)}`,
          cover: entry.cover,
          progress: entry.duration ? entry.position / entry.duration : 0,
          onOpen: () => resumeEntry(entry),
          onPlay: () => resumeEntry(entry)
        })))
    );
  }

  // ----------------------------------------------------- favourite channels
  if (favChannels.length) {
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head',
          h('h2', h('span.accent-bar'), 'Favourite channels'),
          h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('live') }, 'All channels', icon('chevronRight', 14))),
        await channelGrid(favChannels, store.state.favorites.live))
    );
  }

  // ------------------------------------------------------- recent channels
  if (recentChannels.length) {
    page.appendChild(
      h('section.row-block',
        h('div.row-block__head', h('h2', h('span.accent-bar'), 'Recently watched')),
        await channelGrid(recentChannels, store.state.recentChannels))
    );
  }

  if (newMovies.length) {
    page.appendChild(rail('Recently added films', newMovies.map(movieCard), {
      action: h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('movies') }, 'Browse all', icon('chevronRight', 14))
    }));
  }
  if (newSeries.length) {
    page.appendChild(rail('Recently added box sets', newSeries.map(seriesCard), {
      action: h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate('series') }, 'Browse all', icon('chevronRight', 14))
    }));
  }
  if (topRated.length) {
    page.appendChild(rail('Highly rated', topRated.map(movieCard)));
  }
}

async function channelGrid(channels, playlistIds) {
  let epgMap = {};
  if (store.state.epg.ready) {
    try {
      epgMap = await store.epgNowNext(channels.map((c) => String(c.id)));
    } catch {
      /* optional */
    }
  }
  return h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } },
    channels.map((channel, i) =>
      channelRow(channel, {
        epg: epgMap[String(channel.id)],
        index: i,
        onPlay: () => playChannel(channel, { ids: playlistIds.map(String) })
      })));
}

export function movieCard(movie) {
  const saved = store.getProgress(progressKey('movie', movie.id));
  return posterCard({
    id: movie.id,
    kind: 'movie',
    title: movie.name,
    sub: [movie.year, movie.rating > 0 ? `★ ${Number(movie.rating).toFixed(1)}` : ''].filter(Boolean).join(' · '),
    cover: movie.cover,
    rating: movie.rating > 0 ? Number(movie.rating).toFixed(1) : null,
    progress: saved && saved.duration ? saved.position / saved.duration : 0,
    onOpen: () => openMovieDetail(movie),
    onPlay: () => openMovieDetail(movie)
  });
}

export function seriesCard(item) {
  return posterCard({
    id: item.id,
    kind: 'series',
    title: item.name,
    sub: [item.year, item.rating > 0 ? `★ ${Number(item.rating).toFixed(1)}` : ''].filter(Boolean).join(' · '),
    cover: item.cover,
    rating: item.rating > 0 ? Number(item.rating).toFixed(1) : null,
    onOpen: () => openSeriesDetail(item),
    onPlay: () => openSeriesDetail(item)
  });
}

// ------------------------------------------------------------------- hero

function pickFeatured(movies, series) {
  const pool = [
    ...movies.filter((m) => m.cover).map((m) => ({ kind: 'movie', item: m })),
    ...series.filter((s) => s.cover && s.rating >= 7).map((s) => ({ kind: 'series', item: s }))
  ];
  if (!pool.length) return [];

  // Deterministic per-day pick so the hero feels curated rather than jumpy.
  const seed = Math.floor(Date.now() / 86400000);
  const picked = [];
  const used = new Set();
  for (let i = 0; i < 5 && picked.length < 5 && used.size < pool.length; i += 1) {
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

    bg.style.backgroundImage = item.cover
      ? `url("${String(item.cover).replace(/["'()\\]/g, encodeURIComponent)}")`
      : '';

    const chips = [
      h('span.badge.badge--gold', isMovie ? 'Film' : 'Box set'),
      item.rating > 0 ? h('span.row.gap-1', icon('star', 12), Number(item.rating).toFixed(1)) : null,
      item.year ? h('span', String(item.year)) : null,
      item.genre ? h('span.truncate', { style: { maxWidth: '260px' } }, plainText(item.genre)) : null
    ].filter(Boolean);

    clear(body).append(
      h('div.hero__meta', chips),
      h('h1.hero__title.clamp-2', item.name),
      item.plot ? h('p.hero__desc.clamp-3', plainText(item.plot)) : null,
      h('div.hero__actions',
        h('button.btn.btn--primary.btn--lg',
          { onclick: () => (isMovie ? openMovieDetail(item) : openSeriesDetail(item)) },
          icon('play', 16), 'Watch now'),
        h('button.btn.btn--lg',
          { onclick: () => (isMovie ? openMovieDetail(item) : openSeriesDetail(item)) },
          icon('info', 16), 'More info'))
    );

    clear(dots);
    featured.forEach((_, i) => {
      dots.appendChild(h('button', {
        class: i === index ? 'active' : '',
        onclick: () => { index = i; draw(); restart(); }
      }));
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

  const observer = new MutationObserver(() => {
    if (!document.body.contains(hero)) {
      clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('content'), { childList: true, subtree: true });

  return hero;
}
