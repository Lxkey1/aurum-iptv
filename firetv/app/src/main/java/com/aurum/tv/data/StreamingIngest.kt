package com.aurum.tv.data

import android.util.JsonReader
import android.util.JsonToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.InputStreamReader

/**
 * Streams the provider's catalogue straight from the socket into SQLite.
 *
 * The obvious implementation — fetch the JSON, parse it into a List, insert the
 * List — briefly holds the entire document *and* the parsed objects in memory.
 * On this line that is a 60 MB document expanding to ~150 MB of objects, on a
 * device that may only allow 192 MB. android.util.JsonReader pulls one object
 * at a time so peak memory stays flat regardless of how big the line is.
 */
object StreamingIngest {

    data class Progress(val text: String, val percent: Int)

    suspend fun syncAll(
        client: XtreamClient,
        db: CatalogueDb,
        onProgress: (Progress) -> Unit
    ): CatalogueDb.Stats = withContext(Dispatchers.IO) {

        // Categories are small; fetch them up front so the ingest can be one pass.
        onProgress(Progress("Fetching categories…", 2))
        val liveCats = runCatching { client.liveCategories() }.getOrDefault(emptyList())
        val vodCats = runCatching { client.vodCategories() }.getOrDefault(emptyList())
        val seriesCats = runCatching { client.seriesCategories() }.getOrDefault(emptyList())

        db.replaceAll { ingest ->
            liveCats.forEachIndexed { i, c -> ingest.category("live", c.id, c.name, i) }
            vodCats.forEachIndexed { i, c -> ingest.category("movie", c.id, c.name, i) }
            seriesCats.forEachIndexed { i, c -> ingest.category("series", c.id, c.name, i) }

            onProgress(Progress("Loading channels…", 8))
            streamArray(client, client.apiUrl("action" to "get_live_streams")) { reader, index ->
                readChannel(reader, index)?.let(ingest::channel)
                if (ingest.channels % 2000 == 0) {
                    onProgress(Progress("Channels — ${ingest.channels}", 8 + (ingest.channels / 3000).coerceAtMost(17)))
                }
            }

            onProgress(Progress("Loading films…", 28))
            streamArray(client, client.apiUrl("action" to "get_vod_streams")) { reader, _ ->
                readMovie(reader)?.let(ingest::movie)
                if (ingest.movies % 5000 == 0) {
                    onProgress(Progress("Films — ${ingest.movies}", 28 + (ingest.movies / 4000).coerceAtMost(40)))
                }
            }

            onProgress(Progress("Loading box sets…", 72))
            streamArray(client, client.apiUrl("action" to "get_series")) { reader, _ ->
                readSeries(reader)?.let(ingest::series)
                if (ingest.seriesCount % 2000 == 0) {
                    onProgress(Progress("Box sets — ${ingest.seriesCount}", 72 + (ingest.seriesCount / 2000).coerceAtMost(20)))
                }
            }

            onProgress(Progress("Indexing…", 95))
        }

        onProgress(Progress("Ready", 100))
        db.stats()
    }

