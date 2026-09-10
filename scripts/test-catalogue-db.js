/**
 * Exercises CatalogueDb against the real cached catalogue in userData.
 * Run: node scripts/test-catalogue-db.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CatalogueDb } = require('../src/main/catalogue-db');

const ud = path.join(process.env.APPDATA || os.homedir(), 'Aurum IPTV');
const cacheDir = path.join(ud, 'catalogue-cache');

if (!fs.existsSync(cacheDir)) {
  console.error('No catalogue cache found — sign in with the desktop app first.');
  process.exit(1);
}

// ---------------------------------------------------------------- load input
const payload = { channels: [], movies: [], series: [], liveCategories: [], vodCategories: [], seriesCategories: [] };
for (const f of fs.readdirSync(cacheDir)) {
  const e = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
  if (!Array.isArray(e.data)) continue;
  if (e.key === 'live:all') payload.channels = e.data;
  else if (e.key === 'vod:all') payload.movies = e.data;
  else if (e.key === 'series:all') payload.series = e.data;
  else if (e.key === 'cat:live') payload.liveCategories = e.data;
  else if (e.key === 'cat:vod') payload.vodCategories = e.data;
  else if (e.key === 'cat:series') payload.seriesCategories = e.data;
}

const dbFile = path.join(os.tmpdir(), `aurum-test-${Date.now()}.db`);
const db = new CatalogueDb(dbFile).open();

let failures = 0;
const check = (label, actual, predicate, detail = '') => {
  const ok = predicate(actual);
  if (!ok) failures += 1;
  const shown = typeof actual === 'object' ? JSON.stringify(actual).slice(0, 70) : actual;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label.padEnd(42)} ${shown}${detail ? '  ' + detail : ''}`);
};

const time = (fn) => {
  const t = process.hrtime.bigint();
  const r = fn();
  return [r, Number(process.hrtime.bigint() - t) / 1e6];
};

console.log('\n--- ingest ---');
const [stats, ingestMs] = time(() => db.ingest(payload));
console.log(`  ${stats.channels.toLocaleString()} channels, ${stats.movies.toLocaleString()} films, ${stats.series.toLocaleString()} series`);
console.log(`  ingest ${ingestMs.toFixed(0)} ms, db ${(stats.sizeBytes / 1048576).toFixed(1)} MB`);
check('channels ingested', stats.channels, (n) => n === payload.channels.length);
check('films ingested', stats.movies, (n) => n === payload.movies.length);
check('series ingested', stats.series, (n) => n === payload.series.length);

console.log('\n--- queries ---');
const [cats, catMs] = time(() => db.categories('live'));
check('live categories', cats.length, (n) => n > 0, `${catMs.toFixed(1)} ms`);
check('category has a count', cats[0].count, (n) => n > 0);

const [page, pageMs] = time(() => db.channels({ limit: 50 }));
check('channel page', page.length, (n) => n === 50, `${pageMs.toFixed(1)} ms`);
check('channel ordered by number', page, (p) => p[0].num <= p[49].num);

const [inCat, inCatMs] = time(() => db.channels({ category: cats[0].id, limit: 20 }));
check('channels by category', inCat.length, (n) => n > 0, `${inCatMs.toFixed(1)} ms`);
check('category filter honoured', inCat.every((c) => c.cat === cats[0].id), (v) => v === true);

const [films, filmMs] = time(() => db.titles('movie', { sort: 'added', limit: 50 }));
check('newest films', films.length, (n) => n === 50, `${filmMs.toFixed(1)} ms`);
check('sorted by recency', films, (f) => f[0].added >= f[49].added);

const [rated, ratedMs] = time(() => db.titles('movie', { sort: 'rating', limit: 50 }));
check('top-rated films', rated[0].rating, (r) => r >= rated[49].rating, `${ratedMs.toFixed(1)} ms`);

console.log('\n--- full-text search ---');
for (const term of ['sky sports', 'bbc', 'the matrix', 'breaking bad']) {
  const [res, ms] = time(() => db.search(term, { limit: 20 }));
  const total = res.live.length + res.movie.length + res.series.length;
  check(`search "${term}"`, `${total} hits`, () => ms < 60, `${ms.toFixed(1)} ms`);
}

console.log('\n--- channel management ---');
const victims = db.channels({ limit: 5 }).map((c) => c.id);
const beforeCount = db.channelCount({});
db.setHidden(victims, true);
check('hiding removes from listing', db.channelCount({}), (n) => n === beforeCount - 5);
check('hidden still visible with flag', db.channelCount({ includeHidden: true }), (n) => n === beforeCount);
const searchAfterHide = db.search(db.one('live', victims[0]).name, { kinds: ['live'], limit: 20 });
check('hidden excluded from search', searchAfterHide.live.some((c) => c.id === victims[0]), (v) => v === false);
db.setHidden(victims, false);
check('unhiding restores', db.channelCount({}), (n) => n === beforeCount);

const reorder = db.channels({ limit: 5 }).map((c) => c.id).reverse();
db.setOrder(reorder);
check('custom order applied', db.channels({ limit: 5 }).map((c) => c.id), (ids) => ids[0] === reorder[0]);

db.renameChannel(reorder[0], 'My Renamed Channel');
check('rename applied', db.one('live', reorder[0]).name, (n) => n === 'My Renamed Channel');
db.setCustomNumber(reorder[0], 1);
check('custom number applied', db.one('live', reorder[0]).num, (n) => n === 1);

console.log('\n--- groups ---');
const gid = db.createGroup('Sports');
db.addToGroup(gid, db.channels({ limit: 8 }).map((c) => c.id));
const groups = db.groups();
check('group created', groups.length, (n) => n === 1);
check('group membership', groups[0].count, (n) => n === 8);
check('query by group', db.channels({ groupId: gid, limit: 50 }).length, (n) => n === 8);
db.removeFromGroup(gid, [db.channels({ groupId: gid, limit: 1 })[0].id]);
check('remove from group', db.groups()[0].count, (n) => n === 7);
db.deleteGroup(gid);
check('group deleted', db.groups().length, (n) => n === 0);

console.log('\n--- overrides survive a refresh ---');
db.setHidden(victims, true);
db.ingest(payload);
check('hidden survives re-ingest', db.channelCount({ includeHidden: true }) - db.channelCount({}), (n) => n === 5);
check('rename survives re-ingest', db.one('live', reorder[0]).name, (n) => n === 'My Renamed Channel');
db.resetChannelPrefs();

console.log('\n--- catch-up ---');
const [arch, archMs] = time(() => db.archiveChannels(500));
check('channels with archive', arch.length, (n) => n >= 0, `${archMs.toFixed(1)} ms`);

console.log('\n--- epg mapping rows ---');
const [rows, epgMs] = time(() => db.epgMappingRows());
check('epg mapping rows', rows.length, (n) => n === stats.channels, `${epgMs.toFixed(0)} ms`);

db.close();
fs.rmSync(dbFile, { force: true });
fs.rmSync(dbFile + '-wal', { force: true });
fs.rmSync(dbFile + '-shm', { force: true });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
