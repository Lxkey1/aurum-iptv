package com.aurum.tv.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.data.Episode
import com.aurum.tv.data.Movie
import com.aurum.tv.data.Series
import com.aurum.tv.data.SeriesDetail
import com.aurum.tv.data.TitleDetail
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.*

@Composable
fun MovieDetailScreen(state: AppState, movie: Movie) {
    var detail by remember(movie.streamId) { mutableStateOf<TitleDetail?>(null) }
    var loading by remember(movie.streamId) { mutableStateOf(true) }

    LaunchedEffect(movie.streamId) {
        detail = state.repo.movieDetail(movie.streamId)
        loading = false
    }

    val saved = state.prefs.progressFor("movie:${movie.streamId}")
    var favourite by remember(movie.streamId) {
        mutableStateOf(state.prefs.isFavourite("movie", movie.streamId))
    }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(loading) { if (!loading) runCatching { focusRequester.requestFocus() } }

    DetailScaffold(
        title = detail?.name?.takeIf { it.isNotEmpty() } ?: movie.name,
        backdrop = detail?.backdrop ?: detail?.cover ?: movie.cover,
        poster = detail?.cover ?: movie.cover,
        chips = buildList {
            movie.year?.let { add(it) }
            detail?.durationSeconds?.takeIf { it > 0 }?.let { add(runtimeLabel(it)) }
            ratingLabel(detail?.rating ?: movie.rating)?.let { add("★ $it") }
            add((detail?.extension ?: movie.extension).uppercase())
        },
        plot = plainText(detail?.plot ?: movie.plot).ifEmpty { "No synopsis was supplied for this title." },
        credits = buildList {
            detail?.director?.let { add("Director" to plainText(it)) }
            detail?.cast?.let { add("Cast" to plainText(it)) }
            (detail?.genre ?: movie.genre)?.let { add("Genre" to plainText(it)) }
        },
        actions = {
            TvButton(
                text = if (saved != null && saved.position > 30_000)
                    "Resume from ${clock(saved.position)}" else "Play",
                icon = AurumIcons.Play,
                primary = true,
                modifier = Modifier.focusRequester(focusRequester)
            ) { state.playMovie(movie, detail) }

            if (saved != null && saved.position > 30_000) {
                TvButton("Start over", icon = AurumIcons.Refresh) {
                    state.prefs.removeProgress(saved.key)
                    state.playMovie(movie, detail)
                }
            }
            TvButton(
                text = if (favourite) "In favourites" else "Favourite",
                icon = if (favourite) AurumIcons.HeartFilled else AurumIcons.Heart,
                primary = favourite
            ) { favourite = state.toggleFavourite("movie", movie.streamId) }
        },
        body = {
            if (saved != null && saved.duration > 0) {
                Column(Modifier.padding(top = 20.dp).width(520.dp)) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(5.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(Aurum.Panel)
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth((saved.position.toFloat() / saved.duration).coerceIn(0f, 1f))
                                .fillMaxHeight()
                                .background(Aurum.AccentGradient)
                        )
                    }
                    Text(
                        "${clock(saved.position)} of ${clock(saved.duration)} watched",
                        color = Aurum.Text4,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 7.dp)
                    )
                }
            }
        }
    )
}

