/**
 * Regression tests for CatalogueDb.
 *
 * Uses a generated catalogue at realistic scale rather than the user's own
 * cache, so the suite runs anywhere and does not depend on a signed-in line.
 *
 * Run: node scripts/test-catalogue-db.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CatalogueDb } = require('../src/main/catalogue-db');

const SCALE = Number(process.env.SCALE) || 1;
const CHANNELS = Math.round(20000 * SCALE);
const MOVIES = Math.round(60000 * SCALE);
const SERIES = Math.round(12000 * SCALE);

// -------------------------------------------------------------- fixtures

const WORDS = ['Sky', 'Sports', 'BBC', 'One', 'News', 'Movies', 'Premier', 'Cinema', 'Kids', 'Nature',
  'Drama', 'Comedy', 'History', 'Discovery', 'Action', 'Classic', 'Late', 'Night', 'World', 'Live'];

const pick = (i, offset = 0) => WORDS[(i * 7 + offset * 13) % WORDS.length];

function buildPayload() {
  const liveCategories = Array.from({ length: 40 }, (_, i) => ({
    category_id: `L${i}`, category_name: `${pick(i)} ${pick(i, 1)}`
  }));
  const vodCategories = Array.from({ length: 25 }, (_, i) => ({
    category_id: `V${i}`, category_name: `${pick(i, 2)} Films`
  }));
  const seriesCategories = Array.from({ length: 15 }, (_, i) => ({
    category_id: `S${i}`, category_name: `${pick(i, 3)} Box Sets`
  }));

  const channels = Array.from({ length: CHANNELS }, (_, i) => ({
    stream_id: 1000 + i,
    // A couple of known names so the multi-token FTS path has something to find.
    name: i < 3
      ? ['Sky Sports Main Event', 'Sky Sports Premier League', 'BBC One HD'][i]
      : `${pick(i)} ${pick(i, 1)} ${i % 5 === 0 ? 'HD' : ''}`.trim(),
    num: i + 1,
    stream_icon: i % 3 === 0 ? `http://logo/${i}.png` : '',
    category_id: `L${i % 40}`,
    epg_channel_id: i % 2 === 0 ? `epg.${i}` : '',
    tv_archive: i % 20 === 0 ? 1 : 0,
    added: 1700000000 - i
  }));

  const movies = Array.from({ length: MOVIES }, (_, i) => ({
    stream_id: 500000 + i,
    name: `${pick(i, 4)} ${pick(i, 5)} ${1980 + (i % 45)}`,
    stream_icon: `http://poster/${i}.jpg`,
    rating: (i % 100) / 10,
    year: String(1980 + (i % 45)),
    category_id: `V${i % 25}`,
    container_extension: i % 7 === 0 ? 'mkv' : 'mp4',
    added: 1700000000 - i,
    genre: pick(i, 6),
    plot: 'A synopsis.'
  }));

  const series = Array.from({ length: SERIES }, (_, i) => ({
    series_id: 900000 + i,
    name: `${pick(i, 7)} ${pick(i, 8)}`,
    cover: `http://cover/${i}.jpg`,
    rating: (i % 100) / 10,
    releaseDate: `${2000 + (i % 25)}-01-01`,
    category_id: `S${i % 15}`,
    last_modified: 1700000000 - i,
    genre: pick(i, 9),
    plot: 'A synopsis.'
  }));

  return { channels, movies, series, liveCategories, vodCategories, seriesCategories };
}

// ------------------------------------------------------------------ harness

let failures = 0;
const check = (label, actual, predicate, detail = '') => {
  const ok = predicate(actual);
  if (!ok) failures += 1;
  const shown = typeof actual === 'object' ? JSON.stringify(actual).slice(0, 60) : actual;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} ${shown}${detail ? '  ' + detail : ''}`);
};

const time = (fn) => {
  const t = process.hrtime.bigint();
  const r = fn();
  return [r, Number(process.hrtime.bigint() - t) / 1e6];
};

const dbFile = path.join(os.tmpdir(), `aurum-test-${Date.now()}.db`);
const db = new CatalogueDb(dbFile).open();
const payload = buildPayload();

// ------------------------------------------------------------------- tests

console.log('\n--- ingest ---');
const [stats, ingestMs] = time(() => db.ingest(payload));
console.log(`  ${stats.channels.toLocaleString()} channels, ${stats.movies.toLocaleString()} films, ${stats.series.toLocaleString()} series in ${ingestMs.toFixed(0)} ms`);
check('channels ingested', stats.channels, (n) => n === CHANNELS);
check('films ingested', stats.movies, (n) => n === MOVIES);
check('series ingested', stats.series, (n) => n === SERIES);

console.log('\n--- queries ---');
const [cats, catMs] = time(() => db.categories('live'));
check('live categories', cats.length, (n) => n === 40, `${catMs.toFixed(1)} ms`);
check('category counts sum to total', cats.reduce((a, c) => a + c.count, 0), (n) => n === CHANNELS);

const [page, pageMs] = time(() => db.channels({ limit: 50 }));
check('channel page size', page.length, (n) => n === 50, `${pageMs.toFixed(1)} ms`);
check('ordered by number', page, (p) => p[0].num === 1 && p[49].num === 50);
check('paging offset works', db.channels({ limit: 10, offset: 50 })[0].num, (n) => n === 51);

const inCat = db.channels({ category: 'L3', limit: 20 });
check('category filter', inCat.every((c) => c.cat === 'L3'), (v) => v === true);

const [films, filmMs] = time(() => db.titles('movie', { sort: 'added', limit: 50 }));
check('newest films', films.length, (n) => n === 50, `${filmMs.toFixed(1)} ms`);
check('sorted by recency', films, (f) => f[0].added >= f[49].added);
check('top-rated sorted', db.titles('movie', { sort: 'rating', limit: 20 }), (r) => r[0].rating >= r[19].rating);
check('a-z sorted', db.titles('movie', { sort: 'name', limit: 20 }), (r) => r[0].name <= r[19].name);

console.log('\n--- full-text search ---');
for (const term of ['sky sports', 'premier', 'discovery']) {
  const [res, ms] = time(() => db.search(term, { limit: 20 }));
  const total = res.live.length + res.movie.length + res.series.length;
  check(`search "${term}"`, `${total} hits`, () => ms < 80 && total > 0, `${ms.toFixed(1)} ms`);
}
check('short terms rejected', db.search('a'), (r) => r.live.length === 0 && r.movie.length === 0);

console.log('\n--- channel management ---');
const victims = db.channels({ limit: 5 }).map((c) => c.id);
const before = db.channelCount({});
db.setHidden(victims, true);
check('hiding removes from listing', db.channelCount({}), (n) => n === before - 5);
check('includeHidden still sees them', db.channelCount({ includeHidden: true }), (n) => n === before);
// This is the bug the category query had: a LEFT JOIN filter in ON still counts hidden rows.
check(
  'hidden excluded from category counts',
  db.categories('live').reduce((a, c) => a + c.count, 0),
  (n) => n === before - 5
);
check(
  'hidden excluded from search',
  db.search(db.one('live', victims[0]).name, { kinds: ['live'], limit: 40 }).live.some((c) => c.id === victims[0]),
  (v) => v === false
);
db.setHidden(victims, false);
check('unhiding restores', db.channelCount({}), (n) => n === before);

const reorder = db.channels({ limit: 5 }).map((c) => c.id).reverse();
db.setOrder(reorder);
check('custom order applied', db.channels({ limit: 5 }).map((c) => c.id), (ids) => ids[0] === reorder[0]);

db.renameChannel(reorder[0], 'My Renamed Channel');
check('rename applied', db.one('live', reorder[0]).name, (n) => n === 'My Renamed Channel');
db.setCustomNumber(reorder[0], 1);
check('custom number applied', db.one('live', reorder[0]).num, (n) => n === 1);
check('byIds honours caller order', db.byIds('live', [reorder[1], reorder[0]]).map((c) => c.id),
  (ids) => ids[0] === reorder[1]);

console.log('\n--- groups ---');
const gid = db.createGroup('Sports');
db.addToGroup(gid, db.channels({ limit: 8 }).map((c) => c.id));
check('group created', db.groups().length, (n) => n === 1);
check('membership counted', db.groups()[0].count, (n) => n === 8);
check('query by group', db.channels({ groupId: gid, limit: 50 }).length, (n) => n === 8);
db.removeFromGroup(gid, [db.channels({ groupId: gid, limit: 1 })[0].id]);
check('remove from group', db.groups()[0].count, (n) => n === 7);
db.renameGroup(gid, 'Sport');
check('group renamed', db.groups()[0].name, (n) => n === 'Sport');

console.log('\n--- catch-up ---');
check('archive channels found', db.archiveChannels(5000).length, (n) => n === Math.ceil(CHANNELS / 20));

console.log('\n--- metadata (TMDB cache) ---');
db.saveMetadata('movie', '500000', { tmdbId: 603, title: 'The Matrix', overview: 'Neo.' });
check('metadata round-trips', db.metadata('movie', '500000').title, (t) => t === 'The Matrix');
db.saveMetadata('movie', '500001', null);
check('a miss is remembered', db.metadata('movie', '500001'), (m) => m && m.miss === true);
check('metadata stats', db.metadataStats(), (s) => s.enriched === 1 && s.notFound === 1);

console.log('\n--- overrides and metadata survive a refresh ---');
db.setHidden(victims, true);
db.ingest(payload);
check('hidden survives', db.channelCount({ includeHidden: true }) - db.channelCount({}), (n) => n === 5);
check('rename survives', db.one('live', reorder[0]).name, (n) => n === 'My Renamed Channel');
check('groups survive', db.groups().length, (n) => n === 1);
check('metadata survives', db.metadata('movie', '500000').title, (t) => t === 'The Matrix');

db.close();
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
