/**
 * The built-in media player: overlay UI, control bar, quality/audio/subtitle
 * selection, live channel zapping and continue-watching bookkeeping.
 */

import { $, h, clear, icon, poster } from '../util/dom.js';
import { clock, timeHM, bitrate, tidyChannelName, progressKey, throttle } from '../util/format.js';
import { toastOk, toastErr, toast } from '../ui/feedback.js';
import * as store from '../state.js';
import { PlaybackEngine, ENGINE } from './engine.js';

const FIT_MODES = [
  { id: 'contain', label: 'Fit to window', hint: 'No cropping' },
  { id: 'cover', label: 'Fill window', hint: 'Crops edges' },
  { id: 'fill', label: 'Stretch', hint: 'Ignores aspect' },
  { id: 'native', label: 'Original size', hint: '1:1 pixels' }
];

const ASPECTS = [
  { id: 'auto', label: 'Automatic' },
  { id: '16:9', label: '16:9 Widescreen' },
  { id: '4:3', label: '4:3 Classic' },
  { id: '21:9', label: '21:9 Cinemascope' }
];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

class Player {
  constructor() {
    this.el = {};
    this.engine = null;
    this.media = null; // { type, id, title, subtitle, cover, live, url, progressKey, ... }
    this.playlist = []; // live channels for zapping
    this.playlistIndex = -1;
    this.idleTimer = null;
    this.zapTimer = null;
    this.osdTimer = null;
    this.statsVisible = false;
    this.open = false;
    this.seeking = false;
    this.lastSavedAt = 0;
    this.bound = false;
    this.formatFallbackUsed = false;
  }

