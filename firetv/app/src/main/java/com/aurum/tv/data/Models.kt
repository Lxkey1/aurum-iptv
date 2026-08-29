package com.aurum.tv.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Xtream panels are wildly inconsistent: the same field arrives as a number on
 * one server and a quoted string on the next, `null` becomes the literal text
 * "null", and empty values show up as "", "0" or omitted entirely. Rather than
 * fight that with strict serializers, everything is read defensively out of a
 * JsonObject.
 */

// ------------------------------------------------------------------ helpers

fun JsonElement?.str(): String? {
    if (this == null || this is JsonNull) return null
    val prim = this as? JsonPrimitive ?: return null
    val value = prim.content
    return if (value.isEmpty() || value == "null" || value == "N/A") null else value
}

fun JsonObject.string(vararg keys: String): String? {
    for (key in keys) this[key].str()?.let { return it }
    return null
}

fun JsonObject.long(vararg keys: String): Long =
    string(*keys)?.trim()?.toDoubleOrNull()?.toLong() ?: 0L

fun JsonObject.double(vararg keys: String): Double =
    string(*keys)?.trim()?.toDoubleOrNull() ?: 0.0

fun JsonObject.int(vararg keys: String): Int = long(*keys).toInt()

/** Some panels return a bare object where a list is expected, and vice versa. */
fun JsonElement?.asArray(): List<JsonElement> = when (this) {
    is JsonArray -> this
    is JsonObject -> this.values.toList()
    else -> emptyList()
}

fun JsonElement?.asObject(): JsonObject? = this as? JsonObject

/** Backdrops arrive as a string, a list of strings, or nothing. */
fun JsonElement?.firstImage(): String? = when (this) {
    is JsonArray -> this.firstOrNull().str()
    is JsonPrimitive -> this.str()
    else -> null
}

// ------------------------------------------------------------------- models

data class Account(
    val username: String,
    val status: String,
    val expiresAt: Long,          // epoch seconds, 0 = unlimited
    val isTrial: Boolean,
    val activeConnections: Int,
    val maxConnections: Int,
    val host: String,
    val timezone: String
) {
    companion object {
        fun from(root: JsonObject, host: String): Account? {
            val user = root["user_info"].asObject() ?: return null
            if (user.string("auth") == "0") return null
            val server = root["server_info"].asObject()
            return Account(
                username = user.string("username") ?: "",
                status = user.string("status") ?: "Unknown",
                expiresAt = user.long("exp_date"),
                isTrial = user.string("is_trial") == "1",
                activeConnections = user.int("active_cons"),
                maxConnections = user.int("max_connections"),
                host = host,
                timezone = server?.string("timezone") ?: ""
            )
        }
    }
}

data class Category(val id: String, val name: String) {
    companion object {
        fun from(el: JsonElement): Category? {
            val obj = el.asObject() ?: return null
            val id = obj.string("category_id") ?: return null
            return Category(id, obj.string("category_name") ?: "Unnamed")
        }
    }
}

data class Channel(
    val streamId: String,
    val name: String,
    val number: Int,
    val logo: String?,
    val categoryId: String,
    val epgChannelId: String?,
    val hasArchive: Boolean,
    val addedAt: Long
) {
    companion object {
        fun from(el: JsonElement, fallbackNumber: Int): Channel? {
            val obj = el.asObject() ?: return null
            val id = obj.string("stream_id") ?: return null
            return Channel(
                streamId = id,
                name = obj.string("name") ?: "Channel $id",
                number = obj.string("num")?.toIntOrNull() ?: fallbackNumber,
                logo = obj.string("stream_icon"),
                categoryId = obj.string("category_id") ?: "",
                epgChannelId = obj.string("epg_channel_id"),
                hasArchive = obj.int("tv_archive") > 0,
                addedAt = obj.long("added")
            )
        }
    }
}

data class Movie(
    val streamId: String,
    val name: String,
    val cover: String?,
    val rating: Double,
    val year: String?,
    val categoryId: String,
    val extension: String,
    val addedAt: Long,
    val plot: String? = null,
    val genre: String? = null
) {
    companion object {
        fun from(el: JsonElement): Movie? {
            val obj = el.asObject() ?: return null
            val id = obj.string("stream_id") ?: return null
            return Movie(
                streamId = id,
                name = obj.string("name", "title") ?: "Untitled",
                cover = obj.string("stream_icon", "cover", "movie_image"),
                rating = obj.double("rating"),
                year = obj.string("year", "releasedate")?.take(4),
                categoryId = obj.string("category_id") ?: "",
                extension = obj.string("container_extension") ?: "mp4",
                addedAt = obj.long("added"),
                plot = obj.string("plot", "description"),
                genre = obj.string("genre")
            )
        }
    }
}

data class Series(
    val seriesId: String,
    val name: String,
    val cover: String?,
    val rating: Double,
    val year: String?,
    val categoryId: String,
    val modifiedAt: Long,
    val plot: String? = null,
    val genre: String? = null
) {
    companion object {
        fun from(el: JsonElement): Series? {
            val obj = el.asObject() ?: return null
            val id = obj.string("series_id") ?: return null
            return Series(
                seriesId = id,
                name = obj.string("name", "title") ?: "Untitled",
                cover = obj.string("cover", "stream_icon"),
                rating = obj.double("rating"),
                year = obj.string("releaseDate", "releasedate", "year")?.take(4),
                categoryId = obj.string("category_id") ?: "",
                modifiedAt = maxOf(obj.long("last_modified"), obj.long("added")),
                plot = obj.string("plot"),
                genre = obj.string("genre")
            )
        }
    }
}

/** Extra metadata from get_vod_info / get_series_info. */
data class TitleDetail(
    val name: String,
    val plot: String?,
    val cast: String?,
    val director: String?,
    val genre: String?,
    val releaseDate: String?,
    val rating: Double,
    val durationSeconds: Int,
    val cover: String?,
    val backdrop: String?,
    val extension: String?,
    val trailer: String?
)

data class Episode(
    val id: String,
    val title: String,
    val season: Int,
    val episodeNumber: Int,
    val extension: String,
    val plot: String?,
    val still: String?,
    val durationSeconds: Int,
    val rating: Double,
    val airDate: String?
) {
    companion object {
        fun from(el: JsonElement, seasonHint: Int): Episode? {
            val obj = el.asObject() ?: return null
            val id = obj.string("id") ?: return null
            val info = obj["info"].asObject()
            val num = obj.string("episode_num")?.toIntOrNull() ?: 0
            return Episode(
                id = id,
                title = obj.string("title") ?: info?.string("name") ?: "Episode $num",
                season = obj.string("season")?.toIntOrNull() ?: seasonHint,
                episodeNumber = num,
                extension = obj.string("container_extension") ?: "mp4",
                plot = info?.string("plot", "description"),
                still = info?.string("movie_image", "cover_big"),
                durationSeconds = info?.int("duration_secs") ?: 0,
                rating = info?.double("rating") ?: 0.0,
                airDate = info?.string("releasedate", "air_date", "release_date")
            )
        }
    }
}

data class SeriesDetail(
    val detail: TitleDetail,
    /** Season number -> episodes, in broadcast order. */
    val seasons: Map<Int, List<Episode>>
)

/** One programme in the guide. */
data class Programme(
    val start: Long,
    val end: Long,
    val title: String,
    val description: String?,
    val category: String?
)

data class NowNext(val now: Programme?, val next: Programme?)
