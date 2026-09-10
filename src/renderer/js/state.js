/**
 * Central app state + a thin wrapper over the preload bridge.
 *
 * Every IPC call returns {ok, data} or {ok:false, error}; `call()` unwraps that
 * into a value or a thrown Error so views can use plain try/catch.
 */

const api = window.aurum;

export class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function call(promise) {
  const res = await promise;
  if (!res) throw new AppError('No response from the application core.', 'NO_RESPONSE');
  if (!res.ok) throw new AppError(res.error || 'Something went wrong.', res.code);
  return res.data;
}

export const state = {
  ready: false,
  account: null, // { userInfo, serverInfo, credentials }
  settings: {},
  favorites: { live: [], movie: [], series: [] },
  continueWatching: {},
  recentChannels: [],
  appVersion: '',

  /**
   * The catalogue itself lives in SQLite in the main process — a real line runs
   * to a quarter of a million items, far too much to hold here. Only counts and
   * a small row cache live in the renderer.
   */
  catalogue: { channels: 0, movies: 0, series: 0, hidden: 0, groups: 0, updatedAt: 0, sizeBytes: 0 },
  categories: { live: [], movie: [], series: [] },
  groups: [],

  /** Recently fetched rows, so repeated renders do not re-query. */
  rowCache: new Map(),

  epg: { ready: false, loading: false, stats: null, matched: 0 },

  syncing: false
};

const ROW_CACHE_MAX = 3000;

function cacheRows(kind, rows) {
  for (const row of rows || []) state.rowCache.set(kind + ':' + row.id, row);
  while (state.rowCache.size > ROW_CACHE_MAX) {
    state.rowCache.delete(state.rowCache.keys().next().value);
  }
  return rows;
}

export function cachedRow(kind, id) {
  return state.rowCache.get(kind + ':' + id) || null;
}

// ------------------------------------------------------------ pub/sub

const subscribers = new Map();

export function on(event, fn) {
  if (!subscribers.has(event)) subscribers.set(event, new Set());
  subscribers.get(event).add(fn);
  return () => subscribers.get(event).delete(fn);
}

