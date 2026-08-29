package com.aurum.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.aurum.tv.data.Movie
import com.aurum.tv.data.Series
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.Screen
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.*

@Composable
fun HomeScreen(state: AppState, revision: Int) {
    val repo = state.repo
    val prefs = state.prefs

    val continueWatching = remember(revision) { prefs.continueWatching() }
    val favouriteChannels = remember(revision) {
        prefs.favouriteIds("live").mapNotNull { repo.channel(it) }
    }
    val recentChannels = remember(revision) {
        prefs.recentChannels.mapNotNull { repo.channel(it) }.filter { it !in favouriteChannels }
    }
    val newMovies = remember(revision) { repo.movies.sortedByDescending { it.addedAt }.take(24) }
    val newSeries = remember(revision) { repo.series.sortedByDescending { it.modifiedAt }.take(24) }
    val topRated = remember(revision) {
        repo.movies.filter { it.rating >= 7.5 }.sortedByDescending { it.rating }.take(24)
    }

    if (repo.channels.isEmpty() && repo.movies.isEmpty() && repo.series.isEmpty()) {
        LoadingState("Loading your line…")
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(
            start = Aurum.OverscanH,
            end = Aurum.OverscanH,
            top = 8.dp,
            bottom = Aurum.OverscanV + 40.dp
        ),
        verticalArrangement = Arrangement.spacedBy(30.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Column {
                Text(
                    greeting(),
                    color = Aurum.Text,
                    style = MaterialTheme.typography.displayLarge
                )
                Text(
                    buildString {
                        append("${formatCount(repo.channels.size)} channels")
                        if (repo.movies.isNotEmpty()) append("  ·  ${formatCount(repo.movies.size)} films")
                        if (repo.series.isNotEmpty()) append("  ·  ${formatCount(repo.series.size)} box sets")
                    },
                    color = Aurum.Text3,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(top = 6.dp)
                )
            }
        }

        if (continueWatching.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Continue watching")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        items(continueWatching, key = { it.key }) { entry ->
                            PosterCard(
                                title = entry.name,
                                subtitle = entry.subtitle.ifEmpty {
                                    "${clock(entry.position)} / ${clock(entry.duration)}"
                                },
                                imageUrl = entry.cover,
                                progress = if (entry.duration > 0) entry.position.toFloat() / entry.duration else 0f,
                                onClick = { state.resume(entry) }
                            )
                        }
                    }
                }
            }
        }

        if (favouriteChannels.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Favourite channels")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        items(favouriteChannels, key = { it.streamId }) { channel ->
                            ChannelTile(state, channel, favouriteChannels)
                        }
                    }
                }
            }
        }

        if (recentChannels.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Recently watched")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        items(recentChannels, key = { it.streamId }) { channel ->
                            ChannelTile(state, channel, recentChannels)
                        }
                    }
                }
            }
        }

        if (newMovies.isNotEmpty()) {
            item { MovieRail(state, "Recently added films", newMovies) }
        }
        if (newSeries.isNotEmpty()) {
            item { SeriesRail(state, "Recently added box sets", newSeries) }
        }
        if (topRated.isNotEmpty()) {
            item { MovieRail(state, "Highly rated", topRated) }
        }
    }
}

@Composable
fun MovieRail(state: AppState, title: String, movies: List<Movie>) {
    Column {
        SectionHeader(title)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(movies, key = { it.streamId }) { movie ->
                MoviePoster(state, movie)
            }
        }
    }
}

@Composable
fun SeriesRail(state: AppState, title: String, series: List<Series>) {
    Column {
        SectionHeader(title)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(series, key = { it.seriesId }) { item ->
                SeriesPoster(state, item)
            }
        }
    }
}

@Composable
fun MoviePoster(state: AppState, movie: Movie) {
    val saved = state.prefs.progressFor("movie:${movie.streamId}")
    PosterCard(
        title = movie.name,
        subtitle = listOfNotNull(movie.year).joinToString(" · ").ifEmpty { null },
        imageUrl = movie.cover,
        rating = ratingLabel(movie.rating),
        favourite = state.prefs.isFavourite("movie", movie.streamId),
        progress = if (saved != null && saved.duration > 0) saved.position.toFloat() / saved.duration else 0f,
        onClick = { state.navigate(Screen.MovieDetail(movie)) }
    )
}

@Composable
fun SeriesPoster(state: AppState, series: Series) {
    PosterCard(
        title = series.name,
        subtitle = series.year,
        imageUrl = series.cover,
        rating = ratingLabel(series.rating),
        favourite = state.prefs.isFavourite("series", series.seriesId),
        onClick = { state.navigate(Screen.SeriesDetail(series)) }
    )
}

/** A landscape channel tile used on the home rails. */
@Composable
private fun ChannelTile(
    state: AppState,
    channel: com.aurum.tv.data.Channel,
    playlist: List<com.aurum.tv.data.Channel>
) {
    val nowNext = remember(channel.streamId) { state.repo.epg.nowNext(channel.streamId) }
    Box(Modifier.width(320.dp)) {
        ChannelRow(
            number = channel.number,
            name = tidyChannelName(channel.name),
            logoUrl = channel.logo,
            nowTitle = nowNext.now?.title,
            nowProgress = nowNext.now?.let { programme ->
                val span = (programme.end - programme.start).coerceAtLeast(1)
                ((System.currentTimeMillis() - programme.start).toFloat() / span).coerceIn(0f, 1f)
            } ?: 0f,
            nowUntil = nowNext.now?.let { timeOfDay(it.end) },
            favourite = state.prefs.isFavourite("live", channel.streamId),
            onClick = { state.playChannel(channel, playlist) }
        )
    }
}

private fun greeting(): String {
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    return when {
        hour < 5 -> "Still up?"
        hour < 12 -> "Good morning"
        hour < 18 -> "Good afternoon"
        else -> "Good evening"
    }
}
