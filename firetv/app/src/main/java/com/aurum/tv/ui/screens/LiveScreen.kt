package com.aurum.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.aurum.tv.data.NowNext
import com.aurum.tv.data.Repository
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.formatCount
import com.aurum.tv.util.tidyChannelName
import com.aurum.tv.util.timeOfDay
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Live TV — categories on the left, a paged channel list on the right.
 * Nothing is held in memory; pages arrive from the catalogue as you scroll.
 */
@Composable
fun LiveScreen(state: AppState, revision: Int) {
    val repo = state.repo
    val scope = rememberCoroutineScope()

    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var groupId by rememberSaveable { mutableStateOf<Long?>(null) }
    var tick by remember { mutableIntStateOf(0) }

    // Keep now/next honest without re-querying the catalogue.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            tick++
        }
    }

    if (repo.stats.channels == 0) {
        LoadingState("Loading channels…")
        return
    }

    val favourites = remember(revision) { state.prefs.favouriteIds("live") }
    val recents = remember(revision) { state.prefs.recentChannels }

    val isPinned = groupId == null && (category == Repository.FAVOURITES || category == Repository.RECENT)
    val pinnedIds = when {
        !isPinned -> emptyList()
        category == Repository.FAVOURITES -> favourites
        else -> recents
    }

    val paged = rememberPagedList<Channel>(
        category, groupId, revision, isPinned, pinnedIds.size,
        pageSize = 60,
        count = {
            if (isPinned) pinnedIds.size
            else repo.channelCount(
                category = category.takeIf { it != Repository.ALL },
                groupId = groupId
            )
        },
        fetch = { offset, limit ->
            if (isPinned) repo.channelsByIds(pinnedIds.drop(offset).take(limit))
            else repo.channels(
                category = category.takeIf { it != Repository.ALL },
                limit = limit,
                offset = offset,
                groupId = groupId
            )
        }
    )

    val listState = rememberLazyListState()
    listState.PageWhenNearEnd(paged)

    val categories = remember(revision) {
        buildList {
            add(Triple(Repository.ALL, "All channels", repo.stats.channels))
            add(Triple(Repository.FAVOURITES, "Favourites", favourites.size))
            add(Triple(Repository.RECENT, "Recently watched", recents.size))
        }
    }

    Row(Modifier.fillMaxSize()) {

        // ------------------------------------------------------- categories
        LazyColumn(
            contentPadding = PaddingValues(
                start = Aurum.OverscanH, end = 14.dp, top = 10.dp, bottom = Aurum.OverscanV
            ),
            verticalArrangement = Arrangement.spacedBy(3.dp),
            modifier = Modifier.width(320.dp).fillMaxHeight()
        ) {
            items(categories, key = { it.first }) { (id, name, count) ->
                CategoryRow(name, count, groupId == null && category == id) {
                    category = id; groupId = null
                }
            }

            if (repo.groups.isNotEmpty()) {
                item { SidebarHeading("My groups") }
                items(repo.groups, key = { "g${it.id}" }) { g ->
                    CategoryRow(g.name, g.count, groupId == g.id) {
                        groupId = g.id; category = Repository.ALL
                    }
                }
            }

            item { SidebarHeading("Provider categories") }
            items(repo.liveCategories, key = { it.id }) { cat ->
                CategoryRow(cat.name, cat.count, groupId == null && category == cat.id) {
                    category = cat.id; groupId = null
                }
            }
        }

        // --------------------------------------------------------- channels
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(end = Aurum.OverscanH, top = 10.dp, bottom = 12.dp)
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            groupId != null -> repo.groups.firstOrNull { it.id == groupId }?.name ?: "Group"
                            category == Repository.ALL -> "All channels"
                            category == Repository.FAVOURITES -> "Favourites"
                            category == Repository.RECENT -> "Recently watched"
                            else -> repo.liveCategories.firstOrNull { it.id == category }?.name ?: "Channels"
                        },
                        color = Aurum.Text,
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Text(
                        "${formatCount(paged.total)} channel${if (paged.total == 1) "" else "s"}",
                        color = Aurum.Text3,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Badge(
                    if (state.ui.value.epgReady) "Guide active" else "Guide not loaded",
                    tone = if (state.ui.value.epgReady) Aurum.Good else Aurum.Text3
                )
            }

            if (paged.items.isEmpty() && !paged.loading) {
                EmptyState(
                    AurumIcons.Tv, "Nothing here",
                    if (category == Repository.FAVOURITES)
                        "Open a channel and press the favourite button to keep it here."
                    else "This category is empty."
                )
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(end = Aurum.OverscanH, bottom = Aurum.OverscanV),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(paged.items, key = { it.streamId }) { channel ->
                        LiveChannelItem(state, channel, tick) {
                            scope.launch {
                                val ids =
                                    if (isPinned) pinnedIds
                                    else repo.channelIds(category.takeIf { it != Repository.ALL }, groupId)
                                state.playChannel(channel, ids)
                            }
                        }
                    }
                    if (!paged.exhausted) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                                Text("Loading more…", color = Aurum.Text4, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SidebarHeading(text: String) {
    Text(
        text.uppercase(),
        color = Aurum.Text4,
        fontSize = 10.sp,
        letterSpacing = 1.4.sp,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 6.dp)
    )
}

@Composable
private fun LiveChannelItem(state: AppState, channel: Channel, tick: Int, onPlay: () -> Unit) {
    val nowNext: NowNext = remember(channel.streamId, tick) { state.repo.epg.nowNext(channel.streamId) }
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
        onClick = onPlay
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
            formatCount(count),
            color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
            fontSize = 12.sp
        )
    }
}
