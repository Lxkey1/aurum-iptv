package com.aurum.tv.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.data.Channel
import com.aurum.tv.data.Programme
import com.aurum.tv.data.Repository
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.dayLabel
import com.aurum.tv.util.tidyChannelName
import com.aurum.tv.util.timeOfDay
import kotlinx.coroutines.delay

/**
 * TV guide.
 *
 * A pixel-accurate timeline grid needs a mouse; on a remote it is miserable.
 * Instead each channel is a lane whose programmes scroll horizontally, and the
 * D-pad moves naturally between lanes and along a lane — which is how the
 * Fire TV's own guide behaves.
 */
private const val MINUTES_PER_DP = 3.2f   // one dp per 3.2 minutes of airtime

@Composable
fun GuideScreen(state: AppState, revision: Int) {
    val ui by state.ui.collectAsState()

    if (!ui.epgReady) {
        GuidePrompt(state, ui.epgLoading, ui.epgProgress, ui.epgProgressText)
        return
    }

    val repo = state.repo
    var category by rememberSaveable { mutableStateOf(Repository.ALL) }
    var selected by remember { mutableStateOf<Pair<Channel, Programme>?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = System.currentTimeMillis()
        }
    }

    val channels = remember(category, revision) { repo.channelsIn(category) }
    val windowStart = remember(now) { now - 30 * 60_000 }
    val windowEnd = remember(now) { now + 24 * 3_600_000 }

    Column(Modifier.fillMaxSize()) {

        // ------------------------------------------------------------- bar
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(
                start = Aurum.OverscanH, end = Aurum.OverscanH, top = 10.dp, bottom = 14.dp
            )
        ) {
            Column(Modifier.weight(1f)) {
                Text("TV Guide", color = Aurum.Text, style = MaterialTheme.typography.headlineLarge)
                Text(
                    "${dayLabel(now)}  ·  ${ui.epgMatched} of ${repo.channels.size} channels matched",
                    color = Aurum.Text3,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            TvButton("Refresh guide", icon = AurumIcons.Refresh) { state.refreshEpg(force = true) }
        }

        // ------------------------------------------------------ category row
        Row(
            horizontalArrangement = Arrangement.spacedBy(9.dp),
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(start = Aurum.OverscanH, end = Aurum.OverscanH, bottom = 14.dp)
        ) {
            TvChip("All", category == Repository.ALL, trailing = repo.channels.size.toString()) {
                category = Repository.ALL
            }
            TvChip("Favourites", category == Repository.FAVOURITES) { category = Repository.FAVOURITES }
            repo.liveCategories.forEach { cat ->
                TvChip(cat.name, category == cat.id) { category = cat.id }
            }
        }

        // ------------------------------------------------------------ lanes
        if (channels.isEmpty()) {
            EmptyState(AurumIcons.Guide, "No channels here", "Pick another category.")
        } else {
            LazyColumn(
                contentPadding = PaddingValues(bottom = Aurum.OverscanV),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(channels, key = { it.streamId }) { channel ->
                    GuideLane(
                        state = state,
                        channel = channel,
                        programmes = remember(channel.streamId, now) {
                            state.repo.epg.inWindow(channel.streamId, windowStart, windowEnd)
                        },
                        now = now,
                        onProgramme = { programme -> selected = channel to programme },
                        onPlay = { state.playChannel(channel, channels) }
                    )
                }
            }
        }
    }

    selected?.let { (channel, programme) ->
        ProgrammeSheet(
            channel = channel,
            programme = programme,
            now = now,
            onWatch = {
                selected = null
                state.playChannel(channel, channels)
            },
            onDismiss = { selected = null }
        )
    }
}

