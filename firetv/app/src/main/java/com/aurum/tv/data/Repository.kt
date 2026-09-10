package com.aurum.tv.data

import com.aurum.tv.data.epg.EpgStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Single source of truth.
 *
 * The catalogue lives in SQLite, not in memory — a real line runs to a quarter
 * of a million items and a Fire TV Stick cannot hold that. Screens ask for
 * pages; nothing here caches more than the counts and the category lists.
 */
class Repository(
    val client: XtreamClient,
    val prefs: Prefs,
    val secure: SecureStore,
    val epg: EpgStore,
    val db: CatalogueDb
) {
    var account: Account? = null
        private set

    var stats: CatalogueDb.Stats = CatalogueDb.Stats(0, 0, 0, 0, 0, 0)
        private set

    var liveCategories: List<CategoryCount> = emptyList()
        private set
    var movieCategories: List<CategoryCount> = emptyList()
        private set
    var seriesCategories: List<CategoryCount> = emptyList()
        private set
    var groups: List<CatalogueDb.Group> = emptyList()
        private set

    private val syncLock = Mutex()
    private val detailCache = LinkedHashMap<String, Any>(0, 0.75f, true)

    // ------------------------------------------------------------------ auth

    suspend fun login(server: String, username: String, password: String, remember: Boolean): Account {
        val parsed = ServerInput.parse(server)
        val host = parsed.host.ifEmpty { server.trimEnd('/') }
        val user = username.ifEmpty { parsed.username }
        val pass = password.ifEmpty { parsed.password }

        if (host.isEmpty()) throw XtreamException("Enter your provider's server address.")
        if (user.isEmpty() || pass.isEmpty()) throw XtreamException("Enter both a username and a password.")

        client.host = host
        client.username = user
        client.password = pass
        client.userAgent = prefs.settings.userAgent

        val result = client.authenticate()
        account = result
        if (remember) secure.save(host, user, pass)
        return result
    }

    suspend fun restore(): Account? {
        val saved = secure.load() ?: return null
        client.host = saved.first
        client.username = saved.second
        client.password = saved.third
        client.userAgent = prefs.settings.userAgent
        val result = client.authenticate()
        account = result
        return result
    }

    fun signOut() {
        secure.clear()
        account = null
        detailCache.clear()
        epg.clear()
        db.replaceAll { }          // empty the catalogue
        db.resetChannelPrefs()
        refreshLocalState()
    }

    // ------------------------------------------------------------- catalogue

    /** Streams the whole catalogue from the provider into SQLite. */
    suspend fun sync(
        force: Boolean = false,
        onProgress: (StreamingIngest.Progress) -> Unit = {}
    ): CatalogueDb.Stats = syncLock.withLock {
        if (!force && !db.stats().isEmpty) {
            refreshLocalState()
            return@withLock stats
        }
        StreamingIngest.syncAll(client, db, onProgress)
        refreshLocalState()
        if (epg.isReady) epg.mapChannels(db.epgMappingRows())
        stats
    }

    fun refreshLocalState() {
        stats = db.stats()
        liveCategories = db.categories("live")
        movieCategories = db.categories("movie")
        seriesCategories = db.categories("series")
        groups = db.groups()
    }

    val isPopulated: Boolean get() = !stats.isEmpty

    // ---------------------------------------------------------------- paging

    suspend fun channels(
        category: String? = null,
        search: String? = null,
        limit: Int = 100,
        offset: Int = 0,
        includeHidden: Boolean = false,
        groupId: Long? = null
    ): List<Channel> = withContext(Dispatchers.IO) {
        db.channels(category, search, limit, offset, includeHidden, groupId)
    }

    suspend fun channelCount(
        category: String? = null, search: String? = null,
        includeHidden: Boolean = false, groupId: Long? = null
    ): Int = withContext(Dispatchers.IO) { db.channelCount(category, search, includeHidden, groupId) }

    suspend fun channelIds(category: String? = null, groupId: Long? = null): List<String> =
        withContext(Dispatchers.IO) { db.channelIds(category, groupId) }

    suspend fun channelsByIds(ids: List<String>): List<Channel> =
        withContext(Dispatchers.IO) { db.channelsByIds(ids) }

    suspend fun channel(id: String): Channel? = withContext(Dispatchers.IO) { db.channel(id) }

    suspend fun movies(
        category: String? = null, search: String? = null,
        sort: String = "added", limit: Int = 60, offset: Int = 0
    ): List<Movie> = withContext(Dispatchers.IO) { db.movies(category, search, sort, limit, offset) }

    suspend fun seriesPage(
        category: String? = null, search: String? = null,
        sort: String = "added", limit: Int = 60, offset: Int = 0
    ): List<Series> = withContext(Dispatchers.IO) { db.series(category, search, sort, limit, offset) }

    suspend fun titleCount(kind: String, category: String? = null, search: String? = null): Int =
        withContext(Dispatchers.IO) { db.titleCount(kind, category, search) }

    suspend fun moviesByIds(ids: List<String>): List<Movie> =
        withContext(Dispatchers.IO) { db.moviesByIds(ids) }

    suspend fun seriesByIds(ids: List<String>): List<Series> =
        withContext(Dispatchers.IO) { db.seriesByIds(ids) }

    suspend fun search(term: String, limit: Int = 40): CatalogueDb.SearchResult =
        withContext(Dispatchers.IO) { db.search(term, limit) }

    suspend fun archiveChannels(limit: Int = 500): List<Channel> =
        withContext(Dispatchers.IO) { db.archiveChannels(limit) }

    // ---------------------------------------------------- channel management

    suspend fun setHidden(ids: List<String>, hidden: Boolean) = withContext(Dispatchers.IO) {
        db.setHidden(ids, hidden)
        refreshLocalState()
    }

    suspend fun renameChannel(id: String, name: String?) = withContext(Dispatchers.IO) {
        db.renameChannel(id, name)
    }

    suspend fun setChannelNumber(id: String, num: Int?) = withContext(Dispatchers.IO) {
        db.setCustomNumber(id, num)
    }

    suspend fun setChannelOrder(ids: List<String>) = withContext(Dispatchers.IO) { db.setOrder(ids) }

    suspend fun resetChannelPrefs() = withContext(Dispatchers.IO) {
        db.resetChannelPrefs()
        refreshLocalState()
    }

    suspend fun createGroup(name: String): Long = withContext(Dispatchers.IO) {
        val id = db.createGroup(name)
        refreshLocalState()
        id
    }

    suspend fun deleteGroup(id: Long) = withContext(Dispatchers.IO) {
        db.deleteGroup(id)
        refreshLocalState()
    }

    suspend fun addToGroup(groupId: Long, ids: List<String>) = withContext(Dispatchers.IO) {
        db.addToGroup(groupId, ids)
        refreshLocalState()
    }

    suspend fun removeFromGroup(groupId: Long, ids: List<String>) = withContext(Dispatchers.IO) {
        db.removeFromGroup(groupId, ids)
        refreshLocalState()
    }

    // ---------------------------------------------------------------- detail

    suspend fun movieDetail(streamId: String): TitleDetail? {
        (detailCache["movie:$streamId"] as? TitleDetail)?.let { return it }
        val detail = runCatching { client.vodInfo(streamId) }.getOrNull() ?: return null
        cacheDetail("movie:$streamId", detail)
        return detail
    }

    suspend fun seriesDetail(seriesId: String): SeriesDetail? {
        (detailCache["series:$seriesId"] as? SeriesDetail)?.let { return it }
        val detail = runCatching { client.seriesInfo(seriesId) }.getOrNull() ?: return null
        cacheDetail("series:$seriesId", detail)
        return detail
    }

    private fun cacheDetail(key: String, value: Any) {
        detailCache[key] = value
        while (detailCache.size > 30) {
            val oldest = detailCache.keys.firstOrNull() ?: break
            detailCache.remove(oldest)
        }
    }

    // ------------------------------------------------------------- playback

    fun liveUrl(channel: Channel): String =
        client.liveUrl(channel.streamId, prefs.settings.liveFormat)

    fun movieUrl(movie: Movie, extension: String? = null): String =
        client.movieUrl(movie.streamId, extension ?: movie.extension)

    fun episodeUrl(episode: Episode): String =
        client.episodeUrl(episode.id, episode.extension)

    /** Catch-up / timeshift for a past programme on an archive-capable channel. */
    fun catchupUrl(streamId: String, startMillis: Long, durationMinutes: Int): String =
        client.catchupUrl(streamId, durationMinutes, com.aurum.tv.util.catchupStamp(startMillis))

    companion object {
        const val ALL = CatalogueDb.ALL
        const val FAVOURITES = CatalogueDb.FAVOURITES
        const val RECENT = CatalogueDb.RECENT
    }
}
