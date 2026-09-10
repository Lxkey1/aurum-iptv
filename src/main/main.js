'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, session, shell, nativeTheme, powerSaveBlocker, dialog } = require('electron');

const { Store } = require('./store');
const { XtreamClient, XtreamError, parseServerInput } = require('./xtream');
const { EpgManager } = require('./epg');
const { DiskCache } = require('./cache');
const { CatalogueDb } = require('./catalogue-db');
const { TmdbClient } = require('./tmdb');

const isDev = process.argv.includes('--dev');

let store;
let epg;
let cache;
let catalogue;
let tmdb;
let mainWindow = null;
let client = null;
let powerBlockerId = null;

// Chromium flags must be set before `ready`.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

// A single instance keeps the config file and EPG cache consistent.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------- networking

/**
 * IPTV panels almost never send CORS headers, and hls.js/mpegts.js fetch
 * segments with XHR. Rewriting the response headers here lets the players work
 * without turning off webSecurity.
 */
function installNetworkHooks(ses) {
  const streamish = /\.(m3u8|ts|mp4|mkv|avi|m4v|mov|aac|mp3|vtt|srt|key)(\?|$)|\/(live|movie|series)\/|player_api\.php|xmltv\.php|timeshift\.php|streaming\//i;

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (streamish.test(details.url)) {
      headers['User-Agent'] = store.settings.userAgent || 'VLC/3.0.20 LibVLC/3.0.20';
      delete headers.Origin;
      delete headers.origin;
      delete headers.Referer;
      delete headers.referer;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower.startsWith('access-control-')) delete headers[key];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, HEAD, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Expose-Headers'] = ['*'];
    callback({ responseHeaders: headers });
  });

  // Self-signed certificates are common on small panels.
  ses.setCertificateVerifyProc((request, callback) => callback(0));
}

// ------------------------------------------------------------------- window

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#08090C',
    title: 'Aurum IPTV',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  if (isDev) {
    // Surface renderer errors in the terminal — much easier than the DevTools pane.
    const levels = ['debug', 'info', 'warn', 'error'];
    mainWindow.webContents.on('console-message', (event) => {
      const level = levels[event.level] || event.level;
      console.log(`[renderer:${level}] ${event.message}  (${event.sourceId}:${event.lineNumber})`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer] process gone', details)
    );
    mainWindow.webContents.on('preload-error', (_e, file, error) =>
      console.error('[preload] failed', file, error)
    );
  }

  const pushWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen()
    });
  };
  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('enter-full-screen', pushWindowState);
  mainWindow.on('leave-full-screen', pushWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  store = new Store();
  cache = new DiskCache();
  catalogue = new CatalogueDb().open();
  tmdb = new TmdbClient(store.settings.tmdbKey || '', store.settings.tmdbLanguage || 'en-GB');
  epg = new EpgManager();

  if (!store.settings.hwAccel) app.disableHardwareAcceleration();

  nativeTheme.themeSource = 'dark';
  installNetworkHooks(session.defaultSession);

  epg.onProgress((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('epg:progress', payload);
  });
  epg.loadFromDisk();

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
  if (epg) epg.cancel();
  if (store) store.save(true);
  if (catalogue) catalogue.close();
  app.quit();
});

// --------------------------------------------------------------------- IPC

function ensureClient() {
  if (client) return client;
  const profile = store.getProfile();
  if (!profile) throw new XtreamError('You are signed out.', 'NO_SESSION');
  client = new XtreamClient({ ...profile, userAgent: store.settings.userAgent });
  return client;
}

/** Wraps a handler so the renderer always receives {ok, data|error}. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const data = await fn(payload, event);
      return { ok: true, data };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const code = err && err.code ? err.code : 'ERROR';
      if (isDev) console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: message, code };
    }
  });
}

/** Cached Xtream call — categories and big lists are slow to fetch repeatedly. */
async function cached(key, ttl, producer) {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = await producer();
  if (value) cache.set(key, value, ttl);
  return value;
}

const MIN = 60 * 1000;

