/** Turns catalogue items into player sessions. Shared by every view. */

import { player } from './player/player.js';
import { toastErr } from './ui/feedback.js';
import { tidyChannelName, progressKey, firstOf, catchupStamp } from './util/format.js';
import * as store from './state.js';

/**
 * Play a live channel.
 *
 * `context` describes where the user was browsing so the player can zap through
 * the same list. Only ids are held — a category can run to tens of thousands of
 * channels and the rows are fetched a page at a time as the user zaps.
 */
export async function playChannel(channel, context = {}) {
  try {
    player.init();
    const ids = context.ids || (await store.fetchChannelIds(context.query || {}));
    player.setPlaylist(ids, channel.id);

    await player.play({
      type: 'live',
      id: channel.id,
      title: tidyChannelName(channel.name),
      subtitle: '',
      cover: channel.logo,
      live: true,
      ext: store.state.settings.liveFormat || 'ts',
      archive: Boolean(channel.archive)
    });

    player.renderZapList();
    player.loadNowPlayingEpg(channel);
  } catch (err) {
    toastErr('Could not start the channel', err.message);
  }
}

/**
 * Play a past programme from a channel's archive.
 *
 * Xtream exposes this as timeshift.php with a start stamp and a duration. Only
 * channels whose `archive` flag is set actually keep one — the guide checks that
 * before offering this.
 */
export async function playCatchup(channel, programme) {
  try {
    const minutes = Math.max(1, Math.round((programme.e - programme.s) / 60000));
    const url = await store.getCatchupUrl(channel.id, minutes, catchupStamp(programme.s));

    player.init();
    player.setPlaylist([], null);
    await player.play({
      type: 'catchup',
      streamType: 'live',
      id: channel.id,
      title: programme.t,
      subtitle: `${tidyChannelName(channel.name)} · recorded ${new Date(programme.s).toLocaleString([], {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })}`,
      cover: channel.logo,
      live: false,
      url,
      ext: store.state.settings.liveFormat || 'ts',
      progressKey: progressKey('catchup', channel.id, String(programme.s))
    });
  } catch (err) {
    toastErr('Could not start catch-up', err.message);
  }
}

/** Play a VOD title. `info` is the optional get_vod_info payload. */
export async function playMovie(movie, info) {
  try {
    const ext = firstOf(
      { a: movie.ext || movie.container_extension, b: info && info.movie_data && info.movie_data.container_extension },
      ['a', 'b'],
      'mp4'
    );
    const id = movie.id || movie.stream_id || (info && info.movie_data && info.movie_data.stream_id);
    const key = progressKey('movie', id);
    const saved = store.getProgress(key);
    const cover = movie.cover || movie.stream_icon || (info && info.info && info.info.movie_image);

    player.init();
    player.setPlaylist([], null);
    await player.play({
      type: 'movie',
      streamType: 'movie',
      id,
      title: movie.name || (info && info.info && info.info.name) || 'Film',
      subtitle: buildMovieSubtitle(movie, info),
      cover,
      live: false,
      ext,
      resumeAt: saved && saved.position > 30 ? saved.position : 0,
      progressKey: key
    });
  } catch (err) {
    toastErr('Could not start the film', err.message);
  }
}

/**
 * Play one episode and queue the rest of the season so playback rolls on.
 * @param {object} episode raw episode object from get_series_info
 * @param {object} ctx { series, seasonEpisodes, index }
 */
export async function playEpisode(episode, ctx = {}) {
  try {
    const series = ctx.series || {};
    const ext = episode.container_extension || 'mp4';
    const key = progressKey('episode', episode.id);
    const saved = store.getProgress(key);
    const info = episode.info || {};

    const title = series.name || 'Series';
    const label = `S${String(episode.season || ctx.season || 1).padStart(2, '0')}E${String(episode.episode_num || '').padStart(2, '0')} · ${episode.title || info.name || 'Episode'}`;

    player.init();
    player.setPlaylist([], null);

    const media = {
      type: 'episode',
      streamType: 'series',
      id: episode.id,
      seriesId: series.id || series.series_id,
      title,
      subtitle: label,
      cover: info.movie_image || series.cover,
      live: false,
      ext,
      resumeAt: saved && saved.position > 30 ? saved.position : 0,
      progressKey: key,
      meta: { season: episode.season || ctx.season, episode: episode.episode_num, seriesName: series.name }
    };

    // Auto-advance through the season.
    const queue = ctx.seasonEpisodes || [];
    const index = typeof ctx.index === 'number' ? ctx.index : queue.findIndex((e) => e.id === episode.id);
    if (queue[index + 1]) {
      media.onEnded = () => playEpisode(queue[index + 1], { ...ctx, index: index + 1 });
    }

    await player.play(media);
  } catch (err) {
    toastErr('Could not start the episode', err.message);
  }
}

/** Resume a continue-watching entry. */
export async function resumeEntry(entry) {
  if (entry.type === 'movie') {
    await playMovie({ id: entry.id, name: entry.name, cover: entry.cover, ext: entry.ext });
    return;
  }
  if (entry.type === 'episode') {
    await playEpisode(
      {
        id: entry.id,
        title: (entry.subtitle || '').split('·').pop().trim(),
        container_extension: entry.ext,
        season: entry.meta && entry.meta.season,
        episode_num: entry.meta && entry.meta.episode,
        info: { movie_image: entry.cover }
      },
      { series: { name: entry.name, id: entry.seriesId, cover: entry.cover } }
    );
  }
}

function buildMovieSubtitle(movie, info) {
  const bits = [];
  const meta = (info && info.info) || {};
  const year = movie.year || meta.releasedate || meta.releaseDate;
  if (year) bits.push(String(year).slice(0, 4));
  if (meta.genre) bits.push(String(meta.genre).split(',')[0].trim());
  if (meta.duration) bits.push(meta.duration);
  return bits.filter(Boolean).join(' · ');
}