@Composable
private fun GuideLane(
    state: AppState,
    channel: Channel,
    programmes: List<Programme>,
    now: Long,
    onProgramme: (Programme) -> Unit,
    onPlay: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().height(76.dp)
    ) {
        // channel plate
        var channelFocused by remember { mutableStateOf(false) }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .padding(start = Aurum.OverscanH, end = 10.dp)
                .width(230.dp)
                .fillMaxHeight()
                .clip(RoundedCornerShape(10.dp))
                .background(if (channelFocused) Aurum.Accent else Aurum.Glass)
                .onFocusChangedCompat { channelFocused = it }
                .focusable()
                .clickable { onPlay() }
                .padding(horizontal = 12.dp)
        ) {
            Text(
                channel.number.toString(),
                color = if (channelFocused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.width(34.dp)
            )
            Text(
                tidyChannelName(channel.name),
                color = if (channelFocused) Aurum.AccentInk else Aurum.Text1,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        // programme lane
        if (programmes.isEmpty()) {
            Box(
                contentAlignment = Alignment.CenterStart,
                modifier = Modifier
                    .fillMaxHeight()
                    .weight(1f)
                    .padding(end = Aurum.OverscanH)
                    .clip(RoundedCornerShape(10.dp))
                    .border(BorderStroke(1.dp, Aurum.Border), RoundedCornerShape(10.dp))
                    .padding(horizontal = 16.dp)
            ) {
                Text("No guide data for this channel", color = Aurum.Text4, fontSize = 13.sp)
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .fillMaxHeight()
                    .weight(1f)
                    .horizontalScroll(rememberScrollState())
                    .padding(end = Aurum.OverscanH)
            ) {
                programmes.forEach { programme ->
                    ProgrammeBlock(programme, now) { onProgramme(programme) }
                }
            }
        }
    }
}

@Composable
private fun ProgrammeBlock(programme: Programme, now: Long, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val onAir = programme.start <= now && programme.end > now
    val past = programme.end <= now

    val minutes = ((programme.end - programme.start) / 60_000f).coerceAtLeast(10f)
    val width: Dp = (minutes / MINUTES_PER_DP).dp.coerceIn(120.dp, 520.dp)

    Box(
        modifier = Modifier
            .width(width)
            .fillMaxHeight()
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    focused -> Aurum.Accent
                    onAir -> Aurum.AccentSoft
                    else -> Aurum.Glass
                }
            )
            .border(
                BorderStroke(1.dp, if (focused) Aurum.AccentBright else if (onAir) Aurum.Accent.copy(alpha = 0.4f) else Aurum.Border),
                RoundedCornerShape(10.dp)
            )
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
    ) {
        // elapsed shading for the programme currently on air
        if (onAir && !focused) {
            val progress = ((now - programme.start).toFloat() / (programme.end - programme.start)).coerceIn(0f, 1f)
            Box(
                Modifier
                    .fillMaxWidth(progress)
                    .fillMaxHeight()
                    .background(Aurum.Accent.copy(alpha = 0.10f))
            )
        }

        Column(
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp)
        ) {
            Text(
                programme.title,
                color = when {
                    focused -> Aurum.AccentInk
                    past -> Aurum.Text4
                    onAir -> Aurum.AccentBright
                    else -> Aurum.Text1
                },
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${timeOfDay(programme.start)} – ${timeOfDay(programme.end)}",
                color = if (focused) Aurum.AccentInk.copy(alpha = 0.65f) else Aurum.Text4,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun ProgrammeSheet(
    channel: Channel,
    programme: Programme,
    now: Long,
    onWatch: () -> Unit,
    onDismiss: () -> Unit
) {
    val onAir = programme.start <= now && programme.end > now
    val minutes = ((programme.end - programme.start) / 60_000).toInt()

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xC4000000))
            .clickable { onDismiss() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .widthIn(max = 760.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Aurum.Raised)
                .border(BorderStroke(1.dp, Aurum.BorderStrong), RoundedCornerShape(20.dp))
                .padding(36.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onAir) Badge("ON NOW", tone = Aurum.Live, live = true)
                else Badge(dayLabel(programme.start), tone = Aurum.Text3)
                Badge("$minutes min", tone = Aurum.Text3)
                programme.category?.let { Badge(it, tone = Aurum.Accent) }
            }
            Text(programme.title, color = Aurum.Text, style = MaterialTheme.typography.headlineLarge)
            Text(
                "${tidyChannelName(channel.name)}  ·  ${timeOfDay(programme.start)} – ${timeOfDay(programme.end)}",
                color = Aurum.Text3,
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                programme.description ?: "No description was supplied for this programme.",
                color = Aurum.Text2,
                style = MaterialTheme.typography.bodyLarge
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                TvButton(if (onAir) "Watch now" else "Go to channel", icon = AurumIcons.Play, primary = true, onClick = onWatch)
                TvButton("Close", onClick = onDismiss)
            }
        }
    }
}

@Composable
private fun GuidePrompt(state: AppState, loading: Boolean, progress: Int, progressText: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(Aurum.OverscanH)
    ) {
        EmptyState(
            icon = AurumIcons.Guide,
            title = if (loading) "Building your guide…" else "The TV guide is not loaded yet",
            message = if (loading) progressText
            else "Aurum downloads the full XMLTV guide from your provider and indexes it on this device. It is usually 20–150 MB; on a Fire TV Stick allow a minute or two the first time.",
            action = {
                if (loading) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        LinearProgressIndicator(
                            progress = { progress / 100f },
                            color = Aurum.Accent,
                            trackColor = Aurum.Panel,
                            modifier = Modifier.width(420.dp).height(6.dp).clip(RoundedCornerShape(3.dp))
                        )
                        Spacer(Modifier.height(10.dp))
                        Text("$progress%", color = Aurum.Text3, fontSize = 13.sp)
                    }
                } else {
                    TvButton("Download TV guide", icon = AurumIcons.Download, primary = true) {
                        state.refreshEpg(force = true)
                    }
                }
            }
        )
    }
}