@Composable
fun SeriesDetailScreen(state: AppState, series: Series) {
    var detail by remember(series.seriesId) { mutableStateOf<SeriesDetail?>(null) }
    var loading by remember(series.seriesId) { mutableStateOf(true) }
    var season by remember(series.seriesId) { mutableIntStateOf(0) }

    LaunchedEffect(series.seriesId) {
        detail = state.repo.seriesDetail(series.seriesId)
        season = detail?.seasons?.keys?.firstOrNull() ?: 0
        loading = false
    }

    var favourite by remember(series.seriesId) {
        mutableStateOf(state.prefs.isFavourite("series", series.seriesId))
    }

    if (loading) {
        LoadingState("Loading box set…")
        return
    }

    val seasons = detail?.seasons.orEmpty()
    val episodes = seasons[season].orEmpty()
    val info = detail?.detail

    val nextUp = remember(detail, state.ui.value.revision) { findNextUp(state, seasons) }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    DetailScaffold(
        title = info?.name?.takeIf { it.isNotEmpty() } ?: series.name,
        backdrop = info?.backdrop ?: info?.cover ?: series.cover,
        poster = info?.cover ?: series.cover,
        chips = buildList {
            series.year?.let { add(it) }
            if (seasons.isNotEmpty()) add("${seasons.size} season${if (seasons.size > 1) "s" else ""}")
            val total = seasons.values.sumOf { it.size }
            if (total > 0) add("$total episodes")
            ratingLabel(info?.rating ?: series.rating)?.let { add("★ $it") }
        },
        plot = plainText(info?.plot ?: series.plot).ifEmpty { "No synopsis was supplied for this series." },
        credits = buildList {
            info?.director?.let { add("Director" to plainText(it)) }
            info?.cast?.let { add("Cast" to plainText(it)) }
            (info?.genre ?: series.genre)?.let { add("Genre" to plainText(it)) }
        },
        actions = {
            if (nextUp != null) {
                val (nextSeason, index) = nextUp
                val episode = seasons[nextSeason]!![index]
                TvButton(
                    text = "Play S%02dE%02d".format(episode.season, episode.episodeNumber),
                    icon = AurumIcons.Play,
                    primary = true,
                    modifier = Modifier.focusRequester(focusRequester)
                ) { state.playEpisode(series, seasons[nextSeason]!!, index) }
            }
            TvButton(
                text = if (favourite) "In favourites" else "Favourite",
                icon = if (favourite) AurumIcons.HeartFilled else AurumIcons.Heart,
                primary = favourite
            ) { favourite = state.toggleFavourite("series", series.seriesId) }
        },
        body = {
            if (seasons.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    modifier = Modifier
                        .padding(top = 22.dp)
                        .horizontalScroll(rememberScrollState())
                ) {
                    seasons.keys.forEach { number ->
                        TvChip(
                            label = "Season $number",
                            selected = season == number,
                            trailing = seasons[number]?.size?.toString()
                        ) { season = number }
                    }
                }
            }
        },
        list = {
            if (episodes.isEmpty()) {
                item {
                    Text(
                        "No episodes are listed for this season.",
                        color = Aurum.Text4,
                        modifier = Modifier.padding(horizontal = Aurum.OverscanH, vertical = 20.dp)
                    )
                }
            } else {
                itemsIndexed(episodes, key = { _, episode -> episode.id }) { index, episode ->
                    EpisodeRow(state, episode, seasons[season]!!, index) {
                        state.playEpisode(series, seasons[season]!!, index)
                    }
                }
            }
        }
    )
}

@Composable
private fun EpisodeRow(
    state: AppState,
    episode: Episode,
    all: List<Episode>,
    index: Int,
    onPlay: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val saved = state.prefs.progressFor("episode:${episode.id}")

    Row(
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Aurum.OverscanH, vertical = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (focused) Aurum.Accent else Aurum.Glass)
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onPlay() }
            .padding(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(190.dp, 107.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(Aurum.Void)
        ) {
            ArtworkImage(episode.still, episode.title, Modifier.fillMaxSize())
            Text(
                "E%02d".format(episode.episodeNumber),
                color = Aurum.AccentBright,
                fontSize = 11.sp,
                modifier = Modifier
                    .padding(7.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Color(0xD906070A))
                    .padding(horizontal = 7.dp, vertical = 3.dp)
            )
        }

        Column(Modifier.weight(1f)) {
            Text(
                episode.title,
                color = if (focused) Aurum.AccentInk else Aurum.Text,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            val meta = listOfNotNull(
                runtimeLabel(episode.durationSeconds).ifEmpty { null },
                episode.airDate?.take(10),
                ratingLabel(episode.rating)?.let { "★ $it" }
            ).joinToString("   ·   ")
            if (meta.isNotEmpty()) {
                Text(
                    meta,
                    color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 3.dp)
                )
            }
            if (!episode.plot.isNullOrEmpty()) {
                Text(
                    plainText(episode.plot),
                    color = if (focused) Aurum.AccentInk.copy(alpha = 0.75f) else Aurum.Text3,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 7.dp)
                )
            }
            if (saved != null && saved.duration > 0) {
                Box(
                    Modifier
                        .padding(top = 9.dp)
                        .fillMaxWidth(0.6f)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (focused) Color(0x33000000) else Aurum.Panel)
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((saved.position.toFloat() / saved.duration).coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .background(if (focused) Aurum.AccentInk else Aurum.Accent)
                    )
                }
            }
        }
    }
}

