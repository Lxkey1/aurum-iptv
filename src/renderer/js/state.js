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

  // catalogue caches (renderer side, cheap to rebuild)
  liveCategories: [],
  vodCategories: [],
  seriesCategories: [],
  liveChannels: [], // full list, always loaded — needed for search, guide and zapping
  liveById: new Map(),
  movies: [],
  series: [],

  epg: { ready: false, loading: false, stats: null, matched: 0 },

  loaded: { live: false, movies: false, series: false }
};

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
  state.liveCategories = [];
  state.vodCategories = [];
  state.seriesCategories = [];
  state.liveChannels = [];
  state.liveById = new Map();
  state.movies = [];
  state.series = [];
  state.loaded = { live: false, movies: false, series: false };
}

// ------------------------------------------------------------- catalogue

const asArray = (value) => (Array.isArray(value) ? value : []);

/** Live channels are always fetched in full: search, guide and zapping need them. */
export async function ensureLive(force = false) {
  if (state.loaded.live && !force) return state.liveChannels;

  const [cats, streams] = await Promise.all([
    call(api.xtream.liveCategories()),
    call(api.xtream.liveStreams())
  ]);

  state.liveCategories = asArray(cats);
  state.liveChannels = asArray(streams).map((s, i) => ({
    ...s,
    stream_id: s.stream_id,
    _n: Number(s.num) || i + 1,
    _cat: String(s.category_id ?? '')
  }));
  state.liveById = new Map(state.liveChannels.map((c) => [String(c.stream_id), c]));
  state.loaded.live = true;

  // Tell the main process how to line channels up with the XMLTV index.
  try {
    const mapped = await call(api.epg.mapChannels(
      state.liveChannels.map((c) => ({
        stream_id: c.stream_id,
        epg_channel_id: c.epg_channel_id,
        name: c.name
      }))
    ));
    state.epg.matched = mapped.matched;
    state.epg.ready = mapped.ready;
  } catch {
    /* the guide is optional */
  }

  emit('live', state.liveChannels);
  return state.liveChannels;
}

export async function ensureMovies(force = false) {
  if (state.loaded.movies && !force) return state.movies;
  const [cats, streams] = await Promise.all([
    call(api.xtream.vodCategories()),
    call(api.xtream.vodStreams())
  ]);
  state.vodCategories = asArray(cats);
  state.movies = asArray(streams);
  state.loaded.movies = true;
  emit('movies', state.movies);
  return state.movies;
}

export async function ensureSeries(force = false) {
  if (state.loaded.series && !force) return state.series;
  const [cats, list] = await Promise.all([
    call(api.xtream.seriesCategories()),
    call(api.xtream.series())
  ]);
  state.seriesCategories = asArray(cats);
  state.series = asArray(list);
  state.loaded.series = true;
  emit('series', state.series);
  return state.series;
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
      if (state.liveChannels.length) {
        const mapped = await call(api.epg.mapChannels(
          state.liveChannels.map((c) => ({
            stream_id: c.stream_id,
            epg_channel_id: c.epg_channel_id,
            name: c.name
          }))
        ));
        state.epg.matched = mapped.matched;
      }
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
