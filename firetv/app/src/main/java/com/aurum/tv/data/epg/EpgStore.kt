package com.aurum.tv.data.epg

import android.util.Xml
import com.aurum.tv.data.Channel
import com.aurum.tv.data.Programme
import com.aurum.tv.data.NowNext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * Downloads and indexes the provider's XMLTV guide.
 *
 * A full guide is routinely 50-200 MB of XML and a Fire TV Stick has very
 * little headroom, so this streams straight from the socket through a pull
 * parser and keeps only what falls inside the requested time window. Nothing is
 * ever held as one big string.
 */
class EpgStore(private val cacheDir: File) {

    /** xmltv channel id -> programmes, sorted by start time. */
    @Volatile
    private var programmes: Map<String, List<Programme>> = emptyMap()

    /** normalised display name -> xmltv channel id, for fuzzy matching. */
    @Volatile
    private var displayNames: Map<String, String> = emptyMap()

    /** provider stream id -> xmltv channel id. */
    @Volatile
    private var channelMap: Map<String, String> = emptyMap()

    @Volatile
    var stats: Stats? = null
        private set

    val isReady: Boolean get() = programmes.isNotEmpty()
    val matchedCount: Int get() = channelMap.size

    data class Stats(
        val channelsInGuide: Int,
        val channelsWithData: Int,
        val programmeCount: Int,
        val windowStart: Long,
        val windowEnd: Long,
        val builtAt: Long
    )

    data class Phase(val text: String, val percent: Int)

    // --------------------------------------------------------------- refresh

    suspend fun refresh(
        url: String,
        userAgent: String,
        hoursBack: Int = 4,
        hoursForward: Int = 48,
        onProgress: (Phase) -> Unit
    ): Result<Stats> = withContext(Dispatchers.IO) {
        try {
            onProgress(Phase("Contacting guide server…", 2))

            val now = System.currentTimeMillis()
            val from = now - hoursBack * 3_600_000L
            val to = now + hoursForward * 3_600_000L

            val client = OkHttpClient.Builder()
                .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(180, java.util.concurrent.TimeUnit.SECONDS)
                .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build()

            val request = Request.Builder()
                .url(url)
                .header("User-Agent", userAgent)
                .header("Accept-Encoding", "gzip")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception("The guide server responded ${response.code}.")
                    )
                }
                val body = response.body
                    ?: return@withContext Result.failure(Exception("The guide server sent no data."))

                val contentEncoding = response.header("Content-Encoding").orEmpty()
                var stream: InputStream = CountingStream(BufferedInputStream(body.byteStream(), 64 * 1024)) { read ->
                    onProgress(Phase("Reading guide — ${formatBytes(read)}", (5 + (read / 1_500_000)).toInt().coerceAtMost(70)))
                }
                if (contentEncoding.contains("gzip", true) || url.endsWith(".gz")) {
                    stream = GZIPInputStream(stream, 32 * 1024)
                }
                // Some panels serve gzip without saying so.
                stream = maybeGunzip(stream)

                val result = parse(stream, from, to, onProgress)
                programmes = result.first
                displayNames = result.second
                channelMap = emptyMap()

