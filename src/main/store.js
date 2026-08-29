'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

/**
 * Tiny JSON-file store living in userData. Credentials are encrypted with the OS
 * keychain (DPAPI on Windows) via safeStorage when it is available.
 */

const DEFAULTS = {
  version: 1,
  profile: null, // { name, host, username, secret, encrypted }
  settings: {
    liveFormat: 'ts', // 'ts' | 'm3u8'
    userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
    accent: 'gold',
    epgAutoLoad: true,
    epgWindowHoursBack: 6,
    epgWindowHoursForward: 72,
    hwAccel: true,
    volume: 1,
    muted: false,
    fitMode: 'contain',
    reduceMotion: false,
    startPage: 'home',
    catchupEnabled: true
  },
  favorites: { live: [], movie: [], series: [] },
  continueWatching: {}, // key -> { type, id, name, cover, position, duration, updatedAt, meta }
  recentChannels: []
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'aurum-config.json');
    this.data = this._read();
    this._writeTimer = null;
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return deepMerge(structuredClone(DEFAULTS), parsed);
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  /** Debounced write so rapid updates (playback position) do not thrash the disk. */
  save(immediate = false) {
    if (this._writeTimer) clearTimeout(this._writeTimer);
    const flush = () => {
      this._writeTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (err) {
        console.error('[store] write failed', err);
      }
    };
    if (immediate) flush();
    else this._writeTimer = setTimeout(flush, 400);
  }

  get settings() {
    return this.data.settings;
  }

  patchSettings(patch) {
    Object.assign(this.data.settings, patch || {});
    this.save();
    return this.data.settings;
  }

  // ---------------------------------------------------------------- profile

  setProfile({ name, host, username, password }) {
    let secret = password;
    let encrypted = false;
    try {
      if (safeStorage.isEncryptionAvailable()) {
        secret = safeStorage.encryptString(password).toString('base64');
        encrypted = true;
      }
    } catch {
      /* fall through to plaintext */
    }
    this.data.profile = { name, host, username, secret, encrypted, savedAt: Date.now() };
    this.save(true);
  }

  getProfile() {
    const p = this.data.profile;
    if (!p) return null;
    let password = p.secret;
    if (p.encrypted) {
      try {
        password = safeStorage.decryptString(Buffer.from(p.secret, 'base64'));
      } catch {
        return null; // keychain changed — force a fresh login
      }
    }
    return { name: p.name, host: p.host, username: p.username, password };
  }

  clearProfile() {
    this.data.profile = null;
    this.save(true);
  }

  // -------------------------------------------------------------- favorites

  toggleFavorite(kind, id) {
    const list = this.data.favorites[kind] || (this.data.favorites[kind] = []);
    const key = String(id);
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    else list.unshift(key);
    this.save();
    return idx < 0;
  }

  // ------------------------------------------------------ continue watching

  saveProgress(entry) {
    if (!entry || !entry.key) return;
    const existing = this.data.continueWatching[entry.key] || {};
    this.data.continueWatching[entry.key] = { ...existing, ...entry, updatedAt: Date.now() };

    // keep the 60 most recent
    const keys = Object.keys(this.data.continueWatching)
      .sort((a, b) => this.data.continueWatching[b].updatedAt - this.data.continueWatching[a].updatedAt);
    for (const k of keys.slice(60)) delete this.data.continueWatching[k];
    this.save();
  }

  removeProgress(key) {
    delete this.data.continueWatching[key];
    this.save();
  }

  pushRecentChannel(id) {
    const key = String(id);
    this.data.recentChannels = [key, ...this.data.recentChannels.filter((x) => x !== key)].slice(0, 40);
    this.save();
  }

}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

module.exports = { Store, DEFAULTS };
