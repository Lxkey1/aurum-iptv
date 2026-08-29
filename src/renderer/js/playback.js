/** Turns catalogue items into player sessions. Shared by every view. */

import { player } from './player/player.js';
import { toastErr } from './ui/feedback.js';
import { tidyChannelName, progressKey, firstOf } from './util/format.js';
import * as store from './state.js';

/** Play a live channel, wiring up the zap list so Page Up/Down works. */
export async function playChannel(channel, playlist) {
  try {
    const list = playlist && playlist.length ? playlist : store.state.liveChannels;
    player.init();
    player.setPlaylist(list, channel.stream_id);

    await player.play({
      type: 'live',
      id: channel.stream_id,
      title: tidyChannelName(channel.name),
      subtitle: '',
      cover: channel.stream_icon,
      live: true,
      ext: store.state.settings.liveFormat || 'ts'
    });

    player.renderZapList();
    player.loadNowPlayingEpg(channel);
  } catch (err) {
    toastErr('Could not start the channel', err.message);
  }
}

/** Play a VOD title. `info` is the optional get_vod_info payload. */
export async function playMovie(movie, info) {
  try {
    const ext = firstOf(
      { a: movie.container_extension, b: info && info.movie_data && info.movie_data.container_extension },
      ['a', 'b'],
      'mp4'
    );
    const id = movie.stream_id || (info && info.movie_data && info.movie_data.stream_id);
    const key = progressKey('movie', id);
    const saved = store.getProgress(key);
    const cover = movie.stream_icon || movie.cover || (info && info.info && info.info.movie_image);

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
      seriesId: series.series_id,
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
    await playMovie({ stream_id: entry.id, name: entry.name, stream_icon: entry.cover, container_extension: entry.ext });
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
      { series: { name: entry.name, series_id: entry.seriesId, cover: entry.cover } }
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