  init() {
    if (this.bound) return;
    this.bound = true;

    const el = this.el;
    el.root = $('#player');
    el.stage = $('#playerStage');
    el.video = $('#video');
    el.chrome = $('#playerChrome');
    el.loading = $('#playerLoading');
    el.loadingText = $('#playerLoadingText');
    el.error = $('#playerError');
    el.errorTitle = $('#playerErrorTitle');
    el.errorMsg = $('#playerErrorMsg');
    el.title = $('#playerTitle');
    el.subtitle = $('#playerSubtitle');
    el.seek = $('#seek');
    el.seekBuffer = $('#seekBuffer');
    el.seekPlayed = $('#seekPlayed');
    el.seekKnob = $('#seekKnob');
    el.seekTip = $('#seekTip');
    el.timeCur = $('#timeCur');
    el.timeDur = $('#timeDur');
    el.livePill = $('#livePill');
    el.btnPlay = $('#btnPlay');
    el.btnMute = $('#btnMute');
    el.volSlider = $('#volSlider');
    el.btnFullscreen = $('#btnFullscreen');
    el.flyout = $('#flyout');
    el.flyoutTitle = $('#flyoutTitle');
    el.flyoutBody = $('#flyoutBody');
    el.osd = $('#osd');
    el.osdContent = $('#osdContent');
    el.zap = $('#zap');
    el.statsHud = $('#statsHud');
    el.statsBody = $('#statsBody');
    el.zapList = $('#zapList');
    el.zapListBody = $('#zapListBody');
    el.qualityLabel = $('#qualityLabel');
    el.btnFavourite = $('#btnFavourite');

    this.engine = new PlaybackEngine(el.video, {
      onReady: (info) => this.onEngineReady(info),
      onError: (err) => this.onEngineError(err),
      onLevels: () => this.refreshQualityLabel(),
      onAudioTracks: () => {},
      onStats: (s) => this.renderStats(s)
    });

    this.bindControls();
    this.bindVideo();
    this.bindKeys();
    this.applyStoredVolume();
    this.setPlayIcon(false);
    this.setFullscreenIcon(false);
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * @param {object} media
   *   { type:'live'|'movie'|'episode', id, title, subtitle, cover, live,
   *     url, ext, resumeAt, progressKey, meta }
   */
  async play(media) {
    this.init();
    this.formatFallbackUsed = false;
    this.media = media;
    this.open = true;

    const el = this.el;
    el.root.classList.add('open');
    document.body.style.overflow = 'hidden';
    window.aurum.app.keepAwake(true);

    el.title.textContent = media.title || 'Now playing';
    el.subtitle.textContent = media.subtitle || '';
    el.livePill.classList.toggle('hidden', !media.live);
    el.seek.classList.toggle('live', Boolean(media.live));
    this.showError(false);
    this.showLoading(true, media.live ? 'Tuning in…' : 'Loading…');
    this.closeFlyout();
    this.updateFavouriteIcon();
    this.applyFit(store.state.settings.fitMode || 'contain');
    this.applyAspect('auto');
    this.wake();

    if (media.type === 'live') {
      store.pushRecentChannel(media.id).catch(() => {});
    }

    await this.loadCurrent();
  }

  async loadCurrent() {
    const media = this.media;
    if (!media) return;
    try {
      const url = media.url || (await store.getStreamUrl(media.type === 'live' ? 'live' : media.streamType, media.id, media.ext));
      media.url = url;
      const kind = await this.engine.load(url, {
        live: Boolean(media.live),
        startPosition: media.resumeAt || 0
      });
      this.el.video.playbackRate = 1;
      if (kind === ENGINE.MPEGTS && media.resumeAt) {
        // mpegts.js seeks only once data is flowing
        const seek = () => {
          try {
            this.el.video.currentTime = media.resumeAt;
          } catch {
            /* ignore */
          }
        };
        this.el.video.addEventListener('canplay', seek, { once: true });
      }
    } catch (err) {
      this.onEngineError({ message: err.message || 'Could not build a stream URL.', fatal: true });
    }
  }

  close() {
    if (!this.open) return;
    this.saveProgress(true);
    this.open = false;
    this.engine.destroy();
    this.el.root.classList.remove('open');
    this.el.zapList.classList.remove('open');
    this.closeFlyout();
    this.showError(false);
    this.showLoading(false);
    document.body.style.overflow = '';
    window.aurum.app.keepAwake(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.aurum.window.setFullScreen(false);
    this.media = null;
    clearTimeout(this.idleTimer);
    this.el.root.classList.remove('idle', 'cursor-hidden');
  }

  // ---------------------------------------------------------------- events

  onEngineReady() {
    this.showLoading(false);
    this.refreshQualityLabel();
    this.setPlayIcon(!this.el.video.paused);
  }

  onEngineError(err) {
    this.showLoading(false);
    const canFallback = this.media && this.media.live && !this.formatFallbackUsed;
    this.el.errorTitle.textContent = 'Playback failed';
    this.el.errorMsg.textContent = err.message || 'The stream could not be played.';
    $('#playerSwitchFormat').classList.toggle('hidden', !canFallback);
    this.showError(true);
  }

  bindVideo() {
    const v = this.el.video;

    v.addEventListener('play', () => this.setPlayIcon(true));
    v.addEventListener('pause', () => this.setPlayIcon(false));
    v.addEventListener('waiting', () => this.showLoading(true, 'Buffering…'));
    v.addEventListener('playing', () => {
      this.showLoading(false);
      this.showError(false);
    });
    v.addEventListener('canplay', () => this.showLoading(false));
    v.addEventListener('timeupdate', throttle(() => this.renderProgress(), 250));
    v.addEventListener('progress', throttle(() => this.renderProgress(), 500));
    v.addEventListener('durationchange', () => this.renderProgress());
    v.addEventListener('volumechange', () => this.renderVolume());
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('dblclick', () => this.toggleFullscreen());
    v.addEventListener('click', () => this.togglePlay());

    v.addEventListener('enterpictureinpicture', () => toast('Picture in picture', 'The video is now in a floating window.'));
  }

  bindControls() {
    const el = this.el;

    $('#playerBack').onclick = () => this.close();
    el.btnPlay.onclick = (e) => {
      e.stopPropagation();
      this.togglePlay();
    };
    $('#btnBack10').onclick = () => this.nudge(-10);
    $('#btnFwd10').onclick = () => this.nudge(10);
    $('#btnPrevChan').onclick = () => this.zapBy(-1);
    $('#btnNextChan').onclick = () => this.zapBy(1);
    el.btnMute.onclick = () => this.toggleMute();
    el.volSlider.oninput = (e) => {
      el.video.muted = false;
      el.video.volume = Number(e.target.value);
      store.updateSettings({ volume: el.video.volume, muted: false });
    };
    el.btnFullscreen.onclick = () => this.toggleFullscreen();
    $('#btnPip').onclick = () => this.togglePip();
    $('#btnStats').onclick = () => this.toggleStats();
    el.btnFavourite.onclick = () => this.toggleFavourite();
    $('#btnQuality').onclick = () => this.openFlyout('quality');
    $('#btnAudio').onclick = () => this.openFlyout('audio');
    $('#btnSubs').onclick = () => this.openFlyout('subtitles');
    $('#btnSettings').onclick = () => this.openFlyout('settings');
    $('#flyoutClose').onclick = () => this.closeFlyout();
    $('#btnZapList').onclick = () => this.toggleZapList();
    $('#zapListClose').onclick = () => el.zapList.classList.remove('open');

    $('#playerRetry').onclick = () => {
      this.showError(false);
      this.showLoading(true, 'Reconnecting…');
      this.loadCurrent();
    };
    $('#playerErrorClose').onclick = () => this.close();
    $('#playerSwitchFormat').onclick = () => this.switchLiveFormat();

    // seek bar
    el.seek.addEventListener('mousedown', (e) => {
      if (!this.canSeek()) return;
      this.seeking = true;
      this.seekTo(e);
      const move = (ev) => this.seekTo(ev);
      const up = (ev) => {
        this.seekTo(ev);
        this.seeking = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    el.seek.addEventListener('mousemove', (e) => {
      const rect = el.seek.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      el.seekTip.style.left = `${ratio * 100}%`;
      const dur = this.el.video.duration;
      el.seekTip.textContent = this.media && this.media.live
        ? 'Live'
        : Number.isFinite(dur) ? clock(ratio * dur) : '--:--';
    });

    // idle-hide the chrome
    el.root.addEventListener('mousemove', () => this.wake());
    el.root.addEventListener('mouseleave', () => this.sleepSoon(600));
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      const v = this.el.video;
      let handled = true;

      switch (e.key) {
        case ' ':
        case 'k':
          this.togglePlay();
          break;
        case 'Escape':
          if (this.el.flyout.classList.contains('open')) this.closeFlyout();
          else if (this.el.zapList.classList.contains('open')) this.el.zapList.classList.remove('open');
          else if (document.fullscreenElement) this.toggleFullscreen();
          else this.close();
          break;
        case 'ArrowLeft':
          this.nudge(e.shiftKey ? -60 : -10);
          break;
        case 'ArrowRight':
          this.nudge(e.shiftKey ? 60 : 10);
          break;
        case 'ArrowUp':
          this.setVolume(Math.min(1, v.volume + 0.05));
          break;
        case 'ArrowDown':
          this.setVolume(Math.max(0, v.volume - 0.05));
          break;
        case 'PageUp':
          this.zapBy(-1);
          break;
        case 'PageDown':
          this.zapBy(1);
          break;
        case 'm':
          this.toggleMute();
          break;
        case 'f':
          this.toggleFavourite();
          break;
        case 'F11':
          this.toggleFullscreen();
          break;
        case 'i':
          this.toggleStats();
          break;
        case 'l':
          this.toggleZapList();
          break;
        case 'p':
          this.togglePip();
          break;
        case 'c':
          this.openFlyout('subtitles');
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        this.wake();
      }
    });
  }

  // -------------------------------------------------------------- controls

  togglePlay() {
    const v = this.el.video;
    if (v.paused) {
      v.play().catch(() => {});
      this.flashOsd(icon('play'), 'Play');
    } else {
      v.pause();
      this.flashOsd(icon('pause'), 'Paused');
    }
  }

  canSeek() {
    const v = this.el.video;
    if (!this.media) return false;
    if (this.media.live) return false;
    return Number.isFinite(v.duration) && v.duration > 0;
  }

  nudge(seconds) {
    const v = this.el.video;
    if (this.media && this.media.live) {
      // Live: only rewind within the buffer, and snap forward to the edge.
      if (seconds > 0) {
        this.engine.seekToLive();
        this.flashOsd(icon('zap'), 'Live edge');
        return;
      }
      try {
        const start = v.buffered.length ? v.buffered.start(0) : 0;
        v.currentTime = Math.max(start, v.currentTime + seconds);
        this.flashOsd(icon('history'), `${seconds}s`);
      } catch {
        /* nothing buffered */
      }
      return;
    }
    if (!Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(v.duration - 1, Math.max(0, v.currentTime + seconds));
    this.flashOsd(icon(seconds > 0 ? 'chevronRight' : 'chevronLeft'), `${seconds > 0 ? '+' : ''}${seconds}s`);
  }

  seekTo(event) {
    if (!this.canSeek()) return;
    const rect = this.el.seek.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.el.video.currentTime = ratio * this.el.video.duration;
  }

  setVolume(value) {
    const v = this.el.video;
    v.muted = false;
    v.volume = value;
    store.updateSettings({ volume: value, muted: false });
    this.flashOsd(icon(value === 0 ? 'volumeMute' : value < 0.5 ? 'volumeLow' : 'volume'), `${Math.round(value * 100)}%`);
  }

  toggleMute() {
    const v = this.el.video;
    v.muted = !v.muted;
    store.updateSettings({ muted: v.muted });
    this.flashOsd(icon(v.muted ? 'volumeMute' : 'volume'), v.muted ? 'Muted' : `${Math.round(v.volume * 100)}%`);
  }

  applyStoredVolume() {
    const v = this.el.video;
    const s = store.state.settings;
    v.volume = typeof s.volume === 'number' ? s.volume : 1;
    v.muted = Boolean(s.muted);
    this.renderVolume();
  }

  async toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      window.aurum.window.setFullScreen(false);
      this.setFullscreenIcon(false);
    } else {
      window.aurum.window.setFullScreen(true);
      await this.el.root.requestFullscreen().catch(() => {});
      this.setFullscreenIcon(true);
    }
  }

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.el.video.requestPictureInPicture();
    } catch (err) {
      toastErr('Picture in picture unavailable', err.message);
    }
  }