function registerIpc() {
  // ---- window chrome
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow && mainWindow.close());
  ipcMain.on('window:fullscreen', (_e, value) => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(typeof value === 'boolean' ? value : !mainWindow.isFullScreen());
  });
  ipcMain.on('app:openExternal', (_e, url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Keep the display awake while something is playing.
  ipcMain.on('power:keepAwake', (_e, active) => {
    if (active && powerBlockerId === null) {
      powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    } else if (!active && powerBlockerId !== null) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
    }
  });

  // ---- auth
  handle('auth:login', async ({ server, username, password, remember }) => {
    const parsed = parseServerInput(server);
    const host = parsed.host;
    if (!host) throw new XtreamError('That server address does not look valid.', 'BAD_HOST');

    const user = (username || parsed.username || '').trim();
    const pass = password || parsed.password || '';
    if (!user || !pass) throw new XtreamError('Enter both a username and a password.', 'MISSING_CREDENTIALS');

    const candidate = new XtreamClient({ host, username: user, password: pass, userAgent: store.settings.userAgent });
    const result = await candidate.authenticate();

    client = candidate;
    cache.clear();
    if (remember !== false) {
      store.setProfile({ name: result.userInfo.username || user, host, username: user, password: pass });
    }
    return { ...result, credentials: { host, username: user } };
  });

  handle('auth:restore', async () => {
    const profile = store.getProfile();
    if (!profile) return null;
    client = new XtreamClient({ ...profile, userAgent: store.settings.userAgent });
    const result = await client.authenticate();
    return { ...result, credentials: { host: profile.host, username: profile.username } };
  });

  handle('auth:hasProfile', async () => Boolean(store.getProfile()));

  handle('auth:logout', async () => {
    client = null;
    store.clearProfile();
    cache.clear();
    catalogue.ingest({});          // empties the catalogue, keeps user overrides
    catalogue.resetChannelPrefs(); // signing out should forget those too
    epg.clear();
    return true;
  });

  // ---- catalogue (SQLite-backed)

  /**
   * Pull the full catalogue from the provider and ingest it into SQLite.
   * The provider only serves these as three enormous documents, so there is no
   * way to page the fetch itself - but it happens once, and everything the UI
   * asks for afterwards is an indexed query.
   */
  handle('catalogue:sync', async ({ force = false } = {}) => {
    const c = ensureClient();
    if (!force && catalogue.isPopulated) return { ...catalogue.stats(), skipped: true };

    const send = (text, pct) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('catalogue:progress', { text, pct });
      }
    };

    send('Fetching channels…', 5);
    const [liveCategories, channels] = await Promise.all([
      c.liveCategories().catch(() => []),
      c.liveStreams()
    ]);

    send('Fetching films…', 35);
    const [vodCategories, movies] = await Promise.all([
      c.vodCategories().catch(() => []),
      c.vodStreams().catch(() => [])
    ]);

    send('Fetching box sets…', 65);
    const [seriesCategories, series] = await Promise.all([
      c.seriesCategories().catch(() => []),
      c.seriesList().catch(() => [])
    ]);

    send('Indexing…', 85);
    const stats = catalogue.ingest({
      channels: channels || [],
      movies: movies || [],
      series: series || [],
      liveCategories,
      vodCategories,
      seriesCategories
    });

    // Re-align the guide with the freshly ingested channel list.
    if (epg.index) epg.buildChannelMap(catalogue.epgMappingRows());

    send('Ready', 100);
    return stats;
  });

  handle('catalogue:stats', async () => catalogue.stats());
  handle('catalogue:categories', async ({ kind }) => catalogue.categories(kind));

  handle('catalogue:channels', async (opts = {}) => ({
    rows: catalogue.channels(opts),
    total: catalogue.channelCount(opts)
  }));

  handle('catalogue:channelIds', async (opts = {}) => catalogue.channelIds(opts));

  handle('catalogue:titles', async ({ kind, ...opts } = {}) => ({
    rows: catalogue.titles(kind, opts),
    total: catalogue.titleCount(kind, opts)
  }));

  handle('catalogue:byIds', async ({ kind, ids }) => catalogue.byIds(kind, ids || []));
  handle('catalogue:one', async ({ kind, id }) => catalogue.one(kind, id));
  handle('catalogue:search', async ({ term, limit }) => catalogue.search(term, { limit: limit || 60 }));
  handle('catalogue:archiveChannels', async ({ limit } = {}) => catalogue.archiveChannels(limit || 500));

  // ---- channel management
  handle('channels:setHidden', async ({ ids, hidden }) => catalogue.setHidden(ids || [], hidden));
  handle('channels:setOrder', async ({ ids }) => {
    catalogue.setOrder(ids || []);
    return true;
  });
  handle('channels:rename', async ({ id, name }) => {
    catalogue.renameChannel(id, name);
    return true;
  });
  handle('channels:setNumber', async ({ id, num }) => {
    catalogue.setCustomNumber(id, num);
    return true;
  });
  handle('channels:resetPrefs', async () => {
    catalogue.resetChannelPrefs();
    return true;
  });

  // ---- custom groups
  handle('groups:list', async () => catalogue.groups());
  handle('groups:create', async ({ name }) => catalogue.createGroup(name));
  handle('groups:rename', async ({ id, name }) => {
    catalogue.renameGroup(id, name);
    return true;
  });
  handle('groups:delete', async ({ id }) => {
    catalogue.deleteGroup(id);
    return true;
  });
  handle('groups:setChannels', async ({ id, ids }) => {
    catalogue.setGroupChannels(id, ids || []);
    return true;
  });
  handle('groups:add', async ({ id, ids }) => {
    catalogue.addToGroup(id, ids || []);
    return true;
  });
  handle('groups:remove', async ({ id, ids }) => {
    catalogue.removeFromGroup(id, ids || []);
    return true;
  });

  handle('xtream:streamUrl', ({ type, id, ext }) => {
    const c = ensureClient();
    const extension = ext || (type === 'live' ? store.settings.liveFormat || 'ts' : 'mp4');
    return c.streamUrl(type, id, extension);
  });

  handle('xtream:catchupUrl', ({ streamId, durationMinutes, start }) =>
    ensureClient().catchupUrl(streamId, durationMinutes, start)
  );

  handle('xtream:accountInfo', async () => {
    const result = await ensureClient().authenticate();
    return result;
  });

  // ---- EPG
  handle('epg:status', async () => epg.status);

  handle('epg:refresh', async ({ force } = {}) => {
    if (!force && epg.index) return { ok: true, stats: epg.index.stats, cached: true };
    const c = ensureClient();
    return epg.refresh({
      url: c.xmltvUrl(),
      userAgent: store.settings.userAgent,
      hoursBack: store.settings.epgWindowHoursBack,
      hoursForward: store.settings.epgWindowHoursForward
    });
  });

  handle('epg:cancel', async () => {
    epg.cancel();
    return true;
  });

  handle('epg:clear', async () => {
    epg.clear();
    return true;
  });

  handle('epg:mapChannels', async () => {
    const rows = catalogue.epgMappingRows();
    return { matched: epg.buildChannelMap(rows), total: rows.length, ready: Boolean(epg.index) };
  });

  handle('epg:query', async ({ streamIds, from, to }) => epg.query(streamIds || [], from, to));
  handle('epg:nowNext', async ({ streamIds, at }) => epg.nowNextBulk(streamIds || [], at || Date.now()));
  handle('epg:search', async ({ term, limit }) => epg.searchProgrammes(term, limit || 150));

  // ---- preferences and user data
  handle('store:getState', async () => ({
    settings: store.settings,
    favorites: store.data.favorites,
    continueWatching: store.data.continueWatching,
    recentChannels: store.data.recentChannels,
    epg: epg.status,
    cache: cache.stats(),
    catalogue: catalogue.stats(),
    appVersion: app.getVersion()
  }));

  handle('store:setSettings', async (patch) => {
    const before = store.settings.userAgent;
    const next = store.patchSettings(patch);
    if (client && next.userAgent !== before) client.userAgent = next.userAgent;
    return next;
  });

  handle('store:toggleFavorite', async ({ kind, id }) => ({
    added: store.toggleFavorite(kind, id),
    favorites: store.data.favorites
  }));

  handle('store:saveProgress', async (entry) => {
    store.saveProgress(entry);
    return true;
  });

  handle('store:removeProgress', async ({ key }) => {
    store.removeProgress(key);
    return true;
  });

  handle('store:pushRecentChannel', async ({ id }) => {
    store.pushRecentChannel(id);
    return store.data.recentChannels;
  });

  handle('store:clearCache', async () => {
    cache.clear();
    return true;
  });

  // ---- TMDB enrichment
  handle('tmdb:status', async () => ({
    enabled: tmdb.enabled,
    language: tmdb.language,
    ...catalogue.metadataStats()
  }));

  handle('tmdb:setKey', async ({ key, language }) => {
    tmdb.apiKey = (key || '').trim();
    tmdb.language = language || tmdb.language;
    store.patchSettings({ tmdbKey: tmdb.apiKey, tmdbLanguage: tmdb.language });
    if (!tmdb.enabled) return { enabled: false };
    const ok = await tmdb.verifyKey();
    return { enabled: ok };
  });

  /**
   * Enrich one title, cached. `kind` is our own 'movie' | 'series'; TMDB calls
   * the latter 'tv'.
   */
  handle('tmdb:enrich', async ({ kind, id, title, year, force }) => {
    const cached = force ? null : catalogue.metadata(kind, id);
    if (cached && !cached.miss) return cached;
    // Do not hammer TMDB for a title it has already failed to find; retry only
    // after a week, in case the entry has since been created.
    if (cached && cached.miss && Date.now() - cached.fetchedAt < 7 * 86400000) return null;
    if (!tmdb.enabled) return null;

    const payload = await tmdb.enrich(kind === 'series' ? 'tv' : 'movie', title, year).catch(() => null);
    catalogue.saveMetadata(kind, id, payload);
    return payload;
  });

  handle('tmdb:clear', async () => {
    catalogue.clearMetadata();
    return catalogue.metadataStats();
  });

  handle('app:showError', async ({ title, message }) => {
    dialog.showErrorBox(title || 'Aurum IPTV', message || '');
    return true;
  });
}
