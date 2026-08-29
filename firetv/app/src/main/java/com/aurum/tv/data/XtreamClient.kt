package com.aurum.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class XtreamException(message: String, val kind: Kind = Kind.OTHER) : Exception(message) {
    enum class Kind { CREDENTIALS, NETWORK, TIMEOUT, EXPIRED, BAD_RESPONSE, OTHER }
}

/** Everything a user might paste, reduced to an origin plus any embedded credentials. */
data class ServerInput(val host: String, val username: String, val password: String) {
    companion object {
        fun parse(raw: String): ServerInput {
            var text = raw.trim()
            if (text.isEmpty()) return ServerInput("", "", "")
            if (!text.startsWith("http://", true) && !text.startsWith("https://", true)) {
                text = "http://$text"
            }
            return try {
                val url = java.net.URI(text)
                val query = url.rawQuery.orEmpty()
                    .split('&')
                    .mapNotNull {
                        val i = it.indexOf('=')
                        if (i <= 0) null else
                            java.net.URLDecoder.decode(it.substring(0, i), "UTF-8") to
                                java.net.URLDecoder.decode(it.substring(i + 1), "UTF-8")
                    }
                    .toMap()

                var user = query["username"].orEmpty()
                var pass = query["password"].orEmpty()

                // /live/<user>/<pass>/123.ts style links also carry credentials
                if (user.isEmpty()) {
                    val segs = url.path.orEmpty().split('/').filter { it.isNotEmpty() }
                    val at = segs.indexOfFirst { it.lowercase() in setOf("live", "movie", "series") }
                    if (at >= 0 && segs.size >= at + 3) {
                        user = segs[at + 1]
                        pass = segs[at + 2]
                    }
                }

                val port = if (url.port > 0) ":${url.port}" else ""
                ServerInput("${url.scheme}://${url.host}$port", user, pass)
            } catch (_: Exception) {
                ServerInput(text.trimEnd('/'), "", "")
            }
        }
    }
}