  toggleStats() {
    this.statsVisible = !this.statsVisible;
    this.el.statsHud.classList.toggle('show', this.statsVisible);
    $('#btnStats').classList.toggle('on', this.statsVisible);
  }

  async toggleFavourite() {
    const media = this.media;
    if (!media) return;
    const kind = media.type === 'live' ? 'live' : media.type === 'movie' ? 'movie' : 'series';
    const id = media.type === 'episode' ? media.seriesId : media.id;
    if (!id) return;
    const added = await store.toggleFavorite(kind, id);
    this.updateFavouriteIcon();
    this.flashOsd(icon('heart'), added ? 'Added to favourites' : 'Removed from favourites');
  }

  updateFavouriteIcon() {
    const media = this.media;
    if (!media) return;
    const kind = media.type === 'live' ? 'live' : media.type === 'movie' ? 'movie' : 'series';
    const id = media.type === 'episode' ? media.seriesId : media.id;
    this.el.btnFavourite.classList.toggle('on', store.isFavorite(kind, id));
  }

  /** Live streams can be served as .ts or .m3u8 — let the user flip if one fails. */
  async switchLiveFormat() {
    if (!this.media || !this.media.live) return;
    const current = store.state.settings.liveFormat || 'ts';
    const next = current === 'ts' ? 'm3u8' : 'ts';
    await store.updateSettings({ liveFormat: next });
    this.formatFallbackUsed = true;
    this.media.ext = next;
    this.media.url = '';
    this.showError(false);
    this.showLoading(true, `Retrying as ${next.toUpperCase()}…`);
    toast('Stream format switched', `Now using ${next === 'ts' ? 'MPEG-TS' : 'HLS'} for live channels.`);
    await this.loadCurrent();
  }

