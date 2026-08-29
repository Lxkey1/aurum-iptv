'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * File-per-key disk cache for catalogue responses.
 *
 * Channel/film/series lists routinely run to tens of megabytes of JSON. Keeping
 * them in the settings file would mean re-serialising everything on every write,
 * so each key gets its own file plus a small in-memory layer for repeat reads.
 */
class DiskCache {
  constructor(dirName = 'catalogue-cache') {
    this.dir = path.join(app.getPath('userData'), dirName);
    this.memory = new Map(); // key -> { at, ttl, data }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error('[cache] could not create cache directory', err);
    }
  }

  _file(key) {
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
    return path.join(this.dir, `${hash}.json`);
  }

  get(key) {
    const hot = this.memory.get(key);
    if (hot) {
      if (!hot.ttl || Date.now() - hot.at <= hot.ttl) return hot.data;
      this.memory.delete(key);
    }

    try {
      const raw = fs.readFileSync(this._file(key), 'utf8');
      const entry = JSON.parse(raw);
      if (entry.key !== key) return null;
      if (entry.ttl && Date.now() - entry.at > entry.ttl) {
        this.delete(key);
        return null;
      }
      this.memory.set(key, entry);
      return entry.data;
    } catch {
      return null;
    }
  }

  set(key, data, ttl) {
    const entry = { key, at: Date.now(), ttl, data };
    this.memory.set(key, entry);
    // Written asynchronously: a failed cache write must never break a request.
    fs.writeFile(this._file(key), JSON.stringify(entry), 'utf8', (err) => {
      if (err) console.error('[cache] write failed', err.message);
    });
  }

  delete(key) {
    this.memory.delete(key);
    try {
      fs.unlinkSync(this._file(key));
    } catch {
      /* nothing cached */
    }
  }

  clear() {
    this.memory.clear();
    try {
      for (const file of fs.readdirSync(this.dir)) {
        if (file.endsWith('.json')) fs.unlinkSync(path.join(this.dir, file));
      }
    } catch (err) {
      console.error('[cache] clear failed', err.message);
    }
  }

  stats() {
    let files = 0;
    let size = 0;
    try {
      for (const file of fs.readdirSync(this.dir)) {
        if (!file.endsWith('.json')) continue;
        files += 1;
        size += fs.statSync(path.join(this.dir, file)).size;
      }
    } catch {
      /* directory missing */
    }
    return { files, size };
  }
}

module.exports = { DiskCache };
