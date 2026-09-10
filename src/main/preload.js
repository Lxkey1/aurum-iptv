'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Every invoke resolves to {ok, data} or {ok:false, error, code}. */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('aurum', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    setFullScreen: (value) => ipcRenderer.send('window:fullscreen', value),
    onState: (fn) => {
      const listener = (_e, state) => fn(state);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    }
  },

  app: {
    openExternal: (url) => ipcRenderer.send('app:openExternal', url),
    keepAwake: (active) => ipcRenderer.send('power:keepAwake', Boolean(active)),
    showError: (title, message) => invoke('app:showError', { title, message })
  },

  auth: {
    login: (payload) => invoke('auth:login', payload),
    restore: () => invoke('auth:restore'),
    hasProfile: () => invoke('auth:hasProfile'),
    logout: () => invoke('auth:logout')
  },

  /** Catalogue lives in SQLite in the main process; the renderer asks for pages. */
  catalogue: {
    sync: (force) => invoke('catalogue:sync', { force }),
    stats: () => invoke('catalogue:stats'),
    categories: (kind) => invoke('catalogue:categories', { kind }),
    channels: (opts) => invoke('catalogue:channels', opts || {}),
    channelIds: (opts) => invoke('catalogue:channelIds', opts || {}),
    titles: (kind, opts) => invoke('catalogue:titles', { kind, ...(opts || {}) }),
    byIds: (kind, ids) => invoke('catalogue:byIds', { kind, ids }),
    one: (kind, id) => invoke('catalogue:one', { kind, id }),
    search: (term, limit) => invoke('catalogue:search', { term, limit }),
    archiveChannels: (limit) => invoke('catalogue:archiveChannels', { limit }),
    onProgress: (fn) => {
      const listener = (_e, payload) => fn(payload);
      ipcRenderer.on('catalogue:progress', listener);
      return () => ipcRenderer.removeListener('catalogue:progress', listener);
    }
  },

  channels: {
    setHidden: (ids, hidden) => invoke('channels:setHidden', { ids, hidden }),
    setOrder: (ids) => invoke('channels:setOrder', { ids }),
    rename: (id, name) => invoke('channels:rename', { id, name }),
    setNumber: (id, num) => invoke('channels:setNumber', { id, num }),
    resetPrefs: () => invoke('channels:resetPrefs')
  },

  groups: {
    list: () => invoke('groups:list'),
    create: (name) => invoke('groups:create', { name }),
    rename: (id, name) => invoke('groups:rename', { id, name }),
    remove: (id) => invoke('groups:delete', { id }),
    setChannels: (id, ids) => invoke('groups:setChannels', { id, ids }),
    add: (id, ids) => invoke('groups:add', { id, ids }),
    removeChannels: (id, ids) => invoke('groups:remove', { id, ids })
  },

  xtream: {
    seriesInfo: (seriesId) => invoke('xtream:seriesInfo', { seriesId }),
    vodInfo: (vodId) => invoke('xtream:vodInfo', { vodId }),
    shortEpg: (streamId, limit) => invoke('xtream:shortEpg', { streamId, limit }),
    streamUrl: (type, id, ext) => invoke('xtream:streamUrl', { type, id, ext }),
    catchupUrl: (streamId, durationMinutes, start) =>
      invoke('xtream:catchupUrl', { streamId, durationMinutes, start }),
    accountInfo: () => invoke('xtream:accountInfo')
  },

  epg: {
    status: () => invoke('epg:status'),
    refresh: (force) => invoke('epg:refresh', { force }),
    cancel: () => invoke('epg:cancel'),
    clear: () => invoke('epg:clear'),
    mapChannels: () => invoke('epg:mapChannels'),
    query: (streamIds, from, to) => invoke('epg:query', { streamIds, from, to }),
    nowNext: (streamIds, at) => invoke('epg:nowNext', { streamIds, at }),
    search: (term, limit) => invoke('epg:search', { term, limit }),
    onProgress: (fn) => {
      const listener = (_e, payload) => fn(payload);
      ipcRenderer.on('epg:progress', listener);
      return () => ipcRenderer.removeListener('epg:progress', listener);
    }
  },

  store: {
    getState: () => invoke('store:getState'),
    setSettings: (patch) => invoke('store:setSettings', patch),
    toggleFavorite: (kind, id) => invoke('store:toggleFavorite', { kind, id }),
    saveProgress: (entry) => invoke('store:saveProgress', entry),
    removeProgress: (key) => invoke('store:removeProgress', { key }),
    pushRecentChannel: (id) => invoke('store:pushRecentChannel', { id }),
    clearCache: () => invoke('store:clearCache')
  }
});