class XtreamClient(
    var host: String,
    var username: String,
    var password: String,
    var userAgent: String = DEFAULT_USER_AGENT
) {
    companion object {
        const val DEFAULT_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"

        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            coerceInputValues = true
        }

        /** Shared so connection pooling and the socket factory are reused by the player. */
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .build()
    }

    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")

    fun apiUrl(vararg params: Pair<String, String?>): String {
        val sb = StringBuilder("$host/player_api.php?username=${enc(username)}&password=${enc(password)}")
        for ((key, value) in params) {
            if (!value.isNullOrEmpty()) sb.append("&").append(key).append("=").append(enc(value))
        }
        return sb.toString()
    }

    fun xmltvUrl(): String = "$host/xmltv.php?username=${enc(username)}&password=${enc(password)}"

    fun liveUrl(streamId: String, format: String): String =
        "$host/live/${enc(username)}/${enc(password)}/$streamId.$format"

    fun movieUrl(streamId: String, extension: String): String =
        "$host/movie/${enc(username)}/${enc(password)}/$streamId.$extension"

    fun episodeUrl(episodeId: String, extension: String): String =
        "$host/series/${enc(username)}/${enc(password)}/$episodeId.$extension"

    /** Timeshift/catch-up. `start` is "YYYY-MM-DD:HH-MM". */
    fun catchupUrl(streamId: String, durationMinutes: Int, start: String): String =
        "$host/streaming/timeshift.php?username=${enc(username)}&password=${enc(password)}" +
            "&stream=$streamId&start=${enc(start)}&duration=$durationMinutes"

    // ------------------------------------------------------------- transport

    suspend fun fetchRaw(url: String): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", userAgent)
            .header("Accept", "application/json, text/plain, */*")
            .build()
        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw XtreamException(
                        when (response.code) {
                            401, 403 -> "Access denied (${response.code}). Check your username and password, or your line may be blocked."
                            404 -> "The server does not have this endpoint (404). Double-check the server address."
                            512, 509 -> "Your provider reports the line is over its connection limit."
                            else -> "The server responded ${response.code}."
                        },
                        if (response.code in listOf(401, 403)) XtreamException.Kind.CREDENTIALS
                        else XtreamException.Kind.BAD_RESPONSE
                    )
                }
                response.body?.string().orEmpty()
            }
        } catch (e: XtreamException) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            throw XtreamException("The server took too long to respond.", XtreamException.Kind.TIMEOUT)
        } catch (e: java.net.UnknownHostException) {
            throw XtreamException("Could not find that server. Check the address and your network.", XtreamException.Kind.NETWORK)
        } catch (e: Exception) {
            throw XtreamException(e.message ?: "Could not reach the server.", XtreamException.Kind.NETWORK)
        }
    }

    private suspend fun call(vararg params: Pair<String, String?>): JsonElement {
        val body = fetchRaw(apiUrl(*params))
        if (body.isBlank()) throw XtreamException("The server returned an empty response.", XtreamException.Kind.BAD_RESPONSE)
        return try {
            json.parseToJsonElement(body)
        } catch (_: Exception) {
            throw XtreamException(
                "The server returned something that is not JSON. This usually means the address is wrong or the panel is blocking this client.",
                XtreamException.Kind.BAD_RESPONSE
            )
        }
    }

    // ----------------------------------------------------------------- calls

    suspend fun authenticate(): Account {
        val root = call().asObject()
            ?: throw XtreamException("Unexpected login response.", XtreamException.Kind.BAD_RESPONSE)
        val user = root["user_info"].asObject()
            ?: throw XtreamException("The server did not return any account details.", XtreamException.Kind.BAD_RESPONSE)

        if (user.string("auth") == "0") {
            throw XtreamException("Incorrect username or password.", XtreamException.Kind.CREDENTIALS)
        }
        val status = user.string("status") ?: "Active"
        if (!status.equals("Active", true) && !status.contains("trial", true)) {
            throw XtreamException("This account is $status.", XtreamException.Kind.EXPIRED)
        }
        return Account.from(root, host)
            ?: throw XtreamException("Incorrect username or password.", XtreamException.Kind.CREDENTIALS)
    }

    suspend fun liveCategories(): List<Category> =
        call("action" to "get_live_categories").asArray().mapNotNull(Category::from)

    suspend fun vodCategories(): List<Category> =
        call("action" to "get_vod_categories").asArray().mapNotNull(Category::from)

    suspend fun seriesCategories(): List<Category> =
        call("action" to "get_series_categories").asArray().mapNotNull(Category::from)

    suspend fun liveStreams(): List<Channel> =
        call("action" to "get_live_streams").asArray()
            .mapIndexedNotNull { index, el -> Channel.from(el, index + 1) }

    suspend fun vodStreams(): List<Movie> =
        call("action" to "get_vod_streams").asArray().mapNotNull(Movie::from)

    suspend fun seriesList(): List<Series> =
        call("action" to "get_series").asArray().mapNotNull(Series::from)

    suspend fun vodInfo(streamId: String): TitleDetail? {
        val root = call("action" to "get_vod_info", "vod_id" to streamId).asObject() ?: return null
        val info = root["info"].asObject() ?: return null
        val data = root["movie_data"].asObject()
        return TitleDetail(
            name = data?.string("name") ?: info.string("name") ?: "",
            plot = info.string("plot", "description"),
            cast = info.string("cast", "actors"),
            director = info.string("director"),
            genre = info.string("genre"),
            releaseDate = info.string("releasedate", "release_date"),
            rating = info.double("rating"),
            durationSeconds = info.int("duration_secs"),
            cover = info.string("movie_image", "cover_big"),
            backdrop = info["backdrop_path"].firstImage(),
            extension = data?.string("container_extension"),
            trailer = info.string("youtube_trailer")
        )
    }

    suspend fun seriesInfo(seriesId: String): SeriesDetail? {
        val root = call("action" to "get_series_info", "series_id" to seriesId).asObject() ?: return null
        val info = root["info"].asObject()

        val seasons = linkedMapOf<Int, List<Episode>>()
        val episodesNode = root["episodes"]
        if (episodesNode is JsonObject) {
            // Normal shape: { "1": [...], "2": [...] }
            for ((key, value) in episodesNode) {
                val seasonNumber = key.toIntOrNull() ?: continue
                val list = value.asArray()
                    .mapNotNull { Episode.from(it, seasonNumber) }
                    .sortedBy { it.episodeNumber }
                if (list.isNotEmpty()) seasons[seasonNumber] = list
            }
        } else {
            // Some panels return a flat array — regroup it ourselves.
            episodesNode.asArray()
                .mapNotNull { Episode.from(it, 1) }
                .groupBy { it.season }
                .forEach { (season, list) -> seasons[season] = list.sortedBy { it.episodeNumber } }
        }

        val detail = TitleDetail(
            name = info?.string("name") ?: "",
            plot = info?.string("plot", "description"),
            cast = info?.string("cast", "actors"),
            director = info?.string("director"),
            genre = info?.string("genre"),
            releaseDate = info?.string("releaseDate", "releasedate"),
            rating = info?.double("rating") ?: 0.0,
            durationSeconds = 0,
            cover = info?.string("cover"),
            backdrop = info?.get("backdrop_path").firstImage(),
            extension = null,
            trailer = info?.string("youtube_trailer")
        )
        return SeriesDetail(detail, seasons.toSortedMap())
    }

    /** Fallback now/next when no XMLTV guide is loaded. Titles are base64. */
    suspend fun shortEpg(streamId: String, limit: Int = 4): List<Programme> {
        val root = call("action" to "get_short_epg", "stream_id" to streamId, "limit" to limit.toString())
            .asObject() ?: return emptyList()
        return root["epg_listings"].asArray().mapNotNull { el ->
            val obj = el.asObject() ?: return@mapNotNull null
            val start = obj.long("start_timestamp") * 1000
            val end = obj.long("stop_timestamp") * 1000
            if (start == 0L || end == 0L) return@mapNotNull null
            Programme(
                start = start,
                end = end,
                title = decodeBase64(obj.string("title")) ?: "No information",
                description = decodeBase64(obj.string("description")),
                category = null
            )
        }
    }

    private fun decodeBase64(value: String?): String? {
        if (value.isNullOrEmpty()) return null
        return try {
            val bytes = android.util.Base64.decode(value, android.util.Base64.DEFAULT)
            val text = String(bytes, Charsets.UTF_8)
            if (text.isBlank()) value else text
        } catch (_: Exception) {
            value
        }
    }
}
