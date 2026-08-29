'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { Worker } = require('worker_threads');

/**
 * Owns the parsed XMLTV index: refreshing it on a worker thread, caching it to
 * disk between launches, and answering channel/time-range queries for the guide.
 */
class EpgManager {
  constructor() {
    this.index = null; // { channels, programmes, displayNameIndex, stats }
    this.worker = null;
    this.loading = false;
    this.lastError = null;
    this.listeners = new Set();
    this.cacheFile = path.join(app.getPath('userData'), 'epg-cache.json');

    /** streamId -> xmltv channel id, built lazily from the live channel list. */
    this.channelMap = Object.create(null);
  }

  onProgress(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(payload) {
    for (const fn of this.listeners) {
      try {
        fn(payload);
      } catch {
        /* a dead renderer should not break the load */
      }
    }
  }

  get status() {
    return {
      loading: this.loading,
      ready: Boolean(this.index),
      error: this.lastError,
      stats: this.index ? this.index.stats : null
    };
  }

  // ------------------------------------------------------------- disk cache

  loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.cacheFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.stats) return false;
      // A cached guide is useful until its window no longer covers "now".
      if (Date.now() > parsed.stats.to - 2 * 3600 * 1000) return false;
      this.index = parsed;
      return true;
    } catch {
      return false;
    }
  }

  saveToDisk() {
    if (!this.index) return;
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.index), 'utf8');
    } catch (err) {
      console.error('[epg] cache write failed', err);
    }
  }

  clear() {
    this.index = null;
    this.lastError = null;
    try {
      fs.unlinkSync(this.cacheFile);
    } catch {
      /* nothing cached */
    }
  }

  // ---------------------------------------------------------------- refresh

  /** @returns {Promise<{ok:boolean, stats?:object, error?:string}>} */
  refresh({ url, userAgent, hoursBack = 6, hoursForward = 72 }) {
    if (this.loading) return Promise.resolve({ ok: false, error: 'A guide refresh is already running.' });

    this.loading = true;
    this.lastError = null;

    const now = Date.now();
    const fromMs = now - hoursBack * 3600 * 1000;
    const toMs = now + hoursForward * 3600 * 1000;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        this.loading = false;
        this.worker = null;
        resolve(payload);
      };

      try {
        this.worker = new Worker(path.join(__dirname, 'epg-worker.js'), {
          workerData: { url, userAgent, fromMs, toMs }
        });
      } catch (err) {
        this.lastError = err.message;
        this._emit({ phase: 'error', text: err.message, pct: 100 });
        return finish({ ok: false, error: err.message });
      }

      this.worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          this._emit({ phase: msg.phase, text: msg.text, pct: msg.pct });
        } else if (msg.type === 'done') {
          this.index = msg.result;
          this.channelMap = Object.create(null);
          this.saveToDisk();
          this._emit({ phase: 'done', text: 'Guide ready', pct: 100, stats: msg.result.stats });
          finish({ ok: true, stats: msg.result.stats });
        } else if (msg.type === 'error') {
          this.lastError = msg.message;
          this._emit({ phase: 'error', text: msg.message, pct: 100 });
          finish({ ok: false, error: msg.message });
        }
      });

      this.worker.on('error', (err) => {
        this.lastError = err.message;
        this._emit({ phase: 'error', text: err.message, pct: 100 });
        finish({ ok: false, error: err.message });
      });

      this.worker.on('exit', () => finish({ ok: false, error: this.lastError || 'Guide loader stopped unexpectedly.' }));
    });
  }

  cancel() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.loading = false;
    }
  }

  // ---------------------------------------------------------------- lookups

  /**
   * Live streams expose `epg_channel_id`, but plenty of providers leave it blank
   * or misspelled. Fall back to matching on a normalised display name.
   * @param {Array<{stream_id:any, epg_channel_id?:string, name?:string}>} channels
   */
  buildChannelMap(channels) {
    if (!this.index) return 0;
    const map = Object.create(null);
    let matched = 0;

    for (const ch of channels || []) {
      const streamId = String(ch.stream_id);
      const declared = ch.epg_channel_id ? String(ch.epg_channel_id).trim() : '';

      if (declared && this.index.programmes[declared]) {
        map[streamId] = declared;
        matched += 1;
        continue;
      }
      if (declared && this.index.channels[declared]) {
        map[streamId] = declared;
        matched += 1;
        continue;
      }
      const key = normalize(ch.name);
      const guess = key ? this.index.displayNameIndex[key] : '';
      if (guess) {
        map[streamId] = guess;
        matched += 1;
      }
    }

    this.channelMap = map;
    return matched;
  }

  epgIdFor(streamId, epgChannelId, name) {
    const key = String(streamId);
    if (this.channelMap[key]) return this.channelMap[key];
    if (!this.index) return '';
    const declared = epgChannelId ? String(epgChannelId).trim() : '';
    if (declared && (this.index.programmes[declared] || this.index.channels[declared])) return declared;
    const norm = normalize(name);
    return (norm && this.index.displayNameIndex[norm]) || '';
  }

  /**
   * @param {string[]} streamIds
   * @param {number} from epoch ms
   * @param {number} to epoch ms
   * @returns {Record<string, Array>} keyed by stream id
   */
  query(streamIds, from, to) {
    const out = Object.create(null);
    if (!this.index) return out;

    for (const streamId of streamIds) {
      const epgId = this.channelMap[String(streamId)];
      const list = epgId ? this.index.programmes[epgId] : null;
      if (!list || !list.length) {
        out[streamId] = [];
        continue;
      }
      // binary search for the first programme that ends after `from`
      let lo = 0;
      let hi = list.length - 1;
      let startIdx = list.length;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].e > from) {
          startIdx = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      const slice = [];
      for (let i = startIdx; i < list.length && list[i].s < to; i += 1) slice.push(list[i]);
      out[streamId] = slice;
    }
    return out;
  }

  /** Now / next for a single channel. */
  nowNext(streamId, at = Date.now()) {
    const epgId = this.channelMap[String(streamId)];
    if (!this.index || !epgId) return { now: null, next: null };
    const list = this.index.programmes[epgId];
    if (!list || !list.length) return { now: null, next: null };

    for (let i = 0; i < list.length; i += 1) {
      if (list[i].e > at) {
        const current = list[i].s <= at ? list[i] : null;
        const upcoming = current ? list[i + 1] || null : list[i];
        return { now: current, next: upcoming };
      }
    }
    return { now: null, next: null };
  }

  /** Bulk now/next for the whole channel list — one pass, used by the live view. */
  nowNextBulk(streamIds, at = Date.now()) {
    const out = Object.create(null);
    for (const id of streamIds) out[id] = this.nowNext(id, at);
    return out;
  }

  searchProgrammes(term, limit = 200) {
    if (!this.index || !term) return [];
    const needle = term.toLowerCase();
    const reverse = Object.create(null);
    for (const [streamId, epgId] of Object.entries(this.channelMap)) {
      (reverse[epgId] || (reverse[epgId] = [])).push(streamId);
    }

    const results = [];
    const now = Date.now();
    for (const [epgId, list] of Object.entries(this.index.programmes)) {
      const streamIds = reverse[epgId];
      if (!streamIds) continue;
      for (const p of list) {
        if (p.e < now) continue;
        if (p.t.toLowerCase().includes(needle)) {
          results.push({ streamId: streamIds[0], channel: (this.index.channels[epgId] || {}).name || epgId, ...p });
          if (results.length >= limit) return results.sort((a, b) => a.s - b.s);
        }
      }
    }
    return results.sort((a, b) => a.s - b.s);
  }
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|raw|backup|vip|us|uk)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

module.exports = { EpgManager };
