package com.aurum.tv.ui.player

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.PlaybackRequest
import com.aurum.tv.ui.components.onFocusChangedCompat
import com.aurum.tv.ui.theme.Aurum

enum class PlayerMenu { NONE, VIDEO, AUDIO, TEXT }

private data class MenuEntry(
    val label: String,
    val detail: String? = null,
    val selected: Boolean = false,
    val apply: () -> Unit
)

/**
 * Quality / audio / subtitle picker.
 *
 * Quality is driven through ExoPlayer's track selector: for an adaptive HLS
 * ladder this pins a specific rendition, and for a single-bitrate stream it
 * honestly reports that there is nothing to choose.
 */
@OptIn(UnstableApi::class)
@Composable
fun TrackMenu(
    menu: PlayerMenu,
    tracks: Tracks?,
    player: ExoPlayer,
    trackSelector: DefaultTrackSelector,
    request: PlaybackRequest,
    state: AppState,
    onApplied: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val title = when (menu) {
        PlayerMenu.VIDEO -> "Video quality"
        PlayerMenu.AUDIO -> "Audio track"
        PlayerMenu.TEXT -> "Subtitles"
        PlayerMenu.NONE -> return
    }

    val entries = remember(menu, tracks, request.url) {
        when (menu) {
            PlayerMenu.VIDEO -> videoEntries(tracks, trackSelector, state, onApplied, onDismiss)
            PlayerMenu.AUDIO -> audioEntries(tracks, trackSelector, onDismiss)
            PlayerMenu.TEXT -> textEntries(tracks, trackSelector, onDismiss)
            PlayerMenu.NONE -> emptyList()
        }
    }

    val extraNote = when {
        menu == PlayerMenu.VIDEO && entries.size <= 1 && request.isLive ->
            "This channel is delivered at a single bitrate, so there are no quality levels to choose from. Switching the live format to HLS in Settings sometimes exposes more."
        menu == PlayerMenu.VIDEO && entries.size <= 1 ->
            "This title is a single file, so its quality is fixed."
        menu == PlayerMenu.AUDIO && entries.size <= 1 ->
            "This stream carries a single audio track."
        menu == PlayerMenu.TEXT && entries.size <= 1 ->
            "No subtitle tracks were found. Xtream providers usually burn subtitles into the picture or supply separate language channels."
        else -> null
    }

    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(menu) { runCatching { focusRequester.requestFocus() } }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xA6000000))
            .clickable { onDismiss() }
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .width(440.dp)
                .background(Color(0xF50A0C11))
                .border(BorderStroke(1.dp, Aurum.BorderStrong))
                .padding(vertical = Aurum.OverscanV)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(horizontal = 26.dp, vertical = 8.dp)
            ) {
                Icon(
                    when (menu) {
                        PlayerMenu.VIDEO -> AurumIcons.Sliders
                        PlayerMenu.AUDIO -> AurumIcons.Audio
                        else -> AurumIcons.Subtitles
                    },
                    null, tint = Aurum.Accent, modifier = Modifier.size(20.dp)
                )
                Text(title, color = Aurum.Text, style = MaterialTheme.typography.titleLarge)
            }

            Spacer(Modifier.height(10.dp))

            LazyColumn(Modifier.weight(1f)) {
                itemsIndexed(entries) { index, entry ->
                    MenuRow(
                        entry = entry,
                        modifier = if (index == 0) Modifier.focusRequester(focusRequester) else Modifier
                    )
                }
            }

            if (extraNote != null) {
                Text(
                    extraNote,
                    color = Aurum.Text4,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(horizontal = 26.dp, vertical = 14.dp)
                )
            }

            Text(
                "BACK to close",
                color = Aurum.Text4,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 26.dp)
            )
        }
    }
}

