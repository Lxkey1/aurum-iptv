/** Movie and series detail sheets, opened in the shared modal. */

import { h, icon, clear } from '../util/dom.js';
import { runtime, plainText, listOf, firstOf, clock, progressKey } from '../util/format.js';
import { openModal, closeModal, spinnerBlock, toastErr } from '../ui/feedback.js';
import { playMovie, playEpisode } from '../playback.js';
import * as store from '../state.js';

// ------------------------------------------------------------------ movie

export async function openMovieDetail(movie) {
  const movieId = movie.id || movie.stream_id;
  const body = openModal(spinnerBlock('Loading title…'));

  // The provider payload and TMDB are fetched together; TMDB wins wherever it
  // has something, because provider VOD metadata is usually a title and little else.
  const [info, tmdb] = await Promise.all([
    store.getVodInfo(movieId).catch(() => null),
    store.tmdbEnrich('movie', movieId, movie.name, movie.year)
  ]);

  const meta = (info && info.info) || {};
  const data = (info && info.movie_data) || {};
  const cover = (tmdb && tmdb.poster) || meta.movie_image || movie.cover || movie.stream_icon;
  const backdrop =
    (tmdb && tmdb.backdrop) || (Array.isArray(meta.backdrop_path) && meta.backdrop_path[0]) || cover;
  const name = (tmdb && tmdb.title) || data.name || movie.name || meta.name || 'Untitled';
  const key = progressKey('movie', movieId);
  const saved = store.getProgress(key);

  const chips = [];
  const year = (tmdb && tmdb.year) || String(firstOf(meta, ['releasedate', 'releaseDate'], movie.year || '')).slice(0, 4);
  if (year) chips.push(year);
  if (tmdb && tmdb.certification) chips.push(tmdb.certification);
  if (tmdb && tmdb.runtime) chips.push(runtime(tmdb.runtime));
  else if (meta.duration) chips.push(meta.duration);
  const rating = (tmdb && tmdb.rating) || Number(meta.rating) || movie.rating;
  if (rating > 0) chips.push(`★ ${Number(rating).toFixed(1)}`);
  if (data.container_extension || movie.ext) chips.push(String(data.container_extension || movie.ext).toUpperCase());
  if (tmdb) chips.push('TMDB');

  const fav = store.isFavorite('movie', movieId);
  const favBtn = h(
    'button.btn',
    {
      class: fav ? 'btn--primary' : '',
      onclick: async () => {
        const added = await store.toggleFavorite('movie', movieId);
        favBtn.classList.toggle('btn--primary', added);
        clear(favBtn).append(icon('heart', 16), added ? 'In favourites' : 'Favourite');
      }
    },
    icon('heart', 16),
    fav ? 'In favourites' : 'Favourite'
  );

  const start = (fromStart) => {
    closeModal();
    playMovie(
      { ...movie, id: movieId, name, ext: data.container_extension || movie.ext },
      fromStart ? null : info
    ).then(() => {
      if (fromStart) store.removeProgress(key).catch(() => {});
    });
  };

  const actions = [
    h(
      'button.btn.btn--primary.btn--lg',
      { onclick: () => start(false) },
      icon('play', 16),
      saved && saved.position > 30 ? `Resume from ${clock(saved.position)}` : 'Play'
    )
  ];
  if (saved && saved.position > 30) {
    actions.push(h('button.btn.btn--lg', { onclick: () => start(true) }, icon('refresh', 16), 'Start over'));
  }
  actions.push(favBtn);
  const trailerKey = (tmdb && tmdb.trailerKey) || meta.youtube_trailer;
  if (trailerKey) {
    actions.push(
      h(
        'button.btn.btn--lg',
        { onclick: () => window.aurum.app.openExternal(`https://www.youtube.com/watch?v=${trailerKey}`) },
        icon('play', 16),
        'Trailer'
      )
    );
  }

  const director = (tmdb && tmdb.director && tmdb.director.join(', ')) || meta.director;
  const cast = (tmdb && tmdb.cast && tmdb.cast.join(', ')) || meta.cast || meta.actors;
  const genre = (tmdb && tmdb.genres && tmdb.genres.join(', ')) || meta.genre || movie.genre;

  const crew = [];
  if (director) crew.push(h('div', h('span', 'Director  '), plainText(director)));
  if (cast) crew.push(h('div.clamp-2', h('span', 'Cast  '), plainText(cast)));
  if (genre) crew.push(h('div', h('span', 'Genre  '), plainText(genre)));

  clear(body).append(
    h(
      'div.detail__hero',
      backdrop ? h('div.detail__hero-bg', { style: { backgroundImage: `url("${cssUrl(backdrop)}")` } }) : null,
      h('div.detail__hero-scrim'),
      h('div.detail__poster', cover ? h('img', { src: cover, alt: name, referrerPolicy: 'no-referrer' }) : null),
      h(
        'div.detail__info',
        h('h1.detail__title', name),
        h('div.detail__meta', joinDots(chips)),
        (() => {
          const synopsis = (tmdb && tmdb.overview) || meta.plot || meta.description || movie.plot;
          return synopsis
            ? h('p.detail__plot.thin-scroll',
                tmdb && tmdb.tagline ? h('em', { style: { color: 'var(--accent)', display: 'block', marginBottom: '8px' } }, tmdb.tagline) : null,
                plainText(synopsis))
            : h('p.detail__plot.dim', 'No synopsis was supplied for this title.');
        })(),
        crew.length ? h('div.detail__crew', crew) : null,
        h('div.detail__actions', actions)
      )
    ),
    saved && saved.position > 30
      ? h(
          'div',
          { style: { padding: '0 38px 26px' } },
          h('div.episode__progress', h('i', { style: { width: `${(saved.position / saved.duration) * 100}%` } })),
          h('p.dim', { style: { fontSize: '11.5px', marginTop: '7px' } },
            `${clock(saved.position)} of ${clock(saved.duration)} watched`)
        )
      : null
  );
}

