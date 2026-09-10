package com.aurum.tv.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.database.sqlite.SQLiteStatement

/**
 * The catalogue, on disk.
 *
 * A real line measured during development held 53,683 channels, 158,173 films
 * and 36,254 series. Holding that as Kotlin objects is roughly 200-300 MB of
 * Java heap; a Fire TV Stick allows an app 192-512 MB even with largeHeap, so
 * the previous in-memory design would OOM on the very devices this app targets.
 *
 * Everything now lives in SQLite and the UI asks for pages. FTS4 rather than
 * FTS5 because FTS5 is only guaranteed from API 26 and minSdk here is 22.
 */
class CatalogueDb(context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION) {

    companion object {
        private const val NAME = "catalogue.db"
        private const val VERSION = 1

        const val ALL = "__all__"
        const val FAVOURITES = "__fav__"
        const val RECENT = "__recent__"
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        // WAL keeps the UI reading while an ingest writes.
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")

        db.execSQL(
            """CREATE TABLE category (
                 kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (kind, id))"""
        )

        db.execSQL(
            """CREATE TABLE channel (
                 id TEXT PRIMARY KEY, name TEXT NOT NULL, num INTEGER NOT NULL DEFAULT 0,
                 logo TEXT, cat TEXT, epg_id TEXT, archive INTEGER NOT NULL DEFAULT 0,
                 added INTEGER NOT NULL DEFAULT 0)"""
        )
        db.execSQL(
            """CREATE TABLE movie (
                 id TEXT PRIMARY KEY, name TEXT NOT NULL, cover TEXT, rating REAL NOT NULL DEFAULT 0,
                 year TEXT, cat TEXT, ext TEXT, added INTEGER NOT NULL DEFAULT 0, genre TEXT, plot TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE series (
                 id TEXT PRIMARY KEY, name TEXT NOT NULL, cover TEXT, rating REAL NOT NULL DEFAULT 0,
                 year TEXT, cat TEXT, modified INTEGER NOT NULL DEFAULT 0, genre TEXT, plot TEXT)"""
        )

        db.execSQL("CREATE INDEX ix_channel_cat ON channel(cat, num)")
        db.execSQL("CREATE INDEX ix_movie_cat ON movie(cat)")
        db.execSQL("CREATE INDEX ix_movie_added ON movie(added DESC)")
        db.execSQL("CREATE INDEX ix_movie_rating ON movie(rating DESC)")
        db.execSQL("CREATE INDEX ix_series_cat ON series(cat)")
        db.execSQL("CREATE INDEX ix_series_mod ON series(modified DESC)")

        // FTS4 indexes names only; kind/id are carried by a companion table
        // joined on docid, which keeps MATCH queries fast.
        db.execSQL("CREATE TABLE search_item (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, item_id TEXT)")
        db.execSQL("CREATE INDEX ix_search_kind ON search_item(kind)")
        db.execSQL("CREATE VIRTUAL TABLE search_fts USING fts4(name, tokenize=unicode61)")

        // ---- user overrides: an ingest never touches these
        db.execSQL(
            """CREATE TABLE channel_pref (
                 id TEXT PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0,
                 sort_order INTEGER, custom_num INTEGER, custom_name TEXT)"""
        )
        db.execSQL("CREATE INDEX ix_pref_hidden ON channel_pref(hidden)")
        db.execSQL("CREATE TABLE channel_group (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0)")
        db.execSQL(
            """CREATE TABLE channel_group_member (
                 group_id INTEGER NOT NULL, channel_id TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (group_id, channel_id))"""
        )
        db.execSQL("CREATE INDEX ix_group_member ON channel_group_member(group_id, ord)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // The catalogue is a cache of the provider; the cheapest correct upgrade
        // is to drop and re-sync. User overrides are preserved across it.
        val prefs = readAllPrefs(db)
        val groups = readAllGroups(db)
        for (t in listOf("meta", "category", "channel", "movie", "series", "search_item", "search_fts")) {
            db.execSQL("DROP TABLE IF EXISTS $t")
        }
        db.execSQL("DROP TABLE IF EXISTS channel_pref")
        db.execSQL("DROP TABLE IF EXISTS channel_group")
        db.execSQL("DROP TABLE IF EXISTS channel_group_member")
        onCreate(db)
        restorePrefs(db, prefs, groups)
    }

    // -------------------------------------------------------------- ingest

    /**
     * Streaming ingest.
     *
     * The caller feeds rows in as they are parsed off the socket, so the whole
     * provider document is never resident. One transaction for the lot.
     */
    inner class Ingest(private val db: SQLiteDatabase) {
        private val channelStmt: SQLiteStatement = db.compileStatement(
            "INSERT OR REPLACE INTO channel(id,name,num,logo,cat,epg_id,archive,added) VALUES(?,?,?,?,?,?,?,?)"
        )
        private val movieStmt: SQLiteStatement = db.compileStatement(
            "INSERT OR REPLACE INTO movie(id,name,cover,rating,year,cat,ext,added,genre,plot) VALUES(?,?,?,?,?,?,?,?,?,?)"
        )
        private val seriesStmt: SQLiteStatement = db.compileStatement(
            "INSERT OR REPLACE INTO series(id,name,cover,rating,year,cat,modified,genre,plot) VALUES(?,?,?,?,?,?,?,?,?)"
        )
        private val categoryStmt: SQLiteStatement = db.compileStatement(
            "INSERT OR REPLACE INTO category(kind,id,name,ord) VALUES(?,?,?,?)"
        )
        private val searchItemStmt: SQLiteStatement = db.compileStatement(
            "INSERT INTO search_item(kind,item_id) VALUES(?,?)"
        )
        private val searchFtsStmt: SQLiteStatement = db.compileStatement(
            "INSERT INTO search_fts(docid,name) VALUES(?,?)"
        )

        var channels = 0; private set
        var movies = 0; private set
        var seriesCount = 0; private set

        private fun index(kind: String, id: String, name: String) {
            searchItemStmt.bindString(1, kind)
            searchItemStmt.bindString(2, id)
            val docId = searchItemStmt.executeInsert()
            searchFtsStmt.bindLong(1, docId)
            searchFtsStmt.bindString(2, name)
            searchFtsStmt.executeInsert()
        }

        private fun SQLiteStatement.bindOrNull(index: Int, value: String?) {
            if (value == null) bindNull(index) else bindString(index, value)
        }

        fun category(kind: String, id: String, name: String, ord: Int) {
            categoryStmt.bindString(1, kind)
            categoryStmt.bindString(2, id)
            categoryStmt.bindString(3, name)
            categoryStmt.bindLong(4, ord.toLong())
            categoryStmt.executeInsert()
        }

        fun channel(c: Channel) {
            channelStmt.bindString(1, c.streamId)
            channelStmt.bindString(2, c.name)
            channelStmt.bindLong(3, c.number.toLong())
            channelStmt.bindOrNull(4, c.logo)
            channelStmt.bindString(5, c.categoryId)
            channelStmt.bindOrNull(6, c.epgChannelId)
            channelStmt.bindLong(7, if (c.hasArchive) 1 else 0)
            channelStmt.bindLong(8, c.addedAt)
            channelStmt.executeInsert()
            index("live", c.streamId, c.name)
            channels++
        }

        fun movie(m: Movie) {
            movieStmt.bindString(1, m.streamId)
            movieStmt.bindString(2, m.name)
            movieStmt.bindOrNull(3, m.cover)
            movieStmt.bindDouble(4, m.rating)
            movieStmt.bindOrNull(5, m.year)
            movieStmt.bindString(6, m.categoryId)
            movieStmt.bindString(7, m.extension)
            movieStmt.bindLong(8, m.addedAt)
            movieStmt.bindOrNull(9, m.genre)
            movieStmt.bindOrNull(10, m.plot)
            movieStmt.executeInsert()
            index("movie", m.streamId, m.name)
            movies++
        }

        fun series(s: Series) {
            seriesStmt.bindString(1, s.seriesId)
            seriesStmt.bindString(2, s.name)
            seriesStmt.bindOrNull(3, s.cover)
            seriesStmt.bindDouble(4, s.rating)
            seriesStmt.bindOrNull(5, s.year)
            seriesStmt.bindString(6, s.categoryId)
            seriesStmt.bindLong(7, s.modifiedAt)
            seriesStmt.bindOrNull(8, s.genre)
            seriesStmt.bindOrNull(9, s.plot)
            seriesStmt.executeInsert()
            index("series", s.seriesId, s.name)
            seriesCount++
        }

        fun close() {
            channelStmt.close(); movieStmt.close(); seriesStmt.close()
            categoryStmt.close(); searchItemStmt.close(); searchFtsStmt.close()
        }
    }

    /** Runs [block] against a fresh, empty catalogue inside one transaction. */
    fun <T> replaceAll(block: (Ingest) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        val ingest = Ingest(db)
        try {
            for (t in listOf("channel", "movie", "series", "category", "search_item", "search_fts")) {
                db.execSQL("DELETE FROM $t")
            }
            val result = block(ingest)
            db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('updatedAt', ?)", arrayOf(System.currentTimeMillis().toString()))
            db.setTransactionSuccessful()
            return result
        } finally {
            ingest.close()
            db.endTransaction()
            runCatching { db.execSQL("ANALYZE") }
        }
    }

    // --------------------------------------------------------------- stats

    data class Stats(
        val channels: Int,
        val movies: Int,
        val series: Int,
        val hidden: Int,
        val groups: Int,
        val updatedAt: Long
    ) {
        val isEmpty: Boolean get() = channels == 0 && movies == 0 && series == 0
    }

    fun stats(): Stats {
        val db = readableDatabase
        fun count(table: String, where: String = ""): Int =
            db.rawQuery("SELECT COUNT(*) FROM $table $where", null).use { it.moveToFirst(); it.getInt(0) }
        val updated = db.rawQuery("SELECT value FROM meta WHERE key='updatedAt'", null).use {
            if (it.moveToFirst()) it.getString(0)?.toLongOrNull() ?: 0L else 0L
        }
        return Stats(
            channels = count("channel"),
            movies = count("movie"),
            series = count("series"),
            hidden = count("channel_pref", "WHERE hidden = 1"),
            groups = count("channel_group"),
            updatedAt = updated
        )
    }

    // ------------------------------------------------------------- queries

    fun categories(kind: String): List<CategoryCount> {
        val table = when (kind) { "live" -> "channel"; "movie" -> "movie"; else -> "series" }
        val hiddenClause =
            if (kind == "live") "LEFT JOIN channel_pref p ON p.id = t.id AND COALESCE(p.hidden,0) = 0" else ""
        val sql =
            """SELECT c.id, c.name, COUNT(t.id) FROM category c
                 LEFT JOIN $table t ON t.cat = c.id
                 ${if (kind == "live") "LEFT JOIN channel_pref p ON p.id = t.id" else ""}
                WHERE c.kind = ? ${if (kind == "live") "AND COALESCE(p.hidden,0) = 0" else ""}
                GROUP BY c.id, c.name HAVING COUNT(t.id) > 0 ORDER BY c.ord"""
        return readableDatabase.rawQuery(sql, arrayOf(kind)).use { c ->
            buildList { while (c.moveToNext()) add(CategoryCount(c.getString(0), c.getString(1), c.getInt(2))) }
        }
    }

    private fun channelWhere(
        category: String?, search: String?, includeHidden: Boolean, groupId: Long?
    ): Pair<String, MutableList<String>> {
        val args = mutableListOf<String>()
        val clauses = mutableListOf<String>()
        var from = "FROM channel c LEFT JOIN channel_pref p ON p.id = c.id"
        if (groupId != null) {
            from += " JOIN channel_group_member gm ON gm.channel_id = c.id AND gm.group_id = ?"
            args.add(groupId.toString())
        }
        if (!includeHidden) clauses.add("COALESCE(p.hidden,0) = 0")
        if (!category.isNullOrEmpty()) { clauses.add("c.cat = ?"); args.add(category) }
        if (!search.isNullOrEmpty()) { clauses.add("c.name LIKE ?"); args.add("%$search%") }
        val where = if (clauses.isEmpty()) "" else "WHERE " + clauses.joinToString(" AND ")
        return "$from $where" to args
    }

    fun channels(
        category: String? = null,
        search: String? = null,
        limit: Int = 100,
        offset: Int = 0,
        includeHidden: Boolean = false,
        groupId: Long? = null
    ): List<Channel> {
        val (fromWhere, args) = channelWhere(category, search, includeHidden, groupId)
        val order = if (groupId != null) "gm.ord"
        else "COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num)"
        val sql =
            """SELECT c.id, COALESCE(p.custom_name, c.name), COALESCE(p.custom_num, c.num),
                      c.logo, c.cat, c.epg_id, c.archive, c.added, COALESCE(p.hidden,0)
               $fromWhere ORDER BY $order LIMIT ? OFFSET ?"""
        args.add(limit.toString()); args.add(offset.toString())
        return readableDatabase.rawQuery(sql, args.toTypedArray()).use { it.readChannels() }
    }

    fun channelCount(
        category: String? = null, search: String? = null,
        includeHidden: Boolean = false, groupId: Long? = null
    ): Int {
        val (fromWhere, args) = channelWhere(category, search, includeHidden, groupId)
        return readableDatabase.rawQuery("SELECT COUNT(*) $fromWhere", args.toTypedArray())
            .use { it.moveToFirst(); it.getInt(0) }
    }

    /** Ordered ids for the player's zap list — ids only, never whole rows. */
    fun channelIds(category: String? = null, groupId: Long? = null, limit: Int = 100000): List<String> {
        val (fromWhere, args) = channelWhere(category, null, false, groupId)
        val order = if (groupId != null) "gm.ord"
        else "COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num)"
        args.add(limit.toString())
        return readableDatabase.rawQuery("SELECT c.id $fromWhere ORDER BY $order LIMIT ?", args.toTypedArray())
            .use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
    }

    fun channelsByIds(ids: List<String>): List<Channel> {
        if (ids.isEmpty()) return emptyList()
        val holes = ids.joinToString(",") { "?" }
        val sql =
            """SELECT c.id, COALESCE(p.custom_name, c.name), COALESCE(p.custom_num, c.num),
                      c.logo, c.cat, c.epg_id, c.archive, c.added, COALESCE(p.hidden,0)
                 FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
                WHERE c.id IN ($holes)"""
        val found = readableDatabase.rawQuery(sql, ids.toTypedArray()).use { it.readChannels() }
        val index = found.associateBy { it.streamId }
        return ids.mapNotNull { index[it] }   // preserve caller ordering
    }

    fun channel(id: String): Channel? = channelsByIds(listOf(id)).firstOrNull()

    fun archiveChannels(limit: Int = 500): List<Channel> {
        val sql =
            """SELECT c.id, COALESCE(p.custom_name, c.name), COALESCE(p.custom_num, c.num),
                      c.logo, c.cat, c.epg_id, c.archive, c.added, COALESCE(p.hidden,0)
                 FROM channel c LEFT JOIN channel_pref p ON p.id = c.id
                WHERE c.archive = 1 AND COALESCE(p.hidden,0) = 0
                ORDER BY COALESCE(p.sort_order, 1000000), COALESCE(p.custom_num, c.num) LIMIT ?"""
        return readableDatabase.rawQuery(sql, arrayOf(limit.toString())).use { it.readChannels() }
    }

    fun movies(
        category: String? = null, search: String? = null,
        sort: String = "added", limit: Int = 60, offset: Int = 0
    ): List<Movie> {
        val (where, args) = titleWhere(category, search)
        args.add(limit.toString()); args.add(offset.toString())
        val order = when (sort) {
            "name" -> "name COLLATE NOCASE ASC"
            "rating" -> "rating DESC"
            "year" -> "year DESC"
            else -> "added DESC"
        }
        return readableDatabase
            .rawQuery("SELECT id,name,cover,rating,year,cat,ext,added,genre,plot FROM movie $where ORDER BY $order LIMIT ? OFFSET ?", args.toTypedArray())
            .use { it.readMovies() }
    }

    fun series(
        category: String? = null, search: String? = null,
        sort: String = "added", limit: Int = 60, offset: Int = 0
    ): List<Series> {
        val (where, args) = titleWhere(category, search)
        args.add(limit.toString()); args.add(offset.toString())
        val order = when (sort) {
            "name" -> "name COLLATE NOCASE ASC"
            "rating" -> "rating DESC"
            "year" -> "year DESC"
            else -> "modified DESC"
        }
        return readableDatabase
            .rawQuery("SELECT id,name,cover,rating,year,cat,modified,genre,plot FROM series $where ORDER BY $order LIMIT ? OFFSET ?", args.toTypedArray())
            .use { it.readSeries() }
    }

    fun titleCount(kind: String, category: String? = null, search: String? = null): Int {
        val table = if (kind == "movie") "movie" else "series"
        val (where, args) = titleWhere(category, search)
        return readableDatabase.rawQuery("SELECT COUNT(*) FROM $table $where", args.toTypedArray())
            .use { it.moveToFirst(); it.getInt(0) }
    }

    fun moviesByIds(ids: List<String>): List<Movie> {
        if (ids.isEmpty()) return emptyList()
        val holes = ids.joinToString(",") { "?" }
        val found = readableDatabase
            .rawQuery("SELECT id,name,cover,rating,year,cat,ext,added,genre,plot FROM movie WHERE id IN ($holes)", ids.toTypedArray())
            .use { it.readMovies() }
        val index = found.associateBy { it.streamId }
        return ids.mapNotNull { index[it] }
    }

    fun seriesByIds(ids: List<String>): List<Series> {
        if (ids.isEmpty()) return emptyList()
        val holes = ids.joinToString(",") { "?" }
        val found = readableDatabase
            .rawQuery("SELECT id,name,cover,rating,year,cat,modified,genre,plot FROM series WHERE id IN ($holes)", ids.toTypedArray())
            .use { it.readSeries() }
        val index = found.associateBy { it.seriesId }
        return ids.mapNotNull { index[it] }
    }

    fun movie(id: String): Movie? = moviesByIds(listOf(id)).firstOrNull()
    fun seriesOne(id: String): Series? = seriesByIds(listOf(id)).firstOrNull()

    private fun titleWhere(category: String?, search: String?): Pair<String, MutableList<String>> {
        val args = mutableListOf<String>()
        val clauses = mutableListOf<String>()
        if (!category.isNullOrEmpty()) { clauses.add("cat = ?"); args.add(category) }
        if (!search.isNullOrEmpty()) { clauses.add("name LIKE ?"); args.add("%$search%") }
        return (if (clauses.isEmpty()) "" else "WHERE " + clauses.joinToString(" AND ")) to args
    }

    // -------------------------------------------------------------- search

    data class SearchResult(val channels: List<Channel>, val movies: List<Movie>, val series: List<Series>)

    fun search(term: String, limit: Int = 40): SearchResult {
        val cleaned = term.trim().replace("\"", " ").replace("*", " ")
        if (cleaned.length < 2) return SearchResult(emptyList(), emptyList(), emptyList())

        val tokens = cleaned.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (tokens.isEmpty()) return SearchResult(emptyList(), emptyList(), emptyList())
        val match = tokens.mapIndexed { i, t ->
            if (i == tokens.lastIndex) "\"$t\"*" else "\"$t\""
        }.joinToString(" ")

        fun ids(kind: String): List<String> =
            readableDatabase.rawQuery(
                """SELECT si.item_id FROM search_fts f
                     JOIN search_item si ON si.id = f.docid
                    WHERE search_fts MATCH ? AND si.kind = ? LIMIT ?""",
                arrayOf(match, kind, limit.toString())
            ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

        val hidden = readableDatabase.rawQuery("SELECT id FROM channel_pref WHERE hidden = 1", null)
            .use { c -> buildSet<String> { while (c.moveToNext()) add(c.getString(0)) } }

        return SearchResult(
            channels = channelsByIds(ids("live")).filter { it.streamId !in hidden },
            movies = moviesByIds(ids("movie")),
            series = seriesByIds(ids("series"))
        )
    }

    /** stream id -> epg id + name, for building the guide map. */
    fun epgMappingRows(): List<Channel> =
        readableDatabase.rawQuery(
            "SELECT id, name, num, logo, cat, epg_id, archive, added, 0 FROM channel", null
        ).use { it.readChannels() }

    // ---------------------------------------------------- channel management

    fun setHidden(ids: List<String>, hidden: Boolean): Int {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val stmt = db.compileStatement(
                "INSERT OR REPLACE INTO channel_pref(id, hidden, sort_order, custom_num, custom_name) " +
                    "VALUES(?, ?, (SELECT sort_order FROM channel_pref WHERE id = ?), " +
                    "(SELECT custom_num FROM channel_pref WHERE id = ?), " +
                    "(SELECT custom_name FROM channel_pref WHERE id = ?))"
            )
            for (id in ids) {
                stmt.bindString(1, id)
                stmt.bindLong(2, if (hidden) 1 else 0)
                stmt.bindString(3, id); stmt.bindString(4, id); stmt.bindString(5, id)
                stmt.executeInsert()
            }
            stmt.close()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return stats().hidden
    }

    fun setOrder(orderedIds: List<String>) = upsertPref(orderedIds.mapIndexed { i, id -> id to i.toLong() }, "sort_order")

    fun setCustomNumber(id: String, num: Int?) =
        upsertPref(listOf(id to num?.toLong()), "custom_num")

    fun renameChannel(id: String, name: String?) {
        val db = writableDatabase
        db.execSQL(
            "INSERT OR REPLACE INTO channel_pref(id, hidden, sort_order, custom_num, custom_name) VALUES(" +
                "?, COALESCE((SELECT hidden FROM channel_pref WHERE id = ?),0), " +
                "(SELECT sort_order FROM channel_pref WHERE id = ?), " +
                "(SELECT custom_num FROM channel_pref WHERE id = ?), ?)",
            arrayOf(id, id, id, id, name)
        )
    }

    private fun upsertPref(pairs: List<Pair<String, Long?>>, column: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for ((id, value) in pairs) {
                db.execSQL(
                    "INSERT OR REPLACE INTO channel_pref(id, hidden, sort_order, custom_num, custom_name) VALUES(" +
                        "?, COALESCE((SELECT hidden FROM channel_pref WHERE id = ?),0), " +
                        (if (column == "sort_order") "?" else "(SELECT sort_order FROM channel_pref WHERE id = ?)") + ", " +
                        (if (column == "custom_num") "?" else "(SELECT custom_num FROM channel_pref WHERE id = ?)") + ", " +
                        "(SELECT custom_name FROM channel_pref WHERE id = ?))",
                    if (column == "sort_order") arrayOf<Any?>(id, id, value, id, id)
                    else arrayOf<Any?>(id, id, id, value, id)
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun resetChannelPrefs() {
        writableDatabase.execSQL("DELETE FROM channel_pref")
    }

    // -------------------------------------------------------------- groups

    data class Group(val id: Long, val name: String, val count: Int)

    fun groups(): List<Group> =
        readableDatabase.rawQuery(
            """SELECT g.id, g.name, COUNT(m.channel_id) FROM channel_group g
                 LEFT JOIN channel_group_member m ON m.group_id = g.id
                GROUP BY g.id, g.name ORDER BY g.ord, g.id""", null
        ).use { c -> buildList { while (c.moveToNext()) add(Group(c.getLong(0), c.getString(1), c.getInt(2))) } }

    fun createGroup(name: String): Long {
        val db = writableDatabase
        val ord = db.rawQuery("SELECT COALESCE(MAX(ord),-1)+1 FROM channel_group", null)
            .use { it.moveToFirst(); it.getInt(0) }
        val stmt = db.compileStatement("INSERT INTO channel_group(name, ord) VALUES(?,?)")
        stmt.bindString(1, name); stmt.bindLong(2, ord.toLong())
        val id = stmt.executeInsert()
        stmt.close()
        return id
    }

    fun renameGroup(id: Long, name: String) =
        writableDatabase.execSQL("UPDATE channel_group SET name = ? WHERE id = ?", arrayOf<Any?>(name, id))

    fun deleteGroup(id: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM channel_group_member WHERE group_id = ?", arrayOf<Any?>(id))
            db.execSQL("DELETE FROM channel_group WHERE id = ?", arrayOf<Any?>(id))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun addToGroup(groupId: Long, ids: List<String>) {
        val db = writableDatabase
        val base = db.rawQuery(
            "SELECT COALESCE(MAX(ord),-1)+1 FROM channel_group_member WHERE group_id = ?",
            arrayOf(groupId.toString())
        ).use { it.moveToFirst(); it.getInt(0) }
        db.beginTransaction()
        try {
            val stmt = db.compileStatement("INSERT OR IGNORE INTO channel_group_member(group_id, channel_id, ord) VALUES(?,?,?)")
            ids.forEachIndexed { i, id ->
                stmt.bindLong(1, groupId); stmt.bindString(2, id); stmt.bindLong(3, (base + i).toLong())
                stmt.executeInsert()
            }
            stmt.close()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun removeFromGroup(groupId: Long, ids: List<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) db.execSQL(
                "DELETE FROM channel_group_member WHERE group_id = ? AND channel_id = ?", arrayOf<Any?>(groupId, id)
            )
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // ------------------------------------------------- upgrade preservation

    private fun readAllPrefs(db: SQLiteDatabase): List<Array<Any?>> = runCatching {
        db.rawQuery("SELECT id, hidden, sort_order, custom_num, custom_name FROM channel_pref", null).use { c ->
            buildList {
                while (c.moveToNext()) add(
                    arrayOf<Any?>(
                        c.getString(0), c.getInt(1),
                        if (c.isNull(2)) null else c.getInt(2),
                        if (c.isNull(3)) null else c.getInt(3),
                        c.getString(4)
                    )
                )
            }
        }
    }.getOrDefault(emptyList())

    private fun readAllGroups(db: SQLiteDatabase): List<Pair<String, List<String>>> = runCatching {
        db.rawQuery("SELECT id, name FROM channel_group", null).use { g ->
            buildList {
                while (g.moveToNext()) {
                    val gid = g.getLong(0)
                    val members = db.rawQuery(
                        "SELECT channel_id FROM channel_group_member WHERE group_id = ? ORDER BY ord",
                        arrayOf(gid.toString())
                    ).use { m -> buildList { while (m.moveToNext()) add(m.getString(0)) } }
                    add(g.getString(1) to members)
                }
            }
        }
    }.getOrDefault(emptyList())

    private fun restorePrefs(
        db: SQLiteDatabase,
        prefs: List<Array<Any?>>,
        groups: List<Pair<String, List<String>>>
    ) {
        for (p in prefs) {
            db.execSQL(
                "INSERT OR REPLACE INTO channel_pref(id,hidden,sort_order,custom_num,custom_name) VALUES(?,?,?,?,?)",
                p
            )
        }
        for ((name, members) in groups) {
            val stmt = db.compileStatement("INSERT INTO channel_group(name, ord) VALUES(?, 0)")
            stmt.bindString(1, name)
            val gid = stmt.executeInsert()
            stmt.close()
            members.forEachIndexed { i, cid ->
                db.execSQL(
                    "INSERT OR IGNORE INTO channel_group_member(group_id, channel_id, ord) VALUES(?,?,?)",
                    arrayOf<Any?>(gid, cid, i)
                )
            }
        }
    }
}

data class CategoryCount(val id: String, val name: String, val count: Int)

// ------------------------------------------------------------- cursor readers

private fun Cursor.readChannels(): List<Channel> = buildList {
    while (moveToNext()) {
        add(
            Channel(
                streamId = getString(0),
                name = getString(1),
                number = getInt(2),
                logo = if (isNull(3)) null else getString(3),
                categoryId = getString(4) ?: "",
                epgChannelId = if (isNull(5)) null else getString(5),
                hasArchive = getInt(6) > 0,
                addedAt = getLong(7),
                hidden = getInt(8) > 0
            )
        )
    }
}

private fun Cursor.readMovies(): List<Movie> = buildList {
    while (moveToNext()) {
        add(
            Movie(
                streamId = getString(0),
                name = getString(1),
                cover = if (isNull(2)) null else getString(2),
                rating = getDouble(3),
                year = if (isNull(4)) null else getString(4),
                categoryId = getString(5) ?: "",
                extension = getString(6) ?: "mp4",
                addedAt = getLong(7),
                genre = if (isNull(8)) null else getString(8),
                plot = if (isNull(9)) null else getString(9)
            )
        )
    }
}

private fun Cursor.readSeries(): List<Series> = buildList {
    while (moveToNext()) {
        add(
            Series(
                seriesId = getString(0),
                name = getString(1),
                cover = if (isNull(2)) null else getString(2),
                rating = getDouble(3),
                year = if (isNull(4)) null else getString(4),
                categoryId = getString(5) ?: "",
                modifiedAt = getLong(6),
                genre = if (isNull(7)) null else getString(7),
                plot = if (isNull(8)) null else getString(8)
            )
        )
    }
}
