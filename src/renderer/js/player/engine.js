/**
 * Playback engine abstraction.
 *
 * Three back-ends, picked from the URL:
 *   .m3u8            -> hls.js       (adaptive, exposes quality levels + audio tracks)
 *   .ts / no ext     -> mpegts.js    (raw MPEG-TS over HTTP, what most Xtream lines serve)
 *   .mp4/.mkv/...    -> native       (Chromium's own demuxer)
 *
 * The engine only owns the media pipeline; all UI lives in player.js.
 */

const Hls = window.Hls;
const mpegts = window.mpegts;

export const ENGINE = { HLS: 'hls', MPEGTS: 'mpegts', NATIVE: 'native' };

export function pickEngine(url, { live } = {}) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) {
    return Hls && Hls.isSupported() ? ENGINE.HLS : ENGINE.NATIVE;
  }
  if (clean.endsWith('.ts') || (live && !/\.[a-z0-9]{2,4}$/.test(clean))) {
    return mpegts && mpegts.isSupported() ? ENGINE.MPEGTS : ENGINE.NATIVE;
  }
  return ENGINE.NATIVE;
}

export class PlaybackEngine {
  /**
   * @param {HTMLVideoElement} video
   * @param {{onError:Function, onReady:Function, onLevels:Function, onAudioTracks:Function, onStats:Function}} handlers
   */
  constructor(video, handlers = {}) {
    this.video = video;
    this.handlers = handlers;
    this.kind = null;
    this.hls = null;
    this.mpegts = null;
    this.url = '';
    this.isLive = false;
    this._statsTimer = null;
    this._recoverAttempts = 0;
  }

  get levels() {
    if (this.kind === ENGINE.HLS && this.hls) return this.hls.levels || [];
    return [];
  }

  get currentLevel() {
    if (this.kind === ENGINE.HLS && this.hls) return this.hls.currentLevel;
    return -1;
  }

  set currentLevel(index) {
    if (this.kind === ENGINE.HLS && this.hls) {
      this.hls.nextLevel = index;
      this.hls.currentLevel = index;
    }
  }

  get autoLevelEnabled() {
    return this.kind === ENGINE.HLS && this.hls ? this.hls.autoLevelEnabled : true;
  }