// ----------------------------------------------------------------- series

export async function openSeriesDetail(series) {
  const seriesId = series.id || series.series_id;
  const body = openModal(spinnerBlock('Loading box set…'));

  let info = null;
  const tmdbPromise = store.tmdbEnrich('series', seriesId, series.name, series.year);
  try {
    info = await store.getSeriesInfo(seriesId);
  } catch (err) {
    clear(body).append(
      h('div', { style: { padding: '40px' } },
        h('h2', 'Could not load this series'),
        h('p.muted', { style: { marginTop: '8px' } }, err.message))
    );
    return;
  }

  const tmdb = await tmdbPromise;
  const meta = (info && info.info) || {};
  const cover = (tmdb && tmdb.poster) || meta.cover || series.cover;
  const backdrop =
    (tmdb && tmdb.backdrop) || (Array.isArray(meta.backdrop_path) && meta.backdrop_path[0]) || cover;
  const name = (tmdb && tmdb.title) || meta.name || series.name || 'Series';

  // `episodes` is an object keyed by season number.
  const episodesBySeason = (info && info.episodes) || {};
  const seasonKeys = Object.keys(episodesBySeason).sort((a, b) => Number(a) - Number(b));

  const totalEpisodes = seasonKeys.reduce((sum, k) => sum + (episodesBySeason[k] || []).length, 0);

  const chips = [];
  const year = (tmdb && tmdb.year) || String(firstOf(meta, ['releaseDate', 'releasedate'], series.year || '')).slice(0, 4);
  if (year) chips.push(year);
  if (tmdb && tmdb.certification) chips.push(tmdb.certification);
  if (seasonKeys.length) chips.push(`${seasonKeys.length} season${seasonKeys.length > 1 ? 's' : ''}`);
  if (totalEpisodes) chips.push(`${totalEpisodes} episodes`);
  const seriesRating = (tmdb && tmdb.rating) || Number(meta.rating) || series.rating;
  if (seriesRating > 0) chips.push(`★ ${Number(seriesRating).toFixed(1)}`);
  if (tmdb) chips.push('TMDB');

  const fav = store.isFavorite('series', seriesId);
  const favBtn = h(
    'button.btn',
    {
      class: fav ? 'btn--primary' : '',
      onclick: async () => {
        const added = await store.toggleFavorite('series', seriesId);
        favBtn.classList.toggle('btn--primary', added);
        clear(favBtn).append(icon('heart', 16), added ? 'In favourites' : 'Favourite');
      }
    },
    icon('heart', 16),
    fav ? 'In favourites' : 'Favourite'
  );

  const seriesRef = { name, id: seriesId, cover };

  // Pick up where the viewer left off, otherwise the first episode.
  const nextUp = findNextUp(episodesBySeason, seasonKeys);

  const actions = [
    nextUp
      ? h(
          'button.btn.btn--primary.btn--lg',
          {
            onclick: () => {
              closeModal();
              playEpisode(nextUp.episode, {
                series: seriesRef,
                seasonEpisodes: episodesBySeason[nextUp.season],
                index: nextUp.index,
                season: nextUp.season
              });
            }
          },
          icon('play', 16),
          nextUp.resume
            ? `Resume S${pad(nextUp.season)}E${pad(nextUp.episode.episode_num)}`
            : `Play S${pad(nextUp.season)}E${pad(nextUp.episode.episode_num)}`
        )
      : null,
    favBtn
  ].filter(Boolean);

  const crew = [];
  const sDirector = (tmdb && tmdb.director && tmdb.director.join(', ')) || meta.director;
  const sCast = (tmdb && tmdb.cast && tmdb.cast.join(', ')) || meta.cast;
  const sGenre = (tmdb && tmdb.genres && tmdb.genres.join(', ')) || meta.genre || series.genre;
  if (sDirector) crew.push(h('div', h('span', 'Created by  '), plainText(sDirector)));
  if (sCast) crew.push(h('div.clamp-2', h('span', 'Cast  '), plainText(sCast)));
  if (sGenre) crew.push(h('div', h('span', 'Genre  '), plainText(sGenre)));

  const episodeHost = h('div.col.gap-1');
  const tabs = h('div.season-tabs');

  const renderSeason = (seasonKey) => {
    Array.from(tabs.children).forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.season === String(seasonKey))
    );
    const list = episodesBySeason[seasonKey] || [];
    clear(episodeHost);
    if (!list.length) {
      episodeHost.appendChild(h('p.dim', { style: { padding: '20px 0' } }, 'No episodes listed for this season.'));
      return;
    }
    list.forEach((episode, index) => {
      episodeHost.appendChild(episodeRow(episode, seasonKey, index, list, seriesRef));
    });
  };

  seasonKeys.forEach((key) => {
    tabs.appendChild(
      h(
        'button.chip',
        { dataset: { season: key }, onclick: () => renderSeason(key) },
        `Season ${key}`,
        h('span.chip__count', String((episodesBySeason[key] || []).length))
      )
    );
  });

  clear(body).append(
    h(
      'div.detail__hero',
      backdrop ? h('div.detail__hero-bg', { style: { backgroundImage: `url("${cssUrl(backdrop)}")` } }) : null,
      h('div.detail__hero-scrim'),
      h('div.detail__poster', cover ? h('img', { src: cover, alt: name, referrerPolicy: 'no-referrer' }) : null),
      h(
        'div.detail__info',
        h('h1.detail__title', name),
        h('div.detail__meta', joinDots(chips)),
        (() => {
          const synopsis = (tmdb && tmdb.overview) || meta.plot || series.plot;
          return synopsis
            ? h('p.detail__plot.thin-scroll',
                tmdb && tmdb.tagline ? h('em', { style: { color: 'var(--accent)', display: 'block', marginBottom: '8px' } }, tmdb.tagline) : null,
                plainText(synopsis))
            : h('p.detail__plot.dim', 'No synopsis was supplied for this series.');
        })(),
        crew.length ? h('div.detail__crew', crew) : null,
        h('div.detail__actions', actions)
      )
    ),
    h('div.detail__body', seasonKeys.length ? tabs : null, episodeHost)
  );

  if (seasonKeys.length) renderSeason(nextUp ? nextUp.season : seasonKeys[0]);
  else episodeHost.appendChild(h('p.dim', 'This series has no episodes listed.'));
}