    /**
     * Opens [url] and hands each element of the top-level array to [onItem].
     * Nothing larger than one element is ever held.
     */
    private inline fun streamArray(
        client: XtreamClient,
        url: String,
        onItem: (JsonReader, Int) -> Unit
    ) {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", client.userAgent)
            .header("Accept", "application/json")
            .build()

        XtreamClient.http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw XtreamException("The server responded ${response.code}.")
            val body = response.body ?: throw XtreamException("The server sent no data.")

            JsonReader(InputStreamReader(body.byteStream(), Charsets.UTF_8)).use { reader ->
                if (reader.peek() != JsonToken.BEGIN_ARRAY) {
                    // Some panels answer with an object when a line has no content.
                    reader.skipValue()
                    return
                }
                reader.beginArray()
                var index = 0
                while (reader.hasNext()) {
                    onItem(reader, index)
                    index++
                }
                reader.endArray()
            }
        }
    }

    // --------------------------------------------------------- element readers

    private fun readChannel(reader: JsonReader, index: Int): Channel? {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) { reader.skipValue(); return null }
        var id: String? = null
        var name: String? = null
        var num: Int? = null
        var logo: String? = null
        var cat = ""
        var epg: String? = null
        var archive = false
        var added = 0L

        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "stream_id" -> id = reader.nextStringLenient()
                "name" -> name = reader.nextStringLenient()
                "num" -> num = reader.nextStringLenient()?.toIntOrNull()
                "stream_icon" -> logo = reader.nextStringLenient()
                "category_id" -> cat = reader.nextStringLenient() ?: ""
                "epg_channel_id" -> epg = reader.nextStringLenient()
                "tv_archive" -> archive = (reader.nextStringLenient()?.toIntOrNull() ?: 0) > 0
                "added" -> added = reader.nextStringLenient()?.toLongOrNull() ?: 0L
                else -> reader.skipValue()
            }
        }
        reader.endObject()

        val streamId = id ?: return null
        return Channel(
            streamId = streamId,
            name = name?.takeIf { it.isNotBlank() } ?: "Channel $streamId",
            number = num ?: (index + 1),
            logo = logo?.takeIf { it.isNotBlank() },
            categoryId = cat,
            epgChannelId = epg?.takeIf { it.isNotBlank() },
            hasArchive = archive,
            addedAt = added
        )
    }

    private fun readMovie(reader: JsonReader): Movie? {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) { reader.skipValue(); return null }
        var id: String? = null
        var name: String? = null
        var cover: String? = null
        var rating = 0.0
        var year: String? = null
        var cat = ""
        var ext = "mp4"
        var added = 0L
        var genre: String? = null
        var plot: String? = null

        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "stream_id" -> id = reader.nextStringLenient()
                "name", "title" -> if (name == null) name = reader.nextStringLenient() else reader.skipValue()
                "stream_icon", "cover", "movie_image" -> if (cover == null) cover = reader.nextStringLenient() else reader.skipValue()
                "rating" -> rating = reader.nextStringLenient()?.toDoubleOrNull() ?: 0.0
                "year" -> year = reader.nextStringLenient()?.take(4)
                "releasedate" -> if (year == null) year = reader.nextStringLenient()?.take(4) else reader.skipValue()
                "category_id" -> cat = reader.nextStringLenient() ?: ""
                "container_extension" -> ext = reader.nextStringLenient() ?: "mp4"
                "added" -> added = reader.nextStringLenient()?.toLongOrNull() ?: 0L
                "genre" -> genre = reader.nextStringLenient()
                "plot", "description" -> if (plot == null) plot = reader.nextStringLenient() else reader.skipValue()
                else -> reader.skipValue()
            }
        }
        reader.endObject()

        val streamId = id ?: return null
        return Movie(
            streamId = streamId,
            name = name?.takeIf { it.isNotBlank() } ?: "Untitled",
            cover = cover?.takeIf { it.isNotBlank() },
            rating = rating,
            year = year?.takeIf { it.isNotBlank() },
            categoryId = cat,
            extension = ext,
            addedAt = added,
            genre = genre,
            plot = plot
        )
    }

    private fun readSeries(reader: JsonReader): Series? {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) { reader.skipValue(); return null }
        var id: String? = null
        var name: String? = null
        var cover: String? = null
        var rating = 0.0
        var year: String? = null
        var cat = ""
        var modified = 0L
        var genre: String? = null
        var plot: String? = null

        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "series_id" -> id = reader.nextStringLenient()
                "name", "title" -> if (name == null) name = reader.nextStringLenient() else reader.skipValue()
                "cover", "stream_icon" -> if (cover == null) cover = reader.nextStringLenient() else reader.skipValue()
                "rating" -> rating = reader.nextStringLenient()?.toDoubleOrNull() ?: 0.0
                "releaseDate", "releasedate", "year" -> if (year == null) year = reader.nextStringLenient()?.take(4) else reader.skipValue()
                "category_id" -> cat = reader.nextStringLenient() ?: ""
                "last_modified", "added" -> {
                    val v = reader.nextStringLenient()?.toLongOrNull() ?: 0L
                    if (v > modified) modified = v
                }
                "genre" -> genre = reader.nextStringLenient()
                "plot" -> plot = reader.nextStringLenient()
                else -> reader.skipValue()
            }
        }
        reader.endObject()

        val seriesId = id ?: return null
        return Series(
            seriesId = seriesId,
            name = name?.takeIf { it.isNotBlank() } ?: "Untitled",
            cover = cover?.takeIf { it.isNotBlank() },
            rating = rating,
            year = year?.takeIf { it.isNotBlank() },
            categoryId = cat,
            modifiedAt = modified,
            genre = genre,
            plot = plot
        )
    }

    /**
     * Reads whatever is next as a String.
     *
     * Xtream panels type these fields inconsistently — `stream_id` may be 1234
     * or "1234", `rating` may be 7.4, "7.4" or "", and any of them may be null.
     */
    private fun JsonReader.nextStringLenient(): String? = when (peek()) {
        JsonToken.STRING -> nextString().takeIf { it.isNotBlank() && it != "null" && it != "N/A" }
        JsonToken.NUMBER -> nextString()
        JsonToken.BOOLEAN -> nextBoolean().toString()
        JsonToken.NULL -> { nextNull(); null }
        else -> { skipValue(); null }
    }
}