  get audioTracks() {
    if (this.kind === ENGINE.HLS && this.hls && this.hls.audioTracks && this.hls.audioTracks.length) {
      return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Track ${i + 1}`, lang: t.lang || '' }));
    }
    if (this.kind === ENGINE.MPEGTS) return [];
    const native = this.video.audioTracks;
    if (native && native.length) {
      return Array.from(native).map((t, i) => ({
        id: i,
        label: t.label || t.language || `Track ${i + 1}`,
        lang: t.language || ''
      }));
    }
    return [];
  }

  get currentAudioTrack() {
    if (this.kind === ENGINE.HLS && this.hls) return this.hls.audioTrack;
    const native = this.video.audioTracks;
    if (native) {
      for (let i = 0; i < native.length; i += 1) if (native[i].enabled) return i;
    }
    return -1;
  }

  set currentAudioTrack(index) {
    if (this.kind === ENGINE.HLS && this.hls) {
      this.hls.audioTrack = index;
      return;
    }
    const native = this.video.audioTracks;
    if (native) {
      for (let i = 0; i < native.length; i += 1) native[i].enabled = i === index;
    }
  }

  // ------------------------------------------------------------------ load

  async load(url, { live = false, startPosition = 0 } = {}) {
    this.destroy(false);
    this.url = url;
    this.isLive = live;
    this._recoverAttempts = 0;
    this.kind = pickEngine(url, { live });

    if (this.kind === ENGINE.HLS) this._loadHls(url, live, startPosition);
    else if (this.kind === ENGINE.MPEGTS) this._loadMpegts(url, live);
    else this._loadNative(url, startPosition);

    this._startStats();
    return this.kind;
  }

  _loadHls(url, live, startPosition) {
    const hls = new Hls({
      lowLatencyMode: false,
      enableWorker: true,
      backBufferLength: live ? 45 : 90,
      maxBufferLength: live ? 20 : 45,
      maxMaxBufferLength: live ? 40 : 120,
      maxBufferSize: 90 * 1000 * 1000,
      liveSyncDurationCount: 3,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 20000,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 6,
      startPosition: live ? -1 : startPosition || -1,
      capLevelToPlayerSize: false,
      progressive: false
    });

    this.hls = hls;
    hls.attachMedia(this.video);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this._emit('onLevels', this.levels);
      this._emit('onReady', { kind: this.kind, live });
      this.video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, () => this._emit('onLevels', this.levels));
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this._emit('onAudioTracks', this.audioTracks));

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && this._recoverAttempts < 3) {
        this._recoverAttempts += 1;
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this._recoverAttempts < 3) {
        this._recoverAttempts += 1;
        hls.recoverMediaError();
        return;
      }
      this._emit('onError', {
        fatal: true,
        message: describeHlsError(data),
        detail: data.details,
        engine: ENGINE.HLS
      });
    });
  }

  _loadMpegts(url, live) {
    const player = mpegts.createPlayer(
      {
        type: 'mpegts',
        isLive: live,
        url,
        cors: true,
        withCredentials: false
      },
      {
        enableWorker: true,
        enableStashBuffer: !live,
        stashInitialSize: live ? 128 : 384,
        liveBufferLatencyChasing: live,
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1.0,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30,
        fixAudioTimestampGap: true,
        seekType: 'range'
      }
    );

    this.mpegts = player;
    player.attachMediaElement(this.video);

    player.on(mpegts.Events.MEDIA_INFO, () => {
      this._emit('onReady', { kind: this.kind, live });
    });

    player.on(mpegts.Events.ERROR, (type, detail, info) => {
      this._emit('onError', {
        fatal: true,
        message: describeMpegtsError(type, detail, info),
        detail: String(detail),
        engine: ENGINE.MPEGTS
      });
    });

    player.load();
    player.play().catch(() => {});
  }

  _loadNative(url, startPosition) {
    const video = this.video;
    video.src = url;

    const onLoaded = () => {
      if (startPosition > 0 && Number.isFinite(video.duration)) {
        try {
          video.currentTime = Math.min(startPosition, video.duration - 5);
        } catch {
          /* seeking before metadata settles */
        }
      }
      this._emit('onAudioTracks', this.audioTracks);
      this._emit('onReady', { kind: this.kind, live: this.isLive });
      video.play().catch(() => {});
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    this._nativeLoadedHandler = onLoaded;

    const onError = () => {
      const err = video.error;
      this._emit('onError', {
        fatal: true,
        message: describeNativeError(err, url),
        detail: err ? `code ${err.code}` : 'unknown',
        engine: ENGINE.NATIVE
      });
    };
    video.addEventListener('error', onError);
    this._nativeErrorHandler = onError;

    video.load();
  }

  // ----------------------------------------------------------------- stats

  _startStats() {
    clearInterval(this._statsTimer);
    this._statsTimer = setInterval(() => this._emit('onStats', this.stats()), 1000);
  }

  stats() {
    const video = this.video;
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;

    let buffered = 0;
    try {
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
          buffered = video.buffered.end(i) - video.currentTime;
          break;
        }
      }
    } catch {
      /* buffered can throw before metadata */
    }

    let bandwidth = 0;
    let levelLabel = '';
    if (this.kind === ENGINE.HLS && this.hls) {
      bandwidth = this.hls.bandwidthEstimate || 0;
      const level = this.hls.levels && this.hls.levels[this.hls.currentLevel];
      if (level) levelLabel = `${level.height || '?'}p @ ${Math.round((level.bitrate || 0) / 1000)} kbps`;
    } else if (this.kind === ENGINE.MPEGTS && this.mpegts) {
      const info = this.mpegts.statisticsInfo || {};
      bandwidth = (info.speed || 0) * 8 * 1024;
    }

    return {
      engine: this.kind,
      resolution: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '—',
      buffered,
      bandwidth,
      levelLabel,
      droppedFrames: quality ? quality.droppedVideoFrames : 0,
      totalFrames: quality ? quality.totalVideoFrames : 0,
      readyState: video.readyState,
      currentTime: video.currentTime,
      live: this.isLive
    };
  }

  /** How far behind the live edge we are, in seconds (HLS/TS only). */
  liveLatency() {
    const video = this.video;
    try {
      if (this.kind === ENGINE.HLS && this.hls && this.hls.liveSyncPosition) {
        return Math.max(0, this.hls.liveSyncPosition - video.currentTime);
      }
      if (video.buffered.length) {
        return Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
      }
    } catch {
      /* not available yet */
    }
    return 0;
  }

  seekToLive() {
    const video = this.video;
    try {
      if (this.kind === ENGINE.HLS && this.hls && this.hls.liveSyncPosition) {
        video.currentTime = this.hls.liveSyncPosition;
      } else if (video.buffered.length) {
        video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.5;
      }
      video.play().catch(() => {});
    } catch {
      /* nothing buffered yet */
    }
  }

  // --------------------------------------------------------------- destroy

  destroy(clearSrc = true) {
    clearInterval(this._statsTimer);
    this._statsTimer = null;

    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {
        /* already gone */
      }
      this.hls = null;
    }

    if (this.mpegts) {
      try {
        this.mpegts.pause();
        this.mpegts.unload();
        this.mpegts.detachMediaElement();
        this.mpegts.destroy();
      } catch {
        /* already gone */
      }
      this.mpegts = null;
    }

    if (this._nativeErrorHandler) {
      this.video.removeEventListener('error', this._nativeErrorHandler);
      this._nativeErrorHandler = null;
    }
    if (this._nativeLoadedHandler) {
      this.video.removeEventListener('loadedmetadata', this._nativeLoadedHandler);
      this._nativeLoadedHandler = null;
    }

    if (clearSrc) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch {
        /* detached */
      }
    }
    this.kind = null;
  }

  _emit(name, payload) {
    const fn = this.handlers[name];
    if (fn) fn(payload);
  }
}

// ------------------------------------------------------------ error copy

function describeHlsError(data) {
  const details = String(data.details || '');
  if (details.includes('manifestLoadError')) {
    return 'The server refused the playlist request. The channel may be offline, or your line may have hit its connection limit.';
  }
  if (details.includes('manifestParsingError')) {
    return 'The server sent a playlist this player could not read. Try switching the stream format to MPEG-TS in Settings.';
  }
  if (details.includes('levelLoadError') || details.includes('fragLoadError')) {
    return 'The stream stopped sending data. This is usually a provider-side outage or a connection-limit block.';
  }
  if (data.type === 'mediaError') {
    return 'The video could not be decoded. The stream may use a codec Chromium cannot play (for example HEVC or AC-3 audio).';
  }
  return data.reason || 'The stream could not be played.';
}

function describeMpegtsError(type, detail, info) {
  const code = info && info.code;
  if (code === 403) return 'Access denied (403). Your line may be blocked, expired, or already at its connection limit.';
  if (code === 404) return 'This stream no longer exists on the server (404).';
  if (code === 401) return 'Authentication failed (401). Check your username and password in Settings.';
  if (String(detail).includes('NetworkError') || type === 'NetworkError') {
    return 'Network error reaching the stream. Check your connection, or the provider may be down.';
  }
  if (type === 'MediaError') {
    return 'The stream could not be decoded — the codec is likely unsupported (HEVC/H.265 or AC-3 audio).';
  }
  return (info && info.msg) || 'The stream could not be played.';
}

function describeNativeError(err, url) {
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase();
  if (!err) return 'The stream could not be played.';
  switch (err.code) {
    case 1:
      return 'Playback was aborted.';
    case 2:
      return 'A network error interrupted the stream.';
    case 3:
      return 'The video could not be decoded. The file may be damaged or use an unsupported codec.';
    case 4:
      if (['mkv', 'avi', 'flv', 'wmv'].includes(ext)) {
        return `This title is served as .${ext}, a container Chromium cannot play. Try another version of the title, or open it in an external player such as VLC.`;
      }
      return 'This stream format is not supported by the built-in player.';
    default:
      return err.message || 'The stream could not be played.';
  }
}
