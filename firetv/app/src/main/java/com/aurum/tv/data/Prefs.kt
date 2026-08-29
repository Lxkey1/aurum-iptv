package com.aurum.tv.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Settings, favourites and resume points.
 *
 * Deliberately plain SharedPreferences rather than DataStore: this is read on
 * the very first frame of a cold start, and on a Fire TV Stick the synchronous
 * read is measurably quicker than spinning up a coroutine flow.
 */

@Serializable
data class Settings(
    val liveFormat: String = "ts",           // "ts" | "m3u8"
    val userAgent: String = XtreamClient.DEFAULT_USER_AGENT,
    val epgAutoLoad: Boolean = true,
    val epgHoursForward: Int = 48,
    val startScreen: String = "home",
    val preferredQuality: Int = 0,           // 0 = auto, else max height
    val surfaceMode: String = "fit",         // fit | fill | stretch
    val bufferSeconds: Int = 30,
    val showClock: Boolean = true,
    val zapOnDpad: Boolean = true
)

@Serializable
data class Progress(
    val key: String,
    val type: String,                        // movie | episode
    val id: String,
    val seriesId: String? = null,
    val name: String,
    val subtitle: String = "",
    val cover: String? = null,
    val position: Long,
    val duration: Long,
    val extension: String = "mp4",
    val season: Int = 0,
    val episode: Int = 0,
    val updatedAt: Long = System.currentTimeMillis()
)

@Serializable
private data class Favourites(
    val live: List<String> = emptyList(),
    val movie: List<String> = emptyList(),
    val series: List<String> = emptyList()
)

class Prefs(context: Context) {

    private val prefs = context.getSharedPreferences("aurum_prefs", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    companion object {
        private const val K_SETTINGS = "settings"
        private const val K_FAVS = "favourites"
        private const val K_PROGRESS = "progress"
        private const val K_RECENT = "recent_channels"
        private const val MAX_PROGRESS = 60
        private const val MAX_RECENT = 30
    }

    // ------------------------------------------------------------- settings

    var settings: Settings = read(K_SETTINGS, Settings())
        private set

    fun updateSettings(transform: (Settings) -> Settings): Settings {
        settings = transform(settings)
        write(K_SETTINGS, settings)
        return settings
    }

    // ----------------------------------------------------------- favourites

    private var favourites: Favourites = read(K_FAVS, Favourites())

    fun favouriteIds(kind: String): List<String> = when (kind) {
        "live" -> favourites.live
        "movie" -> favourites.movie
        else -> favourites.series
    }

    fun isFavourite(kind: String, id: String): Boolean = favouriteIds(kind).contains(id)

    /** @return true when the item is now a favourite. */
    fun toggleFavourite(kind: String, id: String): Boolean {
        val current = favouriteIds(kind)
        val added = !current.contains(id)
        val next = if (added) listOf(id) + current else current - id
        favourites = when (kind) {
            "live" -> favourites.copy(live = next)
            "movie" -> favourites.copy(movie = next)
            else -> favourites.copy(series = next)
        }
        write(K_FAVS, favourites)
        return added
    }

    // ------------------------------------------------------------- progress

    private var progress: MutableMap<String, Progress> =
        read<Map<String, Progress>>(K_PROGRESS, emptyMap()).toMutableMap()

    fun progressFor(key: String): Progress? = progress[key]

    fun saveProgress(entry: Progress) {
        progress[entry.key] = entry
        if (progress.size > MAX_PROGRESS) {
            val keep = progress.values.sortedByDescending { it.updatedAt }.take(MAX_PROGRESS)
            progress = keep.associateBy { it.key }.toMutableMap()
        }
        write(K_PROGRESS, progress as Map<String, Progress>)
    }

    fun removeProgress(key: String) {
        progress.remove(key)
        write(K_PROGRESS, progress as Map<String, Progress>)
    }

    fun clearProgress() {
        progress.clear()
        write(K_PROGRESS, progress as Map<String, Progress>)
    }

    /** Part-watched items, most recent first. Finished titles are filtered out. */
    fun continueWatching(): List<Progress> = progress.values
        .filter { it.duration > 0 && it.position > 30_000 && it.position < it.duration * 0.96 }
        .sortedByDescending { it.updatedAt }

    // -------------------------------------------------------------- recents

    var recentChannels: List<String> = read(K_RECENT, emptyList())
        private set

    fun pushRecentChannel(id: String) {
        recentChannels = (listOf(id) + (recentChannels - id)).take(MAX_RECENT)
        write(K_RECENT, recentChannels)
    }

    // ----------------------------------------------------------------- i/o

    private inline fun <reified T> read(key: String, fallback: T): T {
        val raw = prefs.getString(key, null) ?: return fallback
        return try {
            json.decodeFromString<T>(raw)
        } catch (_: Exception) {
            fallback
        }
    }

    private inline fun <reified T> write(key: String, value: T) {
        try {
            prefs.edit().putString(key, json.encodeToString(value)).apply()
        } catch (_: Exception) {
            // never let a preference write take the app down
        }
    }
}