export function emit(event, payload) {
  const set = subscribers.get(event);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[state] listener for "${event}" failed`, err);
    }
  }
}

// ------------------------------------------------------------ bootstrap

export async function loadPersistedState() {
  const data = await call(api.store.getState());
  state.settings = data.settings;
  state.favorites = data.favorites;
  state.continueWatching = data.continueWatching;
  state.recentChannels = data.recentChannels;
  state.appVersion = data.appVersion;
  state.epg.ready = data.epg.ready;
  state.epg.loading = data.epg.loading;
  state.epg.stats = data.epg.stats;
  if (data.catalogue) state.catalogue = data.catalogue;
  applyTheme();
  return data;
}

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.accent = state.settings.accent || 'gold';
  root.dataset.reduceMotion = String(Boolean(state.settings.reduceMotion));
}

export async function updateSettings(patch) {
  state.settings = await call(api.store.setSettings(patch));
  applyTheme();
  emit('settings', state.settings);
  return state.settings;
}

// ------------------------------------------------------------------ auth

export async function login(payload) {
  const account = await call(api.auth.login(payload));
  state.account = account;
  resetCatalogue();
  return account;
}

export async function restoreSession() {
  const account = await call(api.auth.restore());
  if (account) state.account = account;
  return account;
}

export const hasSavedProfile = () => call(api.auth.hasProfile());

export async function logout() {
  await call(api.auth.logout());
  state.account = null;
  resetCatalogue();
  state.epg = { ready: false, loading: false, stats: null, matched: 0 };
}

function resetCatalogue() {
  state.catalogue = { channels: 0, movies: 0, series: 0, hidden: 0, groups: 0, updatedAt: 0, sizeBytes: 0 };
  state.categories = { live: [], movie: [], series: [] };
  state.groups = [];
  state.rowCache.clear();
}

// ------------------------------------------------------------- catalogue

// ---------------------------------------------------------------- catalogue

/**
 * Fetch the whole catalogue from the provider and ingest it into SQLite.
 * Only needed on first sign-in or an explicit refresh; everything afterwards is
 * a query against the local index.
 */
export async function syncCatalogue(force = false) {
  if (state.syncing) return state.catalogue;
  state.syncing = true;
  emit('sync', { active: true });
  try {
    const stats = await call(api.catalogue.sync(force));
    state.catalogue = stats;
    state.rowCache.clear();
    await Promise.all([
      loadCategories('live'),
      loadCategories('movie'),
      loadCategories('series'),
      loadGroups()
    ]);
    try {
      const mapped = await call(api.epg.mapChannels());
      state.epg.matched = mapped.matched;
      state.epg.ready = mapped.ready;
    } catch {
      /* the guide is optional */
    }
    emit('catalogue', state.catalogue);
    return stats;
  } finally {
    state.syncing = false;
    emit('sync', { active: false });
  }
}

export const onSyncProgress = (fn) => api.catalogue.onProgress(fn);

export async function refreshStats() {
  state.catalogue = await call(api.catalogue.stats());
  return state.catalogue;
}

export async function loadCategories(kind) {
  const rows = await call(api.catalogue.categories(kind));
  state.categories[kind] = rows;
  return rows;
}

export async function loadGroups() {
  state.groups = await call(api.groups.list());
  return state.groups;
}

/** A page of channels. Resolves to { rows, total }. */
export async function fetchChannels(opts = {}) {
  const result = await call(api.catalogue.channels(opts));
  cacheRows('live', result.rows);
  return result;
}

/** Every visible channel id in display order — the player's zap list. */
export const fetchChannelIds = (opts = {}) => call(api.catalogue.channelIds(opts));

/** A page of films or box sets. Resolves to { rows, total }. */
export async function fetchTitles(kind, opts = {}) {
  const result = await call(api.catalogue.titles(kind, opts));
  cacheRows(kind, result.rows);
  return result;
}

export async function fetchByIds(kind, ids) {
  if (!ids || !ids.length) return [];
  const rows = await call(api.catalogue.byIds(kind, ids.map(String)));
  return cacheRows(kind, rows);
}

export async function fetchOne(kind, id) {
  const hit = cachedRow(kind, id);
  if (hit) return hit;
  const row = await call(api.catalogue.one(kind, id));
  if (row) cacheRows(kind, [row]);
  return row;
}

export async function searchCatalogue(term, limit = 60) {
  const result = await call(api.catalogue.search(term, limit));
  cacheRows('live', result.live);
  cacheRows('movie', result.movie);
  cacheRows('series', result.series);
  return result;
}

export const fetchArchiveChannels = (limit) => call(api.catalogue.archiveChannels(limit));

// ------------------------------------------------------------ enrichment

export const tmdbStatus = () => call(api.tmdb.status());
export const tmdbSetKey = (key, language) => call(api.tmdb.setKey(key, language));
export const tmdbClear = () => call(api.tmdb.clear());

/** Enrich a title on demand. Resolves null when TMDB is off or finds nothing. */
export function tmdbEnrich(kind, id, title, year, force = false) {
  return call(api.tmdb.enrich(kind, id, title, year, force)).catch(() => null);
}

// ------------------------------------------------------- channel management

export async function setChannelsHidden(ids, hidden) {
  const hiddenCount = await call(api.channels.setHidden(ids.map(String), hidden));
  state.catalogue.hidden = hiddenCount;
  state.rowCache.clear();
  emit('channels', state.catalogue);
  return hiddenCount;
}

export async function setChannelOrder(ids) {
  await call(api.channels.setOrder(ids.map(String)));
  state.rowCache.clear();
  emit('channels', state.catalogue);
}

export async function renameChannel(id, name) {
  await call(api.channels.rename(String(id), name));
  state.rowCache.delete('live:' + id);
  emit('channels', state.catalogue);
}

export async function setChannelNumber(id, num) {
  await call(api.channels.setNumber(String(id), num));
  state.rowCache.delete('live:' + id);
  emit('channels', state.catalogue);
}

export async function resetChannelPrefs() {
  await call(api.channels.resetPrefs());
  state.rowCache.clear();
  await loadCategories('live');
  emit('channels', state.catalogue);
}

// ------------------------------------------------------------------ groups

export async function createGroup(name) {
  const id = await call(api.groups.create(name));
  await loadGroups();
  emit('groups', state.groups);
  return id;
}

export async function renameGroup(id, name) {
  await call(api.groups.rename(id, name));
  await loadGroups();
  emit('groups', state.groups);
}

export async function deleteGroup(id) {
  await call(api.groups.remove(id));
  await loadGroups();
  emit('groups', state.groups);
}

export async function addToGroup(id, ids) {
  await call(api.groups.add(id, ids.map(String)));
  await loadGroups();
  emit('groups', state.groups);
}

export async function removeFromGroup(id, ids) {
  await call(api.groups.removeChannels(id, ids.map(String)));
  await loadGroups();
  emit('groups', state.groups);
}

export async function setGroupChannels(id, ids) {
  await call(api.groups.setChannels(id, ids.map(String)));
  await loadGroups();
  emit('groups', state.groups);
}

export const getSeriesInfo = (id) => call(api.xtream.seriesInfo(id));
export const getVodInfo = (id) => call(api.xtream.vodInfo(id));
export const getShortEpg = (streamId, limit) => call(api.xtream.shortEpg(streamId, limit));
export const getStreamUrl = (type, id, ext) => call(api.xtream.streamUrl(type, id, ext));
export const getCatchupUrl = (streamId, minutes, start) => call(api.xtream.catchupUrl(streamId, minutes, start));

// ------------------------------------------------------------------- EPG

export const epgStatus = () => call(api.epg.status());
export const epgQuery = (ids, from, to) => call(api.epg.query(ids, from, to));
export const epgNowNext = (ids, at) => call(api.epg.nowNext(ids, at));
export const epgSearch = (term, limit) => call(api.epg.search(term, limit));

export async function refreshEpg(force = false) {
  state.epg.loading = true;
  emit('epg', state.epg);
  try {
    const result = await call(api.epg.refresh(force));
    if (result && result.ok) {
      state.epg.ready = true;
      state.epg.stats = result.stats;
      const mapped = await call(api.epg.mapChannels());
      state.epg.matched = mapped.matched;
    }
    return result;
  } finally {
    state.epg.loading = false;
    emit('epg', state.epg);
  }
}

export const cancelEpg = () => call(api.epg.cancel());
export const clearEpg = () => call(api.epg.clear());

// ------------------------------------------------------- user collections

export function isFavorite(kind, id) {
  return (state.favorites[kind] || []).includes(String(id));
}

export async function toggleFavorite(kind, id) {
  const result = await call(api.store.toggleFavorite(kind, id));
  state.favorites = result.favorites;
  emit('favorites', state.favorites);
  return result.added;
}

export async function saveProgress(entry) {
  state.continueWatching[entry.key] = { ...(state.continueWatching[entry.key] || {}), ...entry, updatedAt: Date.now() };
  await call(api.store.saveProgress(entry));
  emit('progress', state.continueWatching);
}

export async function removeProgress(key) {
  delete state.continueWatching[key];
  await call(api.store.removeProgress(key));
  emit('progress', state.continueWatching);
}

export function getProgress(key) {
  return state.continueWatching[key] || null;
}

export function continueWatchingList() {
  return Object.values(state.continueWatching)
    .filter((e) => e && e.duration > 0 && e.position > 30 && e.position < e.duration * 0.96)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function pushRecentChannel(id) {
  state.recentChannels = await call(api.store.pushRecentChannel(id));
}

export const clearCache = () => call(api.store.clearCache());

export { api, call };
