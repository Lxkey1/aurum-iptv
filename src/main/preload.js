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

  xtream: {
    liveCategories: () => invoke('xtream:liveCategories'),
    vodCategories: () => invoke('xtream:vodCategories'),
    seriesCategories: () => invoke('xtream:seriesCategories'),
    liveStreams: (categoryId) => invoke('xtream:liveStreams', { categoryId }),
    vodStreams: (categoryId) => invoke('xtream:vodStreams', { categoryId }),
    series: (categoryId) => invoke('xtream:series', { categoryId }),
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
    mapChannels: (channels) => invoke('epg:mapChannels', { channels }),
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
