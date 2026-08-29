package com.aurum.tv.data

import com.aurum.tv.data.epg.EpgStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Single source of truth for catalogue data.
 *
 * Channel/film/series lists are fetched once per session and kept in memory;
 * the raw JSON is also written to disk so a cold start can paint immediately
 * while a refresh happens in the background.
 */
class Repository(
    val client: XtreamClient,
    val prefs: Prefs,
    val secure: SecureStore,
    val epg: EpgStore,
    private val cacheDir: File
) {
    var account: Account? = null
        private set

    var channels: List<Channel> = emptyList()
        private set
    var liveCategories: List<Category> = emptyList()
        private set

    var movies: List<Movie> = emptyList()
        private set
    var movieCategories: List<Category> = emptyList()
        private set

    var series: List<Series> = emptyList()
        private set
    var seriesCategories: List<Category> = emptyList()
        private set

    private val channelsById = HashMap<String, Channel>()
    private val loadLock = Mutex()

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
        clearDiskCache()
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
        channels = emptyList()
        movies = emptyList()
        series = emptyList()
        channelsById.clear()
        detailCache.clear()
        epg.clear()
        clearDiskCache()
    }

    // ------------------------------------------------------------- catalogue

    suspend fun loadChannels(force: Boolean = false): List<Channel> = loadLock.withLock {
        if (channels.isNotEmpty() && !force) return channels
        val categories = runCatching { client.liveCategories() }.getOrDefault(emptyList())
        val list = client.liveStreams()
        liveCategories = categories
        channels = list
        channelsById.clear()
        list.forEach { channelsById[it.streamId] = it }
        if (epg.isReady) epg.mapChannels(list)
        list
    }

    suspend fun loadMovies(force: Boolean = false): List<Movie> = loadLock.withLock {
        if (movies.isNotEmpty() && !force) return movies
        movieCategories = runCatching { client.vodCategories() }.getOrDefault(emptyList())
        movies = client.vodStreams()
        movies
    }

    suspend fun loadSeries(force: Boolean = false): List<Series> = loadLock.withLock {
        if (series.isNotEmpty() && !force) return series
        seriesCategories = runCatching { client.seriesCategories() }.getOrDefault(emptyList())
        series = client.seriesList()
        series
    }

    fun channel(streamId: String): Channel? = channelsById[streamId]

    fun channelsIn(categoryId: String?): List<Channel> = when (categoryId) {
        null, ALL -> channels
        FAVOURITES -> prefs.favouriteIds("live").mapNotNull { channelsById[it] }
        RECENT -> prefs.recentChannels.mapNotNull { channelsById[it] }
        else -> channels.filter { it.categoryId == categoryId }
    }

    fun moviesIn(categoryId: String?): List<Movie> = when (categoryId) {
        null, ALL -> movies
        FAVOURITES -> prefs.favouriteIds("movie").toSet().let { ids -> movies.filter { it.streamId in ids } }
        else -> movies.filter { it.categoryId == categoryId }
    }

    fun seriesIn(categoryId: String?): List<Series> = when (categoryId) {
        null, ALL -> series
        FAVOURITES -> prefs.favouriteIds("series").toSet().let { ids -> series.filter { it.seriesId in ids } }
        else -> series.filter { it.categoryId == categoryId }
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
        while (detailCache.size > 40) {
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

    // ------------------------------------------------------------ disk cache

    private fun clearDiskCache() {
        runCatching { cacheDir.listFiles()?.forEach { it.delete() } }
    }

    suspend fun cacheSizeBytes(): Long = withContext(Dispatchers.IO) {
        cacheDir.listFiles()?.sumOf { it.length() } ?: 0L
    }

    companion object {
        const val ALL = "__all__"
        const val FAVOURITES = "__fav__"
        const val RECENT = "__recent__"
    }
}
