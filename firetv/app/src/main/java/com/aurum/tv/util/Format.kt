package com.aurum.tv.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

private val hhmm = SimpleDateFormat("HH:mm", Locale.getDefault())
private val dayFormat = SimpleDateFormat("EEE d MMM", Locale.getDefault())
private val fullDate = SimpleDateFormat("d MMM yyyy", Locale.getDefault())

fun timeOfDay(millis: Long): String = hhmm.format(Date(millis))

fun dayLabel(millis: Long): String {
    val today = Calendar.getInstance()
    val that = Calendar.getInstance().apply { timeInMillis = millis }
    val diff = that.get(Calendar.DAY_OF_YEAR) - today.get(Calendar.DAY_OF_YEAR) +
        (that.get(Calendar.YEAR) - today.get(Calendar.YEAR)) * 365
    return when (diff) {
        0 -> "Today"
        1 -> "Tomorrow"
        -1 -> "Yesterday"
        else -> dayFormat.format(Date(millis))
    }
}

fun dateLabel(millis: Long): String = fullDate.format(Date(millis))

/** Milliseconds -> "1:02:03" or "02:03". */
fun clock(millis: Long): String {
    if (millis <= 0) return "00:00"
    val total = millis / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

/** Seconds -> "2h 14m". */
fun runtimeLabel(seconds: Int): String {
    if (seconds <= 0) return ""
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    return if (h > 0) "${h}h ${if (m > 0) "${m}m" else ""}".trim() else "${m}m"
}

/** Provider channel names carry country/quality prefixes we do not want on screen. */
fun tidyChannelName(name: String): String =
    name.replace(Regex("^\\s*[|\\[(]?\\s*[A-Z]{2,3}\\s*[|\\])]\\s*[:-]?\\s*"), "").trim().ifEmpty { name }

fun plainText(value: String?): String =
    value?.replace(Regex("<[^>]*>"), " ")?.replace(Regex("\\s+"), " ")?.trim().orEmpty()

fun initials(name: String): String {
    val words = name.replace(Regex("[^A-Za-z0-9 ]"), " ").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return "?"
    return words.take(2).joinToString("") { it.first().uppercase() }
}

/** exp_date is a unix timestamp; 0 means the line never expires. */
fun expiryLabel(expiresAt: Long): Pair<String, ExpiryTone> {
    if (expiresAt <= 0) return "Unlimited" to ExpiryTone.OK
    val millis = expiresAt * 1000
    val days = TimeUnit.MILLISECONDS.toDays(millis - System.currentTimeMillis())
    val label = dateLabel(millis)
    return when {
        days < 0 -> "Expired $label" to ExpiryTone.BAD
        days <= 7 -> "$label · ${days}d left" to ExpiryTone.WARN
        else -> "$label · ${days}d left" to ExpiryTone.OK
    }
}

enum class ExpiryTone { OK, WARN, BAD }

fun ratingLabel(rating: Double): String? =
    if (rating > 0) String.format(Locale.US, "%.1f", rating) else null

fun formatCount(n: Int): String = when {
    n >= 10_000 -> "${n / 1000}k"
    n >= 1_000 -> String.format(Locale.US, "%.1fk", n / 1000.0)
    else -> n.toString()
}

fun formatBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${n / 1024} KB"
    n < 1024L * 1024 * 1024 -> "%.1f MB".format(n / 1024.0 / 1024.0)
    else -> "%.2f GB".format(n / 1024.0 / 1024.0 / 1024.0)
}

/** Catch-up start parameter: "YYYY-MM-DD:HH-MM". */
fun catchupStamp(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).format(Date(millis))