function episodeRow(episode, seasonKey, index, seasonEpisodes, seriesRef) {
  const info = episode.info || {};
  const key = progressKey('episode', episode.id);
  const saved = store.getProgress(key);
  const still = info.movie_image || info.cover_big || seriesRef.cover;
  const durationSecs = Number(info.duration_secs) || 0;

  const bits = [];
  if (durationSecs) bits.push(runtime(durationSecs / 60));
  else if (info.duration) bits.push(info.duration);
  if (info.releasedate || info.air_date) bits.push(String(info.releasedate || info.air_date).slice(0, 10));
  if (info.rating) bits.push(`★ ${info.rating}`);

  const thumb = h('div.episode__still');
  if (still) {
    const img = h('img', { src: still, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    thumb.appendChild(img);
  }
  thumb.appendChild(h('span.episode__num', `E${pad(episode.episode_num)}`));

  return h(
    'button.episode',
    {
      onclick: () => {
        closeModal();
        playEpisode(episode, { series: seriesRef, seasonEpisodes, index, season: seasonKey });
      }
    },
    thumb,
    h(
      'div.episode__body',
      h('div.episode__title', episode.title || info.name || `Episode ${episode.episode_num}`),
      bits.length ? h('div.episode__meta', bits.join('  ·  ')) : null,
      info.plot ? h('div.episode__plot.clamp-2', plainText(info.plot)) : null,
      saved && saved.duration
        ? h('div.episode__progress', h('i', { style: { width: `${(saved.position / saved.duration) * 100}%` } }))
        : null
    )
  );
}

/** First partly-watched episode, else the first unwatched one. */
function findNextUp(episodesBySeason, seasonKeys) {
  for (const season of seasonKeys) {
    const list = episodesBySeason[season] || [];
    for (let i = 0; i < list.length; i += 1) {
      const saved = store.getProgress(progressKey('episode', list[i].id));
      if (saved && saved.duration && saved.position < saved.duration * 0.95) {
        return { season, episode: list[i], index: i, resume: true };
      }
    }
  }
  for (const season of seasonKeys) {
    const list = episodesBySeason[season] || [];
    for (let i = 0; i < list.length; i += 1) {
      if (!store.getProgress(progressKey('episode', list[i].id))) {
        return { season, episode: list[i], index: i, resume: false };
      }
    }
  }
  const first = seasonKeys[0];
  const list = first ? episodesBySeason[first] : null;
  return list && list.length ? { season: first, episode: list[0], index: 0, resume: false } : null;
}

// ---------------------------------------------------------------- helpers

function joinDots(items) {
  const out = [];
  items.filter(Boolean).forEach((item, i) => {
    if (i) out.push(h('span.detail__dot'));
    out.push(h('span', String(item)));
  });
  return out;
}

const pad = (n) => String(n ?? '').padStart(2, '0');

/** Provider artwork URLs sometimes contain quotes/parens that break CSS url(). */
function cssUrl(src) {
  return String(src || '').replace(/["'()\\]/g, encodeURIComponent);
}