/**
 * Shared layout: cinematic backdrop, poster, metadata and actions, then an
 * optional scrolling list underneath (episodes).
 */
@Composable
private fun DetailScaffold(
    title: String,
    backdrop: String?,
    poster: String?,
    chips: List<String>,
    plot: String,
    credits: List<Pair<String, String>>,
    actions: @Composable RowScope.() -> Unit,
    body: @Composable ColumnScope.() -> Unit = {},
    list: (androidx.compose.foundation.lazy.LazyListScope.() -> Unit)? = null
) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 430.dp)) {
                if (backdrop != null) {
                    ArtworkImage(backdrop, title, Modifier.fillMaxSize().alpha(0.35f))
                }
                Box(
                    Modifier.matchParentSize().background(
                        Brush.horizontalGradient(
                            0f to Aurum.Base,
                            0.45f to Aurum.Base.copy(alpha = 0.94f),
                            1f to Aurum.Base.copy(alpha = 0.55f)
                        )
                    )
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(34.dp),
                    modifier = Modifier.padding(Aurum.OverscanH, Aurum.OverscanV)
                ) {
                    Box(
                        Modifier
                            .size(210.dp, 315.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Aurum.Panel)
                            .border(BorderStroke(1.dp, Aurum.BorderStrong), RoundedCornerShape(16.dp))
                    ) {
                        ArtworkImage(poster, title, Modifier.fillMaxSize())
                    }

                    Column(Modifier.weight(1f)) {
                        Text(
                            title,
                            color = Aurum.Text,
                            style = MaterialTheme.typography.displayLarge,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (chips.isNotEmpty()) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(top = 12.dp)
                            ) {
                                chips.forEach { Badge(it, tone = Aurum.Text2) }
                            }
                        }
                        Text(
                            plot,
                            color = Aurum.Text2,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 4,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 16.dp).widthIn(max = 780.dp)
                        )
                        credits.forEach { (label, value) ->
                            Row(Modifier.padding(top = 7.dp).widthIn(max = 780.dp)) {
                                Text(label, color = Aurum.Text4, fontSize = 13.sp, modifier = Modifier.width(78.dp))
                                Text(
                                    value,
                                    color = Aurum.Text2,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.padding(top = 22.dp),
                            content = actions
                        )
                        body()
                    }
                }
            }
        }
        list?.invoke(this)
        item { Spacer(Modifier.height(Aurum.OverscanV + 20.dp)) }
    }
}

/** First part-watched episode, else the first unwatched one, else the very first. */
private fun findNextUp(state: AppState, seasons: Map<Int, List<Episode>>): Pair<Int, Int>? {
    for ((season, list) in seasons) {
        list.forEachIndexed { index, episode ->
            val saved = state.prefs.progressFor("episode:${episode.id}")
            if (saved != null && saved.duration > 0 && saved.position < saved.duration * 0.95) {
                return season to index
            }
        }
    }
    for ((season, list) in seasons) {
        list.forEachIndexed { index, episode ->
            if (state.prefs.progressFor("episode:${episode.id}") == null) return season to index
        }
    }
    val first = seasons.entries.firstOrNull() ?: return null
    return if (first.value.isNotEmpty()) first.key to 0 else null
}