@Composable
private fun MenuRow(entry: MenuEntry, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 3.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (focused) Aurum.Accent else Color.Transparent)
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { entry.apply() }
            .padding(horizontal = 14.dp, vertical = 13.dp)
    ) {
        Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
            if (entry.selected) {
                Icon(
                    AurumIcons.Check, null,
                    tint = if (focused) Aurum.AccentInk else Aurum.Accent,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
        Text(
            entry.label,
            color = when {
                focused -> Aurum.AccentInk
                entry.selected -> Aurum.AccentBright
                else -> Aurum.Text1
            },
            style = MaterialTheme.typography.titleMedium,
            fontWeight = if (entry.selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f)
        )
        if (entry.detail != null) {
            Text(
                entry.detail,
                color = if (focused) Aurum.AccentInk.copy(alpha = 0.65f) else Aurum.Text4,
                fontSize = 12.sp
            )
        }
    }
}

// ------------------------------------------------------------------ builders

@OptIn(UnstableApi::class)
private fun videoEntries(
    tracks: Tracks?,
    selector: DefaultTrackSelector,
    state: AppState,
    onApplied: (String) -> Unit,
    onDismiss: () -> Unit
): List<MenuEntry> {
    val entries = mutableListOf<MenuEntry>()
    val hasOverride = selector.parameters.overrides.keys.any { group ->
        group.type == C.TRACK_TYPE_VIDEO
    }

    entries += MenuEntry(
        label = "Auto",
        detail = "adapts to bandwidth",
        selected = !hasOverride,
        apply = {
            selector.setParameters(
                selector.buildUponParameters()
                    .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                    .setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
            )
            state.prefs.updateSettings { it.copy(preferredQuality = 0) }
            onApplied("Auto")
            onDismiss()
        }
    )

    val group = tracks?.groups?.firstOrNull { it.type == C.TRACK_TYPE_VIDEO } ?: return entries

    val rungs = (0 until group.length)
        .map { index -> index to group.getTrackFormat(index) }
        .filter { it.second.height > 0 }
        .sortedByDescending { it.second.height }

    for ((index, format) in rungs) {
        val label = "${format.height}p"
        entries += MenuEntry(
            label = label,
            detail = if (format.bitrate > 0) "${format.bitrate / 1000} kbps" else null,
            selected = hasOverride && group.isTrackSelected(index),
            apply = {
                selector.setParameters(
                    selector.buildUponParameters()
                        .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                )
                state.prefs.updateSettings { it.copy(preferredQuality = format.height) }
                onApplied(label)
                onDismiss()
            }
        )
    }
    return entries
}

@OptIn(UnstableApi::class)
private fun audioEntries(
    tracks: Tracks?,
    selector: DefaultTrackSelector,
    onDismiss: () -> Unit
): List<MenuEntry> {
    val entries = mutableListOf<MenuEntry>()
    val groups = tracks?.groups?.filter { it.type == C.TRACK_TYPE_AUDIO }.orEmpty()

    for (group in groups) {
        for (index in 0 until group.length) {
            val format = group.getTrackFormat(index)
            val language = format.language?.uppercase()
            val name = format.label ?: languageName(format.language) ?: "Track ${entries.size + 1}"
            val codec = listOfNotNull(
                format.codecs?.substringBefore('.')?.uppercase(),
                if (format.channelCount > 0) "${format.channelCount}ch" else null
            ).joinToString(" · ").ifEmpty { language }

            entries += MenuEntry(
                label = name,
                detail = codec,
                selected = group.isTrackSelected(index),
                apply = {
                    selector.setParameters(
                        selector.buildUponParameters()
                            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                    )
                    onDismiss()
                }
            )
        }
    }
    if (entries.isEmpty()) {
        entries += MenuEntry("Default audio", selected = true, apply = onDismiss)
    }
    return entries
}

@OptIn(UnstableApi::class)
private fun textEntries(
    tracks: Tracks?,
    selector: DefaultTrackSelector,
    onDismiss: () -> Unit
): List<MenuEntry> {
    val entries = mutableListOf<MenuEntry>()
    val groups = tracks?.groups?.filter { it.type == C.TRACK_TYPE_TEXT }.orEmpty()
    val anySelected = groups.any { group -> (0 until group.length).any { group.isTrackSelected(it) } }

    entries += MenuEntry(
        label = "Off",
        selected = !anySelected,
        apply = {
            selector.setParameters(
                selector.buildUponParameters()
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            )
            onDismiss()
        }
    )

    for (group in groups) {
        for (index in 0 until group.length) {
            val format = group.getTrackFormat(index)
            val name = format.label ?: languageName(format.language) ?: "Subtitle ${entries.size}"
            entries += MenuEntry(
                label = name,
                detail = format.language?.uppercase(),
                selected = group.isTrackSelected(index),
                apply = {
                    selector.setParameters(
                        selector.buildUponParameters()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
                    )
                    onDismiss()
                }
            )
        }
    }
    return entries
}

private fun languageName(code: String?): String? {
    if (code.isNullOrEmpty() || code == "und") return null
    return runCatching { java.util.Locale(code).displayLanguage }
        .getOrNull()
        ?.replaceFirstChar { it.uppercase() }
        ?.takeIf { it.isNotEmpty() && !it.equals(code, true) }
        ?: code.uppercase()
}