  // ----------------------------------------------------------------- zapping

  setPlaylist(channels, currentId) {
    this.playlist = channels || [];
    this.playlistIndex = this.playlist.findIndex((c) => String(c.stream_id) === String(currentId));
  }

  async zapBy(delta) {
    if (!this.media || !this.media.live || this.playlist.length < 2) return;
    const next = (this.playlistIndex + delta + this.playlist.length) % this.playlist.length;
    await this.zapTo(next);
  }

  async zapTo(index) {
    const channel = this.playlist[index];
    if (!channel) return;
    this.playlistIndex = index;

    this.saveProgress(true);
    this.media = {
      type: 'live',
      id: channel.stream_id,
      title: tidyChannelName(channel.name),
      subtitle: '',
      cover: channel.stream_icon,
      live: true,
      ext: store.state.settings.liveFormat || 'ts',
      url: ''
    };
    this.el.title.textContent = this.media.title;
    this.el.subtitle.textContent = '';
    this.showError(false);
    this.showLoading(true, 'Tuning in…');
    this.updateFavouriteIcon();
    this.showZapOsd(channel);
    this.renderZapList();
    store.pushRecentChannel(channel.stream_id).catch(() => {});
    await this.loadCurrent();
    this.loadNowPlayingEpg(channel);
  }

