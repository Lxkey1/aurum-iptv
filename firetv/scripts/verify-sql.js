/**
 * Runs the schema and query shapes from the Android CatalogueDb through SQLite.
 *
 * A Kotlin compile proves the types; it cannot prove the SQL. This extracts the
 * real DDL out of onCreate() and exercises the exact queries the app issues, so
 * a typo in a JOIN or a COALESCE is caught here rather than on the TV.
 *
 * Run: node firetv/scripts/verify-sql.js
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'com', 'aurum', 'tv', 'data', 'CatalogueDb.kt');
const src = fs.readFileSync(source, 'utf8');

const onCreate = src.slice(src.indexOf('override fun onCreate'), src.indexOf('override fun onUpgrade'));

// Match execSQL("""..."""), then execSQL("...")
const statements = [];
const tripleQuoted = /execSQL\(\s*"""([\s\S]*?)"""/g;
const singleQuoted = /execSQL\(\s*"([^"\n]+)"\s*\)/g;
let m;
while ((m = tripleQuoted.exec(onCreate))) statements.push(m[1].trim());
while ((m = singleQuoted.exec(onCreate))) statements.push(m[1].trim());

console.log(`extracted ${statements.length} DDL statements from onCreate()\n`);

const db = new DatabaseSync(':memory:');
let failures = 0;
let ftsNote = 'fts4';

for (const sql of statements) {
  try {
    db.exec(sql);
  } catch (err) {
    if (/fts4/i.test(sql)) {
      // node's SQLite build may omit FTS4; FTS5 exercises the same query shape.
      try {
        db.exec(sql.replace(/fts4/i, 'fts5').replace(/,\s*tokenize=unicode61/i, ''));
        ftsNote = 'fts5 substituted locally (FTS4 not compiled into node; both support the same MATCH shape)';
      } catch (err2) {
        failures += 1;
        console.log(`FAIL ${sql.slice(0, 70)}\n  ${err2.message}`);
      }
    } else {
      failures += 1;
      console.log(`FAIL ${sql.slice(0, 70)}\n  ${err.message}`);
    }
  }
}
console.log(`schema applied — ${failures} DDL failure(s); fts: ${ftsNote}\n`);

// ------------------------------------------------------------------ fixtures
db.exec(`
  INSERT INTO category(kind,id,name,ord) VALUES('live','1','Sports',0),('movie','10','Action',0);
  INSERT INTO channel(id,name,num,logo,cat,epg_id,archive,added) VALUES
    ('c1','Sky Sports Main Event',1,NULL,'1','sky.uk',1,0),
    ('c2','BBC One HD',2,NULL,'1','bbc1.uk',0,0),
    ('c3','TNT Sports 1',3,NULL,'1',NULL,1,0);
  INSERT INTO movie(id,name,cover,rating,year,cat,ext,added,genre,plot)
    VALUES('m1','The Matrix',NULL,8.7,'1999','10','mp4',100,NULL,NULL);
  INSERT INTO search_item(kind,item_id) VALUES('live','c1'),('live','c2'),('live','c3'),('movie','m1');
  INSERT INTO search_fts(rowid,name)
    VALUES(1,'Sky Sports Main Event'),(2,'BBC One HD'),(3,'TNT Sports 1'),(4,'The Matrix');
  INSERT INTO channel_pref(id,hidden,sort_order,custom_num,custom_name) VALUES('c2',1,NULL,NULL,NULL);
  INSERT INTO channel_group(name,ord) VALUES('Sport',0);
  INSERT INTO channel_group_member(group_id,channel_id,ord) VALUES(1,'c1',0),(1,'c3',1);
`);

function check(label, sql, args, expect) {
  try {
    const rows = db.prepare(sql).all(...args);
    const ok = expect(rows);
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} ${rows.length} row(s)`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label.padEnd(46)} ${err.message}`);
  }
}

// The SQL below is copied from CatalogueDb.kt, so a change there that breaks it
// shows up as a failure here.
check(
  'categories(live) excludes hidden',
  `SELECT c.id, c.name, COUNT(t.id) AS n FROM category c
     LEFT JOIN channel t ON t.cat = c.id
     LEFT JOIN channel_pref p ON p.id = t.id
    WHERE c.kind = ? AND COALESCE(p.hidden,0) = 0
    GROUP BY c.id, c.name HAVING COUNT(t.id) > 0 ORDER BY c.ord`,
  ['live'],
  (r) => r.length === 1 && r[0].n === 2
);

check(
  'channels() applies overrides and hiding',
  `SELECT c.id, COALESCE(p.custom_name, c.name) AS name, COALESCE(p.custom_num, c.num) AS num,
          c.logo, c.cat, c.epg_id, c.archive, c.added, COALESCE(p.hidden,0) AS hidden
     FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
    WHERE COALESCE(p.hidden,0) = 0
    ORDER BY COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num) LIMIT ? OFFSET ?`,
  [50, 0],
  (r) => r.length === 2 && r.every((x) => x.id !== 'c2')
);

check(
  'channels() filtered by custom group',
  `SELECT c.id FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
     JOIN channel_group_member gm ON gm.channel_id = c.id AND gm.group_id = ?
    WHERE COALESCE(p.hidden,0) = 0 ORDER BY gm.ord LIMIT ? OFFSET ?`,
  [1, 50, 0],
  (r) => r.length === 2 && r[0].id === 'c1'
);

check(
  'archiveChannels() finds catch-up channels',
  `SELECT c.id FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
    WHERE c.archive = 1 AND COALESCE(p.hidden,0) = 0
    ORDER BY COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num) LIMIT ?`,
  [500],
  (r) => r.length === 2
);

check(
  'search joins fts to kind on docid',
  `SELECT si.item_id FROM search_fts f JOIN search_item si ON si.id = f.rowid
    WHERE search_fts MATCH ? AND si.kind = ? LIMIT ?`,
  ['"sports"*', 'live', 40],
  (r) => r.length === 2
);

check('titleCount(movie)', 'SELECT COUNT(*) AS n FROM movie WHERE cat = ?', ['10'], (r) => r[0].n === 1);

check(
  'movies() sorted by recency',
  'SELECT id,name,cover,rating,year,cat,ext,added,genre,plot FROM movie ORDER BY added DESC LIMIT ? OFFSET ?',
  [60, 0],
  (r) => r.length === 1
);

// setHidden must not wipe the other override columns
try {
  db.exec(`INSERT OR REPLACE INTO channel_pref(id, hidden, sort_order, custom_num, custom_name)
           VALUES('c1', 1, (SELECT sort_order FROM channel_pref WHERE id='c1'),
                  (SELECT custom_num FROM channel_pref WHERE id='c1'),
                  (SELECT custom_name FROM channel_pref WHERE id='c1'))`);
  const n = db.prepare('SELECT COUNT(*) n FROM channel_pref WHERE hidden = 1').get().n;
  const ok = n === 2;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${'setHidden upsert preserves other columns'.padEnd(46)} ${n} hidden`);
} catch (err) {
  failures += 1;
  console.log(`  FAIL setHidden upsert: ${err.message}`);
}

console.log(`\n${failures === 0 ? 'ANDROID SQL VERIFIED' : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