                val built = Stats(
                    channelsInGuide = result.second.size,
                    channelsWithData = result.first.size,
                    programmeCount = result.first.values.sumOf { it.size },
                    windowStart = from,
                    windowEnd = to,
                    builtAt = System.currentTimeMillis()
                )
                stats = built
                onProgress(Phase("Guide ready", 100))
                Result.success(built)
            }
        } catch (e: OutOfMemoryError) {
            clear()
            Result.failure(Exception("This guide is too large for the device's memory. Reduce the guide window in Settings and try again."))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun maybeGunzip(stream: InputStream): InputStream {
        val buffered = if (stream.markSupported()) stream else BufferedInputStream(stream, 32 * 1024)
        buffered.mark(2)
        val b1 = buffered.read()
        val b2 = buffered.read()
        buffered.reset()
        return if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buffered, 32 * 1024) else buffered
    }

    // ---------------------------------------------------------------- parse

    private fun parse(
        stream: InputStream,
        from: Long,
        to: Long,
        onProgress: (Phase) -> Unit
    ): Pair<Map<String, List<Programme>>, Map<String, String>> {

        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(stream, null)

        val byChannel = HashMap<String, MutableList<Programme>>(4096)
        val names = HashMap<String, String>(4096)

        var kept = 0
        var seen = 0

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                when (parser.name) {
                    "channel" -> readChannel(parser, names)
                    "programme" -> {
                        seen++
                        readProgramme(parser, from, to)?.let { (channelId, programme) ->
                            byChannel.getOrPut(channelId) { ArrayList(64) }.add(programme)
                            kept++
                        }
                        if (seen % 20_000 == 0) {
                            onProgress(Phase("Indexing programmes — ${kept.formatted()} kept", (70 + kept / 12_000).coerceAtMost(97)))
                        }
                    }
                }
            }
            event = parser.next()
        }

        val sorted = byChannel.mapValues { (_, list) -> list.sortedBy { it.start } }
        return sorted to names
    }

    private fun readChannel(parser: XmlPullParser, names: MutableMap<String, String>) {
        val id = parser.getAttributeValue(null, "id") ?: return
        var displayName: String? = null
        var depth = 1
        while (depth > 0) {
            when (parser.next()) {
                XmlPullParser.START_TAG -> {
                    depth++
                    if (parser.name == "display-name" && displayName == null) {
                        displayName = parser.nextText()
                        depth--
                    }
                }
                XmlPullParser.END_TAG -> depth--
                XmlPullParser.END_DOCUMENT -> return
            }
        }
        val key = normalise(displayName ?: id)
        if (key.isNotEmpty()) names.putIfAbsentCompat(key, id)
    }

    private fun readProgramme(parser: XmlPullParser, from: Long, to: Long): Pair<String, Programme>? {
        val channelId = parser.getAttributeValue(null, "channel")
        val start = parseTime(parser.getAttributeValue(null, "start"))
        val stop = parseTime(parser.getAttributeValue(null, "stop"))

        var title: String? = null
        var desc: String? = null
        var category: String? = null

        var depth = 1
        while (depth > 0) {
            when (parser.next()) {
                XmlPullParser.START_TAG -> {
                    val tag = parser.name
                    if (tag == "title" && title == null) {
                        title = parser.nextText()
                    } else if (tag == "desc" && desc == null) {
                        desc = parser.nextText()
                    } else if (tag == "category" && category == null) {
                        category = parser.nextText()
                    } else {
                        depth++
                    }
                }
                XmlPullParser.END_TAG -> depth--
                XmlPullParser.END_DOCUMENT -> depth = 0
            }
        }

        if (channelId.isNullOrEmpty() || start == 0L || stop == 0L) return null
        if (stop <= from || start >= to) return null

        return channelId to Programme(
            start = start,
            end = stop,
            title = title?.trim().takeUnless { it.isNullOrEmpty() } ?: "No information",
            description = desc?.trim()?.take(700).takeUnless { it.isNullOrEmpty() },
            category = category?.trim().takeUnless { it.isNullOrEmpty() }
        )
    }

    /** "20240131203000 +0100" -> epoch millis. */
    private fun parseTime(value: String?): Long {
        if (value == null || value.length < 14) return 0
        return try {
            val year = value.substring(0, 4).toInt()
            val month = value.substring(4, 6).toInt()
            val day = value.substring(6, 8).toInt()
            val hour = value.substring(8, 10).toInt()
            val minute = value.substring(10, 12).toInt()
            val second = value.substring(12, 14).toInt()

            val calendar = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
            calendar.clear()
            calendar.set(year, month - 1, day, hour, minute, second)
            var millis = calendar.timeInMillis

            val zone = value.substring(14).trim()
            if (zone.length >= 5 && (zone[0] == '+' || zone[0] == '-')) {
                val offsetHours = zone.substring(1, 3).toIntOrNull() ?: 0
                val offsetMinutes = zone.substring(3, 5).toIntOrNull() ?: 0
                val sign = if (zone[0] == '-') 1 else -1
                millis += sign * (offsetHours * 60 + offsetMinutes) * 60_000L
            }
            millis
        } catch (_: Exception) {
            0
        }
    }

    // --------------------------------------------------------------- lookup

    /**
     * Line up provider channels with guide channels. `epg_channel_id` is the
     * intended link but plenty of providers leave it blank or wrong, so fall
     * back to matching on a normalised display name.
     */
    fun mapChannels(channels: List<Channel>): Int {
        if (programmes.isEmpty()) return 0
        val map = HashMap<String, String>(channels.size)
        for (channel in channels) {
            val declared = channel.epgChannelId?.trim().orEmpty()
            if (declared.isNotEmpty() && programmes.containsKey(declared)) {
                map[channel.streamId] = declared
                continue
            }
            val guess = displayNames[normalise(channel.name)]
            if (guess != null && programmes.containsKey(guess)) map[channel.streamId] = guess
        }
        channelMap = map
        return map.size
    }

    fun programmesFor(streamId: String): List<Programme> {
        val epgId = channelMap[streamId] ?: return emptyList()
        return programmes[epgId] ?: emptyList()
    }

    fun nowNext(streamId: String, at: Long = System.currentTimeMillis()): NowNext {
        val list = programmesFor(streamId)
        if (list.isEmpty()) return NowNext(null, null)

        // binary search for the first programme still running
        var lo = 0
        var hi = list.size - 1
        var index = list.size
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (list[mid].end > at) {
                index = mid
                hi = mid - 1
            } else {
                lo = mid + 1
            }
        }
        if (index >= list.size) return NowNext(null, null)
        val candidate = list[index]
        return if (candidate.start <= at) {
            NowNext(candidate, list.getOrNull(index + 1))
        } else {
            NowNext(null, candidate)
        }
    }

    fun inWindow(streamId: String, from: Long, to: Long): List<Programme> =
        programmesFor(streamId).filter { it.end > from && it.start < to }

    fun search(term: String, limit: Int = 80): List<Pair<String, Programme>> {
        if (term.length < 2 || programmes.isEmpty()) return emptyList()
        val needle = term.lowercase()
        val now = System.currentTimeMillis()
        val reverse = channelMap.entries.associate { (streamId, epgId) -> epgId to streamId }
        val results = ArrayList<Pair<String, Programme>>()
        for ((epgId, list) in programmes) {
            val streamId = reverse[epgId] ?: continue
            for (programme in list) {
                if (programme.end < now) continue
                if (programme.title.lowercase().contains(needle)) {
                    results.add(streamId to programme)
                    if (results.size >= limit) return results.sortedBy { it.second.start }
                }
            }
        }
        return results.sortedBy { it.second.start }
    }

    fun clear() {
        programmes = emptyMap()
        displayNames = emptyMap()
        channelMap = emptyMap()
        stats = null
        System.gc()
    }

    // -------------------------------------------------------------- helpers

    private fun normalise(name: String): String {
        val lower = name.lowercase()
        val sb = StringBuilder(lower.length)
        for (ch in lower) if (ch.isLetterOrDigit()) sb.append(ch)
        // drop the quality suffixes providers sprinkle everywhere
        return sb.toString()
            .removeSuffix("hd").removeSuffix("fhd").removeSuffix("uhd")
            .removeSuffix("4k").removeSuffix("sd")
    }

    private fun <K, V> MutableMap<K, V>.putIfAbsentCompat(key: K, value: V) {
        if (!containsKey(key)) put(key, value)
    }

    private class CountingStream(
        private val delegate: InputStream,
        private val onRead: (Long) -> Unit
    ) : InputStream() {
        private var total = 0L
        private var lastReport = 0L

        override fun read(): Int = delegate.read().also { if (it >= 0) tick(1) }

        override fun read(b: ByteArray, off: Int, len: Int): Int =
            delegate.read(b, off, len).also { if (it > 0) tick(it.toLong()) }

        private fun tick(n: Long) {
            total += n
            if (total - lastReport > 2_000_000) {
                lastReport = total
                onRead(total)
            }
        }

        override fun close() = delegate.close()
        override fun available(): Int = delegate.available()
    }
}

private fun Int.formatted(): String = "%,d".format(this)

private fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${n / 1024} KB"
    else -> "%.1f MB".format(n / 1024.0 / 1024.0)
}
