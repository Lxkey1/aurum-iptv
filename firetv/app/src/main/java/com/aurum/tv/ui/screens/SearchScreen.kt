package com.aurum.tv.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.dayLabel
import com.aurum.tv.util.tidyChannelName
import com.aurum.tv.util.timeOfDay

@Composable
fun SearchScreen(state: AppState, revision: Int) {
    var query by rememberSaveable { mutableStateOf(state.ui.value.searchQuery) }
    val repo = state.repo
    val needle = query.trim().lowercase()

    val channels = remember(needle, revision) {
        if (needle.length < 2) emptyList()
        else repo.channels.filter { it.name.lowercase().contains(needle) }.take(40)
    }
    val movies = remember(needle, revision) {
        if (needle.length < 2) emptyList()
        else repo.movies.filter { it.name.lowercase().contains(needle) }.take(40)
    }
    val series = remember(needle, revision) {
        if (needle.length < 2) emptyList()
        else repo.series.filter { it.name.lowercase().contains(needle) }.take(40)
    }
    val programmes = remember(needle, revision) {
        if (needle.length < 2) emptyList() else repo.epg.search(query.trim(), 40)
    }

    LazyColumn(
        contentPadding = PaddingValues(
            start = Aurum.OverscanH,
            end = Aurum.OverscanH,
            top = 10.dp,
            bottom = Aurum.OverscanV + 30.dp
        ),
        verticalArrangement = Arrangement.spacedBy(26.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Column {
                Text("Search", color = Aurum.Text, style = MaterialTheme.typography.headlineLarge)
                Spacer(Modifier.height(14.dp))
                TvTextField(
                    label = "Find anything on your line",
                    value = query,
                    onValueChange = {
                        query = it
                        state.setSearchQuery(it)
                    },
                    placeholder = "Channels, films, box sets and the TV guide…",
                    keyboardType = KeyboardType.Text,
                    modifier = Modifier.widthIn(max = 900.dp)
                )
            }
        }

        if (needle.length < 2) {
            item {
                EmptyState(
                    AurumIcons.Search,
                    "Search your whole line",
                    "Type at least two characters to search live channels, films, box sets and everything coming up in the TV guide.",
                    modifier = Modifier.height(340.dp)
                )
            }
            return@LazyColumn
        }

        val total = channels.size + movies.size + series.size + programmes.size
        if (total == 0) {
            item {
                EmptyState(
                    AurumIcons.Search,
                    "No matches",
                    "Nothing on this line matches “$query”. Try a shorter or differently spelled term.",
                    modifier = Modifier.height(340.dp)
                )
            }
            return@LazyColumn
        }

        if (channels.isNotEmpty()) {
            item { SectionHeader("Live channels · ${channels.size}") }
            items(channels, key = { "chan-${it.streamId}" }) { channel ->
                val nowNext = remember(channel.streamId) { repo.epg.nowNext(channel.streamId) }
                ChannelRow(
                    number = channel.number,
                    name = tidyChannelName(channel.name),
                    logoUrl = channel.logo,
                    nowTitle = nowNext.now?.title,
                    nowProgress = 0f,
                    nowUntil = nowNext.now?.let { timeOfDay(it.end) },
                    favourite = state.prefs.isFavourite("live", channel.streamId),
                    onClick = { state.playChannel(channel, channels) }
                )
            }
        }

        if (movies.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Films · ${movies.size}")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        items(movies, key = { it.streamId }) { movie -> MoviePoster(state, movie) }
                    }
                }
            }
        }

        if (series.isNotEmpty()) {
            item {
                Column {
                    SectionHeader("Box sets · ${series.size}")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        items(series, key = { it.seriesId }) { item -> SeriesPoster(state, item) }
                    }
                }
            }
        }

        if (programmes.isNotEmpty()) {
            item { SectionHeader("Coming up in the guide · ${programmes.size}") }
            items(programmes, key = { "prog-${it.first}-${it.second.start}" }) { (streamId, programme) ->
                val channel = repo.channel(streamId)
                ChannelRow(
                    number = channel?.number ?: 0,
                    name = programme.title,
                    logoUrl = channel?.logo,
                    nowTitle = "${dayLabel(programme.start)} ${timeOfDay(programme.start)} · ${channel?.let { tidyChannelName(it.name) }.orEmpty()}",
                    nowProgress = 0f,
                    nowUntil = null,
                    onClick = { channel?.let { state.playChannel(it, repo.channels) } }
                )
            }
        }
    }
}