  async loadNowPlayingEpg(channel) {
    try {
      const map = await store.epgNowNext([String(channel.stream_id)]);
      const entry = map[String(channel.stream_id)];
      if (entry && entry.now) {
        const text = `${entry.now.t} · ${timeHM(entry.now.s)} – ${timeHM(entry.now.e)}`;
        this.el.subtitle.textContent = text;
        const zapNow = $('#zapNow');
        if (zapNow) zapNow.textContent = entry.now.t;
        return;
      }
    } catch {
      /* fall through to the short EPG endpoint */
    }
    try {
      const short = await store.getShortEpg(channel.stream_id, 1);
      const item = short && short.epg_listings && short.epg_listings[0];
      if (item) {
        const title = decodeMaybeBase64(item.title);
        this.el.subtitle.textContent = title;
      }
    } catch {
      /* the provider may not expose short EPG */
    }
  }

  showZapOsd(channel) {
    const el = this.el;
    $('#zapNum').textContent = String(channel.num || this.playlistIndex + 1);
    $('#zapName').textContent = tidyChannelName(channel.name);
    $('#zapNow').textContent = '';
    const logo = $('#zapLogo');
    clear(logo);
    if (channel.stream_icon) {
      const img = h('img', { src: channel.stream_icon, alt: '', referrerPolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      logo.appendChild(img);
    }
    el.zap.classList.add('show');
    clearTimeout(this.zapTimer);
    this.zapTimer = setTimeout(() => el.zap.classList.remove('show'), 4000);
  }

  toggleZapList() {
    const open = this.el.zapList.classList.toggle('open');
    if (open) this.renderZapList();
  }

  renderZapList() {
    const body = this.el.zapListBody;
    clear(body);
    if (!this.playlist.length) {
      body.appendChild(h('p.dim', { style: { padding: '20px', fontSize: '13px' } }, 'No channel list loaded.'));
      return;
    }
    this.playlist.forEach((channel, index) => {
      const active = index === this.playlistIndex;
      const row = h(
        'button.chan',
        {
          onclick: () => this.zapTo(index),
          class: active ? 'playing' : ''
        },
        h('span.chan__num', String(channel.num || index + 1)),
        h('span.chan__logo', channelLogo(channel)),
        h('span.chan__body', h('span.chan__name.truncate', tidyChannelName(channel.name)))
      );
      body.appendChild(row);
      if (active) setTimeout(() => row.scrollIntoView({ block: 'center' }), 30);
    });
  }

  // ---------------------------------------------------------------- flyout

  openFlyout(kind) {
    const el = this.el;
    if (el.flyout.classList.contains('open') && el.flyout.dataset.kind === kind) {
      this.closeFlyout();
      return;
    }
    el.flyout.dataset.kind = kind;
    el.flyout.classList.add('open');
    clear(el.flyoutBody);

    if (kind === 'quality') {
      el.flyoutTitle.textContent = 'Video quality';
      el.flyoutBody.appendChild(this.buildQualityMenu());
    } else if (kind === 'audio') {
      el.flyoutTitle.textContent = 'Audio track';
      el.flyoutBody.appendChild(this.buildAudioMenu());
    } else if (kind === 'subtitles') {
      el.flyoutTitle.textContent = 'Subtitles';
      el.flyoutBody.appendChild(this.buildSubtitleMenu());
    } else {
      el.flyoutTitle.textContent = 'Playback settings';
      el.flyoutBody.appendChild(this.buildSettingsMenu());
    }
  }

  closeFlyout() {
    this.el.flyout.classList.remove('open');
    this.el.flyout.dataset.kind = '';
  }

  menuItem(label, { active, sub, onclick }) {
    return h(
      'button.flyout__item',
      { onclick, class: active ? 'active' : '' },
      h('span.tick', icon('check', 15)),
      h('span.grow', label),
      sub ? h('span.sub', sub) : null
    );
  }

  buildQualityMenu() {
    const wrap = h('div.flyout__group');
    const levels = this.engine.levels;

    if (!levels.length) {
      wrap.appendChild(h('div.flyout__label', 'Source'));
      const stats = this.engine.stats();
      wrap.appendChild(
        this.menuItem('Single quality stream', {
          active: true,
          sub: stats.resolution,
          onclick: () => {}
        })
      );
      wrap.appendChild(
        h(
          'p.dim',
          { style: { padding: '8px 12px 12px', fontSize: '11.5px', lineHeight: '1.5' } },
          this.media && this.media.live
            ? 'This channel is delivered at a single bitrate, so there are no quality levels to choose from. Switching the stream format to HLS in Settings sometimes exposes more.'
            : 'This title is delivered as a single file, so quality is fixed.'
        )
      );
      return wrap;
    }

    wrap.appendChild(h('div.flyout__label', 'Levels'));
    wrap.appendChild(
      this.menuItem('Auto', {
        active: this.engine.autoLevelEnabled,
        sub: this.engine.autoLevelEnabled && this.engine.currentLevel >= 0
          ? `${levels[this.engine.currentLevel]?.height || '?'}p`
          : '',
        onclick: () => {
          this.engine.currentLevel = -1;
          this.refreshQualityLabel();
          this.closeFlyout();
          this.flashOsd(icon('sliders'), 'Quality: Auto');
        }
      })
    );

    levels
      .map((level, index) => ({ level, index }))
      .sort((a, b) => (b.level.height || 0) - (a.level.height || 0))
      .forEach(({ level, index }) => {
        const label = level.height ? `${level.height}p` : `Level ${index + 1}`;
        wrap.appendChild(
          this.menuItem(label, {
            active: !this.engine.autoLevelEnabled && this.engine.currentLevel === index,
            sub: level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : '',
            onclick: () => {
              this.engine.currentLevel = index;
              this.refreshQualityLabel();
              this.closeFlyout();
              this.flashOsd(icon('sliders'), `Quality: ${label}`);
            }
          })
        );
      });

    return wrap;
  }

  buildAudioMenu() {
    const wrap = h('div.flyout__group');
    const tracks = this.engine.audioTracks;
    if (!tracks.length) {
      wrap.appendChild(
        h('p.dim', { style: { padding: '14px 12px', fontSize: '12px', lineHeight: '1.55' } },
          'This stream exposes a single audio track. Multi-language audio is only selectable on HLS streams and MP4 files that carry more than one track.')
      );
      return wrap;
    }
    const current = this.engine.currentAudioTrack;
    tracks.forEach((track) => {
      wrap.appendChild(
        this.menuItem(track.label, {
          active: track.id === current,
          sub: track.lang ? track.lang.toUpperCase() : '',
          onclick: () => {
            this.engine.currentAudioTrack = track.id;
            this.closeFlyout();
            this.flashOsd(icon('volume'), `Audio: ${track.label}`);
          }
        })
      );
    });
    return wrap;
  }

  buildSubtitleMenu() {
    const wrap = h('div.flyout__group');
    const tracks = Array.from(this.el.video.textTracks || []);

    wrap.appendChild(
      this.menuItem('Off', {
        active: !tracks.some((t) => t.mode === 'showing'),
        onclick: () => {
          tracks.forEach((t) => {
            t.mode = 'disabled';
          });
          this.closeFlyout();
          this.flashOsd(icon('x'), 'Subtitles off');
        }
      })
    );

    if (!tracks.length) {
      wrap.appendChild(
        h('p.dim', { style: { padding: '12px', fontSize: '11.5px', lineHeight: '1.55' } },
          'No subtitle tracks were found in this stream. Xtream providers usually burn subtitles into the picture or supply separate language channels rather than sending selectable tracks.')
      );
      return wrap;
    }

    tracks.forEach((track, index) => {
      wrap.appendChild(
        this.menuItem(track.label || track.language || `Track ${index + 1}`, {
          active: track.mode === 'showing',
          sub: (track.language || '').toUpperCase(),
          onclick: () => {
            tracks.forEach((t, i) => {
              t.mode = i === index ? 'showing' : 'disabled';
            });
            this.closeFlyout();
            this.flashOsd(icon('check'), 'Subtitles on');
          }
        })
      );
    });
    return wrap;
  }

  buildSettingsMenu() {
    const frag = document.createDocumentFragment();
    const v = this.el.video;

    // --- picture fit
    const fitGroup = h('div.flyout__group', h('div.flyout__label', 'Picture fit'));
    FIT_MODES.forEach((mode) => {
      fitGroup.appendChild(
        this.menuItem(mode.label, {
          active: (store.state.settings.fitMode || 'contain') === mode.id,
          sub: mode.hint,
          onclick: () => {
            this.applyFit(mode.id);
            store.updateSettings({ fitMode: mode.id });
            this.openFlyout('settings');
            this.flashOsd(icon('maximize'), mode.label);
          }
        })
      );
    });
    frag.appendChild(fitGroup);

    // --- aspect ratio
    const arGroup = h('div.flyout__group', h('div.flyout__label', 'Aspect ratio'));
    ASPECTS.forEach((ar) => {
      arGroup.appendChild(
        this.menuItem(ar.label, {
          active: (this.el.stage.dataset.ar || 'auto') === ar.id,
          onclick: () => {
            this.applyAspect(ar.id);
            this.openFlyout('settings');
            this.flashOsd(icon('maximize'), ar.label);
          }
        })
      );
    });
    frag.appendChild(arGroup);

    // --- speed (VOD only)
    if (!this.media || !this.media.live) {
      const speedGroup = h('div.flyout__group', h('div.flyout__label', 'Playback speed'));
      SPEEDS.forEach((speed) => {
        speedGroup.appendChild(
          this.menuItem(speed === 1 ? 'Normal' : `${speed}×`, {
            active: Math.abs(v.playbackRate - speed) < 0.01,
            onclick: () => {
              v.playbackRate = speed;
              this.openFlyout('settings');
              this.flashOsd(icon('zap'), `${speed}×`);
            }
          })
        );
      });
      frag.appendChild(speedGroup);
    } else {
      const liveGroup = h('div.flyout__group', h('div.flyout__label', 'Live'));
      liveGroup.appendChild(
        this.menuItem('Jump to live edge', {
          active: false,
          sub: `${Math.round(this.engine.liveLatency())}s behind`,
          onclick: () => {
            this.engine.seekToLive();
            this.closeFlyout();
            this.flashOsd(icon('zap'), 'Live edge');
          }
        })
      );
      const format = store.state.settings.liveFormat || 'ts';
      liveGroup.appendChild(
        this.menuItem(format === 'ts' ? 'Switch to HLS (m3u8)' : 'Switch to MPEG-TS', {
          active: false,
          sub: `now ${format.toUpperCase()}`,
          onclick: () => {
            this.formatFallbackUsed = false;
            this.switchLiveFormat();
            this.closeFlyout();
          }
        })
      );
      frag.appendChild(liveGroup);
    }

    // --- engine info
    const info = h('div.flyout__group', h('div.flyout__label', 'Stream'));
    const stats = this.engine.stats();
    info.appendChild(
      this.menuItem('Show statistics', {
        active: this.statsVisible,
        sub: stats.resolution,
        onclick: () => {
          this.toggleStats();
          this.closeFlyout();
        }
      })
    );
    info.appendChild(
      this.menuItem('Open in external player', {
        active: false,
        sub: 'VLC etc.',
        onclick: () => {
          if (this.media && this.media.url) {
            window.aurum.app.openExternal(this.media.url);
            toast('Handing off', 'The stream URL was passed to your default handler.');
          }
          this.closeFlyout();
        }
      })
    );
    frag.appendChild(info);

    return frag;
  }

  applyFit(mode) {
    this.el.video.dataset.fit = mode;
  }

  applyAspect(ar) {
    this.el.stage.dataset.ar = ar;
  }

  refreshQualityLabel() {
    const levels = this.engine.levels;
    const label = this.el.qualityLabel;
    if (!levels.length) {
      const height = this.el.video.videoHeight;
      label.textContent = height ? `${height}p` : 'Auto';
      return;
    }
    if (this.engine.autoLevelEnabled) {
      const active = levels[this.engine.currentLevel];
      label.textContent = active && active.height ? `Auto · ${active.height}p` : 'Auto';
    } else {
      const active = levels[this.engine.currentLevel];
      label.textContent = active && active.height ? `${active.height}p` : 'Manual';
    }
  }

  // ---------------------------------------------------------------- render

  renderProgress() {
    const v = this.el.video;
    const live = this.media && this.media.live;

    if (live) {
      this.el.seekPlayed.style.width = '100%';
      this.el.seekBuffer.style.width = '100%';
      this.el.seekKnob.style.left = '100%';
      const latency = this.engine.liveLatency();
      this.el.timeCur.textContent = timeHM(Date.now());
      this.el.timeDur.textContent = latency > 1 ? `-${clock(latency)}` : 'LIVE';
      return;
    }

    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      this.el.timeCur.textContent = clock(v.currentTime);
      this.el.timeDur.textContent = '--:--';
      return;
    }

    const ratio = v.currentTime / dur;
    this.el.seekPlayed.style.width = `${ratio * 100}%`;
    this.el.seekKnob.style.left = `${ratio * 100}%`;
    try {
      if (v.buffered.length) {
        this.el.seekBuffer.style.width = `${(v.buffered.end(v.buffered.length - 1) / dur) * 100}%`;
      }
    } catch {
      /* ignore */
    }
    this.el.timeCur.textContent = clock(v.currentTime);
    this.el.timeDur.textContent = clock(dur);

    this.saveProgress(false);
  }

  renderVolume() {
    const v = this.el.video;
    this.el.volSlider.value = String(v.muted ? 0 : v.volume);
    clear(this.el.btnMute).appendChild(
      icon(v.muted || v.volume === 0 ? 'volumeMute' : v.volume < 0.5 ? 'volumeLow' : 'volume')
    );
  }

  renderStats(s) {
    if (!this.statsVisible) return;
    const rows = [
      ['Engine', s.engine === 'hls' ? 'hls.js' : s.engine === 'mpegts' ? 'mpegts.js' : 'Chromium'],
      ['Resolution', s.resolution],
      ['Level', s.levelLabel || '—'],
      ['Bandwidth', bitrate(s.bandwidth)],
      ['Buffer', `${s.buffered.toFixed(1)}s`],
      ['Dropped', `${s.droppedFrames} / ${s.totalFrames}`],
      ['State', READY_STATES[s.readyState] || s.readyState]
    ];
    if (s.live) rows.push(['Latency', `${this.engine.liveLatency().toFixed(1)}s`]);

    clear(this.el.statsBody);
    for (const [label, value] of rows) {
      this.el.statsBody.appendChild(h('div.stats-hud__row', h('span', label), h('b', String(value))));
    }
  }

  setPlayIcon(playing) {
    clear(this.el.btnPlay).appendChild(icon(playing ? 'pause' : 'play'));
  }

  setFullscreenIcon(on) {
    clear(this.el.btnFullscreen).appendChild(icon(on ? 'collapse' : 'expand'));
  }

  showLoading(show, text) {
    this.el.loading.classList.toggle('show', show);
    if (text) this.el.loadingText.textContent = text;
  }

  showError(show) {
    this.el.error.classList.toggle('show', show);
  }

  flashOsd(iconNode, text) {
    const el = this.el;
    clear(el.osdContent);
    el.osdContent.appendChild(h('span.row.gap-3', iconNode, h('span', text)));
    el.osd.classList.add('show');
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => el.osd.classList.remove('show'), 1100);
  }

