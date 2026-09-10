'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/** Electron is only needed to find userData; keep it optional so this module
 *  can be exercised by plain-node tests against a temp file. */
function defaultDbPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'catalogue.db');
}

/**
 * The catalogue, on disk.
 *
 * Large Xtream lines are enormous — a real one measured here held 53,683
 * channels, 158,173 films and 36,254 series. Holding that in JS objects cost
 * ~493 MB of heap, 569 ms of blocking JSON parse at every cold start, and 51 ms
 * per search keystroke. SQLite with an FTS5 index does the same work in single
 * -digit milliseconds and keeps almost nothing resident.
 *
 * User overrides (hidden channels, custom order, groups) live in their own
 * tables so a catalogue refresh never destroys them.
 */

const SCHEMA_VERSION = 1;

class CatalogueDb {
  constructor(file) {
    this.file = file || defaultDbPath();
    this.db = null;
  }

  open() {
    if (this.db) return this;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);

    // WAL keeps reads fast while a refresh writes; the rest is throughput tuning.
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -16000;
    `);

    this._migrate();
    return this;
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

      CREATE TABLE IF NOT EXISTS category (
        kind TEXT NOT NULL,
        id   TEXT NOT NULL,
        name TEXT NOT NULL,
        ord  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, id)
      );

      CREATE TABLE IF NOT EXISTS channel (
        id      TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        num     INTEGER NOT NULL DEFAULT 0,
        logo    TEXT,
        cat     TEXT,
        epg_id  TEXT,
        archive INTEGER NOT NULL DEFAULT 0,
        added   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS movie (
        id     TEXT PRIMARY KEY,
        name   TEXT NOT NULL,
        cover  TEXT,
        rating REAL NOT NULL DEFAULT 0,
        year   TEXT,
        cat    TEXT,
        ext    TEXT,
        added  INTEGER NOT NULL DEFAULT 0,
        genre  TEXT,
        plot   TEXT
      );

      CREATE TABLE IF NOT EXISTS series (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        cover    TEXT,
        rating   REAL NOT NULL DEFAULT 0,
        year     TEXT,
        cat      TEXT,
        modified INTEGER NOT NULL DEFAULT 0,
        genre    TEXT,
        plot     TEXT
      );

      CREATE INDEX IF NOT EXISTS ix_channel_cat   ON channel(cat, num);
      CREATE INDEX IF NOT EXISTS ix_channel_num   ON channel(num);
      CREATE INDEX IF NOT EXISTS ix_movie_cat     ON movie(cat);
      CREATE INDEX IF NOT EXISTS ix_movie_added   ON movie(added DESC);
      CREATE INDEX IF NOT EXISTS ix_movie_rating  ON movie(rating DESC);
      CREATE INDEX IF NOT EXISTS ix_series_cat    ON series(cat);
      CREATE INDEX IF NOT EXISTS ix_series_mod    ON series(modified DESC);
      CREATE INDEX IF NOT EXISTS ix_series_rating ON series(rating DESC);

      -- One standalone index covering every kind, so a single query searches
      -- channels, films and box sets together.
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        name,
        kind    UNINDEXED,
        item_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- ---- user overrides: never cleared by a catalogue refresh ----
      CREATE TABLE IF NOT EXISTS channel_pref (
        id          TEXT PRIMARY KEY,
        hidden      INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER,
        custom_num  INTEGER,
        custom_name TEXT
      );

      CREATE TABLE IF NOT EXISTS channel_group (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ord  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channel_group_member (
        group_id   INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        ord        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, channel_id)
      );

      CREATE INDEX IF NOT EXISTS ix_group_member ON channel_group_member(group_id, ord);
      CREATE INDEX IF NOT EXISTS ix_pref_hidden  ON channel_pref(hidden);
    `);

    this.db.exec(
      `INSERT INTO meta(key, value) VALUES('schema', '${SCHEMA_VERSION}')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* already closed */
      }
      this.db = null;
    }
  }

  // ------------------------------------------------------------------ meta

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  get isPopulated() {
    const row = this.db.prepare('SELECT COUNT(*) n FROM channel').get();
    return row.n > 0;
  }

  stats() {
    const one = (sql) => this.db.prepare(sql).get().n;
    return {
      channels: one('SELECT COUNT(*) n FROM channel'),
      movies: one('SELECT COUNT(*) n FROM movie'),
      series: one('SELECT COUNT(*) n FROM series'),
      hidden: one('SELECT COUNT(*) n FROM channel_pref WHERE hidden = 1'),
      groups: one('SELECT COUNT(*) n FROM channel_group'),
      updatedAt: Number(this.getMeta('updatedAt')) || 0,
      sizeBytes: (() => {
        try {
          return fs.statSync(this.file).size;
        } catch {
          return 0;
        }
      })()
    };
  }

  // ------------------------------------------------------------- ingestion

  /**
   * Replace the whole catalogue in one transaction. User overrides are left
   * alone, so hiding and reordering survive a refresh.
   */
  ingest({ channels = [], movies = [], series = [], liveCategories = [], vodCategories = [], seriesCategories = [] }) {
    const db = this.db;
    const started = Date.now();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM channel; DELETE FROM movie; DELETE FROM series; DELETE FROM category; DELETE FROM search_fts;');

      const cat = db.prepare('INSERT OR REPLACE INTO category(kind,id,name,ord) VALUES(?,?,?,?)');
      liveCategories.forEach((c, i) => cat.run('live', String(c.category_id), c.category_name || 'Unnamed', i));
      vodCategories.forEach((c, i) => cat.run('movie', String(c.category_id), c.category_name || 'Unnamed', i));
      seriesCategories.forEach((c, i) => cat.run('series', String(c.category_id), c.category_name || 'Unnamed', i));

      const fts = db.prepare('INSERT INTO search_fts(name, kind, item_id) VALUES(?,?,?)');

      const ch = db.prepare(
        'INSERT OR REPLACE INTO channel(id,name,num,logo,cat,epg_id,archive,added) VALUES(?,?,?,?,?,?,?,?)'
      );
      channels.forEach((c, i) => {
        const id = String(c.stream_id);
        const name = String(c.name || `Channel ${id}`);
        ch.run(
          id,
          name,
          Number(c.num) || i + 1,
          c.stream_icon || null,
          String(c.category_id ?? ''),
          c.epg_channel_id ? String(c.epg_channel_id).trim() : null,
          Number(c.tv_archive) > 0 ? 1 : 0,
          Number(c.added) || 0
        );
        fts.run(name, 'live', id);
      });

      const mv = db.prepare(
        'INSERT OR REPLACE INTO movie(id,name,cover,rating,year,cat,ext,added,genre,plot) VALUES(?,?,?,?,?,?,?,?,?,?)'
      );
      movies.forEach((m) => {
        const id = String(m.stream_id);
        const name = String(m.name || 'Untitled');
        mv.run(
          id,
          name,
          m.stream_icon || m.cover || null,
          Number(m.rating) || 0,
          m.year ? String(m.year).slice(0, 4) : null,
          String(m.category_id ?? ''),
          m.container_extension || 'mp4',
          Number(m.added) || 0,
          m.genre || null,
          m.plot || null
        );
        fts.run(name, 'movie', id);
      });

      const sr = db.prepare(
        'INSERT OR REPLACE INTO series(id,name,cover,rating,year,cat,modified,genre,plot) VALUES(?,?,?,?,?,?,?,?,?)'
      );
      series.forEach((s) => {
        const id = String(s.series_id);
        const name = String(s.name || 'Untitled');
        sr.run(
          id,
          name,
          s.cover || null,
          Number(s.rating) || 0,
          String(s.releaseDate || s.year || '').slice(0, 4) || null,
          String(s.category_id ?? ''),
          Number(s.last_modified) || Number(s.added) || 0,
          s.genre || null,
          s.plot || null
        );
        fts.run(name, 'series', id);
      });

      this.setMeta('updatedAt', Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    db.exec('ANALYZE');
    return { ms: Date.now() - started, ...this.stats() };
  }

  // --------------------------------------------------------------- queries

  /** Category list with live counts, honouring hidden channels. */
  categories(kind) {
    const table = kind === 'live' ? 'channel' : kind === 'movie' ? 'movie' : 'series';
    const hiddenJoin =
      kind === 'live'
        ? 'LEFT JOIN channel_pref p ON p.id = t.id WHERE COALESCE(p.hidden,0) = 0'
        : '';
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, COUNT(t.id) AS count
           FROM category c
           LEFT JOIN ${table} t ON t.cat = c.id
           ${hiddenJoin ? hiddenJoin.replace('WHERE', 'AND') : ''}
          WHERE c.kind = ?
          GROUP BY c.id, c.name
          ORDER BY c.ord`
      )
      .all(kind);
    return rows.filter((r) => r.count > 0);
  }

  /**
   * A page of channels. `category` may be a real id, or one of the pseudo
   * categories used by the UI.
   */
  channels({ category = null, search = '', limit = 200, offset = 0, includeHidden = false, groupId = null } = {}) {
    const where = [];
    const args = [];

    let from = `FROM channel c LEFT JOIN channel_pref p ON p.id = c.id`;

    if (groupId != null) {
      from += ` JOIN channel_group_member gm ON gm.channel_id = c.id AND gm.group_id = ?`;
      args.push(groupId);
    }
    if (!includeHidden) where.push('COALESCE(p.hidden,0) = 0');
    if (category) {
      where.push('c.cat = ?');
      args.push(String(category));
    }
    if (search) {
      where.push('c.name LIKE ?');
      args.push(`%${search}%`);
    }

    const order = groupId != null ? 'gm.ord' : 'COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num)';

    const sql = `
      SELECT c.id, COALESCE(p.custom_name, c.name) AS name,
             COALESCE(p.custom_num, c.num) AS num,
             c.logo, c.cat, c.epg_id, c.archive,
             COALESCE(p.hidden,0) AS hidden
      ${from}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...args, limit, offset);
  }

  channelCount({ category = null, search = '', includeHidden = false, groupId = null } = {}) {
    const where = [];
    const args = [];
    let from = `FROM channel c LEFT JOIN channel_pref p ON p.id = c.id`;
    if (groupId != null) {
      from += ` JOIN channel_group_member gm ON gm.channel_id = c.id AND gm.group_id = ?`;
      args.push(groupId);
    }
    if (!includeHidden) where.push('COALESCE(p.hidden,0) = 0');
    if (category) {
      where.push('c.cat = ?');
      args.push(String(category));
    }
    if (search) {
      where.push('c.name LIKE ?');
      args.push(`%${search}%`);
    }
    const sql = `SELECT COUNT(*) n ${from} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    return this.db.prepare(sql).get(...args).n;
  }

  /** Every visible channel id in display order — the player's zap list. */
  channelIds({ category = null, groupId = null } = {}) {
    return this.channels({ category, groupId, limit: 1000000, offset: 0 }).map((c) => c.id);
  }

  titles(kind, { category = null, search = '', sort = 'added', limit = 100, offset = 0 } = {}) {
    const table = kind === 'movie' ? 'movie' : 'series';
    const recency = table === 'movie' ? 'added' : 'modified';
    const orders = {
      added: `${recency} DESC`,
      name: 'name COLLATE NOCASE ASC',
      rating: 'rating DESC',
      year: 'year DESC'
    };
    const where = [];
    const args = [];
    if (category) {
      where.push('cat = ?');
      args.push(String(category));
    }
    if (search) {
      where.push('name LIKE ?');
      args.push(`%${search}%`);
    }
    const sql = `SELECT * FROM ${table}
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${orders[sort] || orders.added}
                 LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...args, limit, offset);
  }

  titleCount(kind, { category = null, search = '' } = {}) {
    const table = kind === 'movie' ? 'movie' : 'series';
    const where = [];
    const args = [];
    if (category) {
      where.push('cat = ?');
      args.push(String(category));
    }
    if (search) {
      where.push('name LIKE ?');
      args.push(`%${search}%`);
    }
    const sql = `SELECT COUNT(*) n FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    return this.db.prepare(sql).get(...args).n;
  }

  byIds(kind, ids) {
    if (!ids || !ids.length) return [];
    const holes = ids.map(() => '?').join(',');

    // Channels must come back through the same override overlay the listing
    // uses, otherwise a renamed or renumbered channel reverts to its provider
    // name everywhere it is fetched by id — favourites, recents, search.
    const sql =
      kind === 'live'
        ? `SELECT c.id, COALESCE(p.custom_name, c.name) AS name,
                  COALESCE(p.custom_num, c.num) AS num,
                  c.logo, c.cat, c.epg_id, c.archive, c.added,
                  COALESCE(p.hidden, 0) AS hidden
             FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
            WHERE c.id IN (${holes})`
        : `SELECT * FROM ${kind === 'movie' ? 'movie' : 'series'} WHERE id IN (${holes})`;

    const rows = this.db.prepare(sql).all(...ids.map(String));
    // preserve caller order (favourites / recents are ordered lists)
    const index = new Map(rows.map((r) => [String(r.id), r]));
    return ids.map((id) => index.get(String(id))).filter(Boolean);
  }

  one(kind, id) {
    return this.byIds(kind, [id])[0] || null;
  }

  /** Unified full-text search. One query covers all three kinds. */
  search(term, { limit = 60, kinds = ['live', 'movie', 'series'] } = {}) {
    const cleaned = String(term || '').trim();
    if (cleaned.length < 2) return { live: [], movie: [], series: [] };

    // Quote each token and prefix-match the last one, the way a search box behaves.
    const tokens = cleaned.replace(/["*]/g, ' ').split(/\s+/).filter(Boolean);
    if (!tokens.length) return { live: [], movie: [], series: [] };
    const match = tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');

    const out = { live: [], movie: [], series: [] };
    for (const kind of kinds) {
      const rows = this.db
        .prepare(
          `SELECT f.item_id AS id
             FROM search_fts f
            WHERE search_fts MATCH ? AND f.kind = ?
            ORDER BY rank
            LIMIT ?`
        )
        .all(match, kind, limit);
      out[kind] = this.byIds(kind, rows.map((r) => r.id));
    }
    // hidden channels should not surface in search either
    if (out.live.length) {
      const hidden = new Set(
        this.db.prepare('SELECT id FROM channel_pref WHERE hidden = 1').all().map((r) => String(r.id))
      );
      if (hidden.size) out.live = out.live.filter((c) => !hidden.has(String(c.id)));
    }
    return out;
  }

  /** Channels that expose catch-up, for the archive view. */
  archiveChannels(limit = 500) {
    return this.db
      .prepare(
        `SELECT c.id, COALESCE(p.custom_name, c.name) AS name, c.logo, c.epg_id,
                COALESCE(p.custom_num, c.num) AS num
           FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
          WHERE c.archive = 1 AND COALESCE(p.hidden,0) = 0
          ORDER BY COALESCE(p.sort_order, 1000000), num
          LIMIT ?`
      )
      .all(limit);
  }

  /** Every channel's id + epg id + name — used once to build the EPG map. */
  epgMappingRows() {
    return this.db.prepare('SELECT id AS stream_id, epg_id AS epg_channel_id, name FROM channel').all();
  }

  // ----------------------------------------------------- channel management

  setHidden(ids, hidden) {
    const stmt = this.db.prepare(
      `INSERT INTO channel_pref(id, hidden) VALUES(?, ?)
       ON CONFLICT(id) DO UPDATE SET hidden = excluded.hidden`
    );
    this.db.exec('BEGIN');
    try {
      for (const id of ids) stmt.run(String(id), hidden ? 1 : 0);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.db.prepare('SELECT COUNT(*) n FROM channel_pref WHERE hidden = 1').get().n;
  }

  /** @param {string[]} orderedIds full ordering for the affected channels */
  setOrder(orderedIds) {
    const stmt = this.db.prepare(
      `INSERT INTO channel_pref(id, sort_order) VALUES(?, ?)
       ON CONFLICT(id) DO UPDATE SET sort_order = excluded.sort_order`
    );
    this.db.exec('BEGIN');
    try {
      orderedIds.forEach((id, i) => stmt.run(String(id), i));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  renameChannel(id, name) {
    this.db
      .prepare(
        `INSERT INTO channel_pref(id, custom_name) VALUES(?, ?)
         ON CONFLICT(id) DO UPDATE SET custom_name = excluded.custom_name`
      )
      .run(String(id), name || null);
  }

  setCustomNumber(id, num) {
    this.db
      .prepare(
        `INSERT INTO channel_pref(id, custom_num) VALUES(?, ?)
         ON CONFLICT(id) DO UPDATE SET custom_num = excluded.custom_num`
      )
      .run(String(id), num == null ? null : Number(num));
  }

  resetChannelPrefs() {
    this.db.exec('DELETE FROM channel_pref');
  }

  // ---------------------------------------------------------------- groups

  groups() {
    return this.db
      .prepare(
        `SELECT g.id, g.name, g.ord, COUNT(m.channel_id) AS count
           FROM channel_group g
           LEFT JOIN channel_group_member m ON m.group_id = g.id
          GROUP BY g.id, g.name, g.ord
          ORDER BY g.ord, g.id`
      )
      .all();
  }

  createGroup(name) {
    const ord = this.db.prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM channel_group').get().n;
    const info = this.db.prepare('INSERT INTO channel_group(name, ord) VALUES(?, ?)').run(name, ord);
    return Number(info.lastInsertRowid);
  }

  renameGroup(id, name) {
    this.db.prepare('UPDATE channel_group SET name = ? WHERE id = ?').run(name, Number(id));
  }

  deleteGroup(id) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM channel_group_member WHERE group_id = ?').run(Number(id));
      this.db.prepare('DELETE FROM channel_group WHERE id = ?').run(Number(id));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  setGroupChannels(groupId, ids) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM channel_group_member WHERE group_id = ?').run(Number(groupId));
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO channel_group_member(group_id, channel_id, ord) VALUES(?,?,?)'
      );
      ids.forEach((id, i) => stmt.run(Number(groupId), String(id), i));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addToGroup(groupId, ids) {
    const base = this.db
      .prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM channel_group_member WHERE group_id = ?')
      .get(Number(groupId)).n;
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO channel_group_member(group_id, channel_id, ord) VALUES(?,?,?)'
    );
    this.db.exec('BEGIN');
    try {
      ids.forEach((id, i) => stmt.run(Number(groupId), String(id), base + i));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  removeFromGroup(groupId, ids) {
    const stmt = this.db.prepare('DELETE FROM channel_group_member WHERE group_id = ? AND channel_id = ?');
    this.db.exec('BEGIN');
    try {
      for (const id of ids) stmt.run(Number(groupId), String(id));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = { CatalogueDb };
