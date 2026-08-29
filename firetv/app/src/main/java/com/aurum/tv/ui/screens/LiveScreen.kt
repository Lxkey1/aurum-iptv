package com.aurum.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.data.Channel
import com.aurum.tv.data.Repository
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.tidyChannelName
import com.aurum.tv.util.timeOfDay
import kotlinx.coroutines.delay

/**
 * Live TV: categories down the left, channels on the right with now/next.
 * D-pad right moves from the category list into the channel list.
 */
@Composable
fun LiveScreen(state: AppState, revision: Int) {
    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var tick by remember { mutableIntStateOf(0) }

    // Refresh now/next every minute so the progress bars stay honest.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            tick++
        }
    }

    if (repo.channels.isEmpty()) {
        LoadingState("Loading channels…")
        return
    }

    val counts = remember(revision) { repo.channels.groupingBy { it.categoryId }.eachCount() }

    val categories = remember(revision) {
        buildList {
            add(Triple(Repository.ALL, "All channels", repo.channels.size))
            add(Triple(Repository.FAVOURITES, "Favourites", state.prefs.favouriteIds("live").size))
            add(Triple(Repository.RECENT, "Recently watched", state.prefs.recentChannels.size))
            repo.liveCategories.forEach { cat ->
                add(Triple(cat.id, cat.name, counts[cat.id] ?: 0))
            }
        }
    }

    val channels = remember(category, revision) { repo.channelsIn(category) }
    val listState = rememberLazyListState()

    LaunchedEffect(category) { listState.scrollToItem(0) }

    Row(Modifier.fillMaxSize()) {

        // ------------------------------------------------------- categories
        LazyColumn(
            contentPadding = PaddingValues(
                start = Aurum.OverscanH,
                end = 14.dp,
                top = 10.dp,
                bottom = Aurum.OverscanV
            ),
            verticalArrangement = Arrangement.spacedBy(3.dp),
            modifier = Modifier.width(310.dp).fillMaxHeight()
        ) {
            items(categories, key = { it.first }) { (id, name, count) ->
                CategoryRow(
                    label = name,
                    count = count,
                    selected = category == id,
                    onClick = { category = id }
                )
            }
        }

        // --------------------------------------------------------- channels
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(end = Aurum.OverscanH, top = 10.dp, bottom = 12.dp)
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        categories.firstOrNull { it.first == category }?.second ?: "Channels",
                        color = Aurum.Text,
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Text(
                        "${channels.size} channel${if (channels.size == 1) "" else "s"}",
                        color = Aurum.Text3,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Badge(
                    if (state.ui.value.epgReady) "Guide active" else "Guide not loaded",
                    tone = if (state.ui.value.epgReady) Aurum.Good else Aurum.Text3
                )
            }

            if (channels.isEmpty()) {
                EmptyState(
                    AurumIcons.Tv,
                    "Nothing here",
                    if (category == Repository.FAVOURITES)
                        "Press and hold SELECT on any channel to add it to your favourites."
                    else "This category is empty."
                )
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(end = Aurum.OverscanH, bottom = Aurum.OverscanV),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(channels, key = { it.streamId }) { channel ->
                        LiveChannelItem(state, channel, channels, tick)
                    }
                }
            }
        }
    }
}

@Composable
private fun LiveChannelItem(
    state: AppState,
    channel: Channel,
    playlist: List<Channel>,
    tick: Int
) {
    val nowNext = remember(channel.streamId, tick) { state.repo.epg.nowNext(channel.streamId) }
    val now = nowNext.now

    ChannelRow(
        number = channel.number,
        name = tidyChannelName(channel.name),
        logoUrl = channel.logo,
        nowTitle = now?.title ?: nowNext.next?.let { "Next: ${it.title}" },
        nowProgress = now?.let {
            val span = (it.end - it.start).coerceAtLeast(1)
            ((System.currentTimeMillis() - it.start).toFloat() / span).coerceIn(0f, 1f)
        } ?: 0f,
        nowUntil = now?.let { timeOfDay(it.end) },
        favourite = state.prefs.isFavourite("live", channel.streamId),
        onClick = { state.playChannel(channel, playlist) }
    )
}

@Composable
fun CategoryRow(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    focused -> Aurum.Accent
                    selected -> Aurum.AccentSoft
                    else -> Color.Transparent
                }
            )
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Text(
            label,
            color = when {
                focused -> Aurum.AccentInk
                selected -> Aurum.AccentBright
                else -> Aurum.Text2
            },
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(
            count.toString(),
            color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
            fontSize = 12.sp
        )
    }
}