  wake() {
    const el = this.el;
    el.root.classList.remove('idle', 'cursor-hidden');
    this.sleepSoon(2800);
  }

  sleepSoon(ms) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.open) return;
      if (this.el.flyout.classList.contains('open')) return;
      if (this.el.zapList.classList.contains('open')) return;
      if (this.el.video.paused) return;
      this.el.root.classList.add('idle', 'cursor-hidden');
    }, ms);
  }

  // --------------------------------------------------------------- progress

  saveProgress(force) {
    const media = this.media;
    if (!media || media.live || !media.progressKey) return;
    const v = this.el.video;
    if (!Number.isFinite(v.duration) || v.duration <= 0) return;
    if (!force && Date.now() - this.lastSavedAt < 5000) return;
    this.lastSavedAt = Date.now();

    store.saveProgress({
      key: media.progressKey,
      type: media.type,
      id: media.id,
      seriesId: media.seriesId || null,
      name: media.title,
      subtitle: media.subtitle || '',
      cover: media.cover || '',
      position: v.currentTime,
      duration: v.duration,
      ext: media.ext || '',
      meta: media.meta || null
    }).catch(() => {});
  }

  onEnded() {
    const media = this.media;
    if (!media) return;
    if (media.progressKey) store.removeProgress(media.progressKey).catch(() => {});
    if (media.onEnded) {
      media.onEnded();
      return;
    }
    this.close();
  }
}

const READY_STATES = ['nothing', 'metadata', 'current', 'future', 'enough'];

function channelLogo(channel) {
  if (channel.stream_icon) {
    const img = h('img', { src: channel.stream_icon, alt: '', referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => {
      img.replaceWith(h('span', initials(channel.name)));
    });
    return img;
  }
  return h('span', initials(channel.name));
}

function initials(name) {
  return String(name || '?')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

/** Xtream's get_short_epg base64-encodes titles and descriptions. */
export function decodeMaybeBase64(value) {
  const str = String(value || '');
  if (!str) return '';
  if (!/^[A-Za-z0-9+/=\s]+$/.test(str) || str.length % 4 !== 0) return str;
  try {
    const decoded = decodeURIComponent(escape(atob(str)));
    return decoded && /[\x20-\x7E]/.test(decoded) ? decoded : str;
  } catch {
    return str;
  }
}

export const player = new Player();
