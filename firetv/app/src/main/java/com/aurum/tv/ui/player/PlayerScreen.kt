package com.aurum.tv.ui.player

import android.view.KeyEvent
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.aurum.tv.data.XtreamClient
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.PlaybackRequest
import com.aurum.tv.ui.components.Badge
import com.aurum.tv.ui.components.onFocusChangedCompat
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.clock
import com.aurum.tv.util.tidyChannelName
import com.aurum.tv.util.timeOfDay
import kotlinx.coroutines.delay

/*
 * The player is the whole point of the app, so it gets first-class remote
 * handling:
 *
 *   select / play-pause  toggle controls, then play/pause
 *   left / right         seek 10s (VOD) or nudge the live buffer
 *   up / down            zap channels (live) or move through the controls
 *   menu                 quality / audio / subtitle picker
 *   back                 close the picker, then the controls, then the player
 */

private const val CONTROLS_TIMEOUT_MS = 4500L

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(state: AppState, request: PlaybackRequest) {
    val context = LocalContext.current

    var controlsVisible by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf(PlayerMenu.NONE) }
    var isPlaying by remember { mutableStateOf(false) }
    var isBuffering by remember { mutableStateOf(true) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var error by remember { mutableStateOf<String?>(null) }
    var tracks by remember { mutableStateOf<Tracks?>(null) }
    var videoLabel by remember { mutableStateOf("Auto") }
    var zapOverlay by remember { mutableStateOf(false) }
    var showZapList by remember { mutableStateOf(false) }
    var showStats by remember { mutableStateOf(false) }
    var statsLine by remember { mutableStateOf("") }

    val trackSelector = remember {
        DefaultTrackSelector(context).apply {
            val preferred = state.prefs.settings.preferredQuality
            if (preferred > 0) {
                setParameters(buildUponParameters().setMaxVideoSize(Int.MAX_VALUE, preferred))
            }
        }
    }

    val exoPlayer = remember {
        val userAgent = state.prefs.settings.userAgent
        // OkHttp so the provider sees the same User-Agent as the catalogue calls;
        // plenty of panels reject anything that does not look like a known player.
        val httpFactory = OkHttpDataSource.Factory(XtreamClient.http)
            .setUserAgent(userAgent)
            .setDefaultRequestProperties(mapOf("Accept" to "*/*"))

        val dataSourceFactory = DefaultDataSource.Factory(context, httpFactory)

        val bufferMs = state.prefs.settings.bufferSeconds * 1000
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                bufferMs.coerceAtLeast(15_000),
                (bufferMs * 2).coerceAtLeast(50_000),
                if (request.isLive) 2_000 else 2_500,
                if (request.isLive) 4_000 else 5_000
            )
            .build()

        ExoPlayer.Builder(context)
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setRenderersFactory(
                DefaultRenderersFactory(context)
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                    .setEnableDecoderFallback(true)
            )
            .build()
            .apply { playWhenReady = true }
    }

    // ------------------------------------------------------- load the item
    LaunchedEffect(request.url) {
        error = null
        isBuffering = true
        val item = MediaItem.Builder()
            .setUri(request.url)
            .apply {
                // Help ExoPlayer pick the HLS extractor when the URL has no extension.
                if (request.url.contains(".m3u8")) setMimeType(androidx.media3.common.MimeTypes.APPLICATION_M3U8)
            }
            .build()

        exoPlayer.setMediaItem(item, if (request.resumeFrom > 30_000) request.resumeFrom else C.TIME_UNSET)
        exoPlayer.prepare()
        exoPlayer.play()

        if (request.isLive) {
            zapOverlay = true
            delay(3500)
            zapOverlay = false
        }
    }

    // --------------------------------------------------------- player events
    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                isBuffering = playbackState == Player.STATE_BUFFERING
                if (playbackState == Player.STATE_READY) error = null
                if (playbackState == Player.STATE_ENDED) {
                    state.clearProgressForCurrent()
                    if (!state.advanceToNext()) state.stopPlayback()
                }
            }

            override fun onTracksChanged(newTracks: Tracks) {
                tracks = newTracks
                videoLabel = currentVideoLabel(newTracks)
            }

            override fun onPlayerError(e: PlaybackException) {
                error = describeError(e, request)
            }
        }
        exoPlayer.addListener(listener)
        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    // ------------------------------------------------------------- ticking
    LaunchedEffect(Unit) {
        while (true) {
            position = exoPlayer.currentPosition.coerceAtLeast(0)
            duration = exoPlayer.duration.let { if (it == C.TIME_UNSET) 0 else it }
            if (showStats) {
                val format = exoPlayer.videoFormat
                statsLine = buildString {
                    append(format?.let { "${it.width}×${it.height}" } ?: "—")
                    format?.bitrate?.takeIf { it > 0 }?.let { append("  ·  ${it / 1000} kbps") }
                    format?.codecs?.let { append("  ·  $it") }
                    append("  ·  buffer ${exoPlayer.totalBufferedDuration / 1000}s")
                }
            }
            if (!request.isLive && duration > 0) state.saveProgress(position, duration)
            delay(1000)
        }
    }

    // -------------------------------------------------- auto-hide the chrome
    LaunchedEffect(controlsVisible, menu, isPlaying) {
        if (controlsVisible && menu == PlayerMenu.NONE && isPlaying) {
            delay(CONTROLS_TIMEOUT_MS)
            controlsVisible = false
        }
    }

    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    val wake = {
        controlsVisible = true
    }

    // ------------------------------------------------------------- surface
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { keyEvent ->
                if (keyEvent.type != KeyEventType.KeyDown) return@onKeyEvent false
                handleKey(
                    keyCode = keyEvent.nativeKeyEvent.keyCode,
                    request = request,
                    player = exoPlayer,
                    state = state,
                    menu = menu,
                    controlsVisible = controlsVisible,
                    showZapList = showZapList,
                    onWake = wake,
                    onToggleControls = { controlsVisible = !controlsVisible },
                    onMenu = { menu = it },
                    onZapList = { showZapList = it },
                    onZapFlash = { zapOverlay = true }
                )
            }
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    player = exoPlayer
                    resizeMode = when (state.prefs.settings.surfaceMode) {
                        "fill" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                        else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                    }
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setKeepContentOnPlayerReset(true)
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // ----------------------------------------------------------- states
        if (isBuffering && error == null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.align(Alignment.Center)
            ) {
                CircularProgressIndicator(color = Aurum.Accent, strokeWidth = 3.dp, modifier = Modifier.size(46.dp))
                Spacer(Modifier.height(14.dp))
                Text(
                    if (request.isLive) "Tuning in…" else "Loading…",
                    color = Color.White.copy(alpha = 0.75f),
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }

        error?.let { message ->
            PlaybackErrorPanel(
                message = message,
                canSwitchFormat = request.isLive,
                onRetry = {
                    error = null
                    exoPlayer.prepare()
                    exoPlayer.play()
                },
                onSwitchFormat = {
                    val next = state.switchLiveFormat()
                    error = null
                    state.showToast("Switched to ${if (next == "ts") "MPEG-TS" else "HLS"}")
                },
                onClose = { state.stopPlayback() }
            )
        }

        // ---------------------------------------------------- channel banner
        AnimatedVisibility(
            visible = zapOverlay && request.isLive,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopStart).padding(Aurum.OverscanH, Aurum.OverscanV + 40.dp)
        ) {
            ZapBanner(request)
        }

        if (showStats) {
            Text(
                statsLine,
                color = Aurum.Accent,
                fontSize = 12.sp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(Aurum.OverscanH, Aurum.OverscanV + 40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xCC000000))
                    .padding(horizontal = 14.dp, vertical = 9.dp)
            )
        }

        // --------------------------------------------------------- controls
        AnimatedVisibility(
            visible = controlsVisible && error == null,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            PlayerChrome(
                request = request,
                isPlaying = isPlaying,
                position = position,
                duration = duration,
                videoLabel = videoLabel,
                onTogglePlay = { if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play() },
                onMenu = { menu = it },
                onZapList = { showZapList = true },
                onStats = { showStats = !showStats },
                onClose = { state.stopPlayback() }
            )
        }

        // ------------------------------------------------------------ menus
        if (menu != PlayerMenu.NONE) {
            TrackMenu(
                menu = menu,
                tracks = tracks,
                player = exoPlayer,
                trackSelector = trackSelector,
                request = request,
                state = state,
                onApplied = { label -> if (menu == PlayerMenu.VIDEO) videoLabel = label },
                onDismiss = { menu = PlayerMenu.NONE }
            )
        }

        if (showZapList && request.isLive) {
            ZapList(
                request = request,
                onPick = { index ->
                    showZapList = false
                    state.playChannel(request.playlist[index], request.playlist)
                    zapOverlay = true
                },
                onDismiss = { showZapList = false }
            )
        }
    }
}

// ------------------------------------------------------------------ remote

private fun handleKey(
    keyCode: Int,
    request: PlaybackRequest,
    player: ExoPlayer,
    state: AppState,
    menu: PlayerMenu,
    controlsVisible: Boolean,
    showZapList: Boolean,
    onWake: () -> Unit,
    onToggleControls: () -> Unit,
    onMenu: (PlayerMenu) -> Unit,
    onZapList: (Boolean) -> Unit,
    onZapFlash: () -> Unit
): Boolean {
    // Let the overlays own the D-pad while they are up.
    if (menu != PlayerMenu.NONE || showZapList) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onMenu(PlayerMenu.NONE)
            onZapList(false)
            return true
        }
        return false
    }

    return when (keyCode) {
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_BUTTON_A -> {
            if (controlsVisible) {
                if (player.isPlaying) player.pause() else player.play()
            } else {
                onToggleControls()
            }
            onWake()
            true
        }

        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
            if (player.isPlaying) player.pause() else player.play()
            onWake()
            true
        }

        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
            if (!request.isLive) player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0))
            else player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0))
            onWake()
            true
        }

        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
            if (request.isLive) player.seekToDefaultPosition() // jump back to the live edge
            else {
                val target = player.currentPosition + 10_000
                val limit = player.duration
                player.seekTo(if (limit > 0) target.coerceAtMost(limit - 1000) else target)
            }
            onWake()
            true
        }

        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
            if (request.isLive && state.prefs.settings.zapOnDpad && !controlsVisible) {
                state.zap(-1); onZapFlash(); true
            } else {
                onWake(); false
            }
        }

        KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
            if (request.isLive && state.prefs.settings.zapOnDpad && !controlsVisible) {
                state.zap(1); onZapFlash(); true
            } else {
                onWake(); false
            }
        }

        KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_BUTTON_Y -> {
            onMenu(PlayerMenu.VIDEO)
            true
        }

        KeyEvent.KEYCODE_INFO -> {
            onWake()
            true
        }

        KeyEvent.KEYCODE_MEDIA_NEXT -> {
            if (request.isLive) { state.zap(1); onZapFlash() }
            true
        }

        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
            if (request.isLive) { state.zap(-1); onZapFlash() }
            true
        }

        else -> false
    }
}

// ------------------------------------------------------------------ chrome

@Composable
private fun PlayerChrome(
    request: PlaybackRequest,
    isPlaying: Boolean,
    position: Long,
    duration: Long,
    videoLabel: String,
    onTogglePlay: () -> Unit,
    onMenu: (PlayerMenu) -> Unit,
    onZapList: () -> Unit,
    onStats: () -> Unit,
    onClose: () -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        // top scrim + titles
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color(0xE6000000), Color.Transparent)))
                .padding(horizontal = Aurum.OverscanH, vertical = Aurum.OverscanV)
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        request.title,
                        color = Color.White,
                        style = MaterialTheme.typography.headlineMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (request.isLive) Badge("LIVE", tone = Aurum.Live, live = true)
                }
                if (request.subtitle.isNotEmpty()) {
                    Text(
                        request.subtitle,
                        color = Color.White.copy(alpha = 0.65f),
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Text(timeOfDay(System.currentTimeMillis()), color = Color.White.copy(alpha = 0.6f), fontSize = 15.sp)
        }

        Spacer(Modifier.weight(1f))

        // bottom scrim, progress and buttons
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xF2000000))))
                .padding(horizontal = Aurum.OverscanH, vertical = Aurum.OverscanV)
        ) {
            if (!request.isLive && duration > 0) {
                val progress = (position.toFloat() / duration).coerceIn(0f, 1f)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(Color.White.copy(alpha = 0.22f))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(progress)
                            .fillMaxHeight()
                            .background(Aurum.AccentGradient)
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth()) {
                    Text(clock(position), color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp)
                    Spacer(Modifier.weight(1f))
                    Text("−${clock(duration - position)}", color = Color.White.copy(alpha = 0.55f), fontSize = 14.sp)
                    Spacer(Modifier.width(14.dp))
                    Text(clock(duration), color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp)
                }
                Spacer(Modifier.height(16.dp))
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PlayerAction(if (isPlaying) AurumIcons.Pause else AurumIcons.Play, if (isPlaying) "Pause" else "Play", onTogglePlay)
                PlayerAction(AurumIcons.Sliders, videoLabel) { onMenu(PlayerMenu.VIDEO) }
                PlayerAction(AurumIcons.Audio, "Audio") { onMenu(PlayerMenu.AUDIO) }
                PlayerAction(AurumIcons.Subtitles, "Subtitles") { onMenu(PlayerMenu.TEXT) }
                if (request.isLive && request.playlist.size > 1) {
                    PlayerAction(AurumIcons.List, "Channels", onZapList)
                }
                PlayerAction(AurumIcons.Info, "Stats", onStats)
                Spacer(Modifier.weight(1f))
                Text(
                    if (request.isLive) "▲▼ change channel   ◀▶ 10s   MENU quality"
                    else "◀▶ skip 10s   MENU quality   BACK exit",
                    color = Color.White.copy(alpha = 0.35f),
                    fontSize = 12.sp
                )
            }
        }
    }
}

@Composable
private fun PlayerAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (focused) Aurum.Accent else Color.White.copy(alpha = 0.12f))
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 11.dp)
    ) {
        Icon(icon, label, tint = if (focused) Aurum.AccentInk else Color.White, modifier = Modifier.size(19.dp))
        Text(
            label,
            color = if (focused) Aurum.AccentInk else Color.White,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1
        )
    }
}

@Composable
private fun ZapBanner(request: PlaybackRequest) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xCC000000))
            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)), RoundedCornerShape(16.dp))
            .padding(horizontal = 22.dp, vertical = 16.dp)
    ) {
        val channel = request.playlist.getOrNull(request.playlistIndex)
        Text(
            (channel?.number ?: 0).toString(),
            color = Aurum.Accent,
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold
        )
        Column {
            Text(request.title, color = Color.White, style = MaterialTheme.typography.titleLarge)
            if (request.subtitle.isNotEmpty()) {
                Text(request.subtitle, color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ZapList(request: PlaybackRequest, onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    val listState = rememberLazyListState()
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        if (request.playlistIndex >= 0) listState.scrollToItem(request.playlistIndex.coerceAtLeast(0))
        runCatching { focusRequester.requestFocus() }
    }

    Box(Modifier.fillMaxSize().background(Color(0x99000000)).clickable { onDismiss() }) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(vertical = Aurum.OverscanV),
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .width(420.dp)
                .background(Color(0xF20A0C11))
                .border(BorderStroke(1.dp, Aurum.BorderStrong))
        ) {
            itemsIndexed(request.playlist) { index, channel ->
                var focused by remember { mutableStateOf(false) }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 3.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            when {
                                focused -> Aurum.Accent
                                index == request.playlistIndex -> Aurum.AccentSoft
                                else -> Color.Transparent
                            }
                        )
                        .then(if (index == 0) Modifier.focusRequester(focusRequester) else Modifier)
                        .onFocusChangedCompat { focused = it }
                        .focusable()
                        .clickable { onPick(index) }
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                ) {
                    Text(
                        channel.number.toString(),
                        color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
                        fontSize = 13.sp,
                        modifier = Modifier.width(38.dp)
                    )
                    Text(
                        tidyChannelName(channel.name),
                        color = if (focused) Aurum.AccentInk else Aurum.Text1,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
private fun PlaybackErrorPanel(
    message: String,
    canSwitchFormat: Boolean,
    onRetry: () -> Unit,
    onSwitchFormat: () -> Unit,
    onClose: () -> Unit
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    Box(Modifier.fillMaxSize().background(Color(0xE6000000)), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier.widthIn(max = 660.dp).padding(40.dp)
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(70.dp)
                    .clip(CircleShape)
                    .background(Color(0x1FF87171))
                    .border(BorderStroke(1.dp, Color(0x4DF87171)), CircleShape)
            ) {
                Icon(AurumIcons.Alert, null, tint = Aurum.Bad, modifier = Modifier.size(30.dp))
            }
            Text("Playback failed", color = Aurum.Text, style = MaterialTheme.typography.headlineMedium)
            Text(
                message,
                color = Aurum.Text2,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                com.aurum.tv.ui.components.TvButton(
                    "Try again",
                    primary = true,
                    modifier = Modifier.focusRequester(focusRequester),
                    onClick = onRetry
                )
                if (canSwitchFormat) {
                    com.aurum.tv.ui.components.TvButton("Switch stream format", onClick = onSwitchFormat)
                }
                com.aurum.tv.ui.components.TvButton("Close", onClick = onClose)
            }
        }
    }
}

// ------------------------------------------------------------- error copy

@OptIn(UnstableApi::class)
private fun describeError(e: PlaybackException, request: PlaybackRequest): String {
    val cause = e.cause
    return when {
        cause is androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException -> when (cause.responseCode) {
            401, 403 -> "Access denied (${cause.responseCode}). Your line may be blocked, expired, or already at its connection limit."
            404 -> "This stream no longer exists on the server (404)."
            else -> "The server refused the stream (${cause.responseCode})."
        }
        cause is androidx.media3.datasource.HttpDataSource.HttpDataSourceException ->
            "Could not reach the stream. Check your network, or the provider may be down."
        e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            e.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ->
            "This Fire TV cannot decode this stream (often HEVC/H.265 or AC-3 audio on older sticks). Try another version of the channel."
        e.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED ->
            if (request.isLive) "The stream data was malformed. Try switching the stream format below."
            else "This file appears to be damaged or in an unsupported container."
        e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            "The stream timed out. The provider may be overloaded."
        else -> e.message ?: "The stream could not be played."
    }
}

@OptIn(UnstableApi::class)
private fun currentVideoLabel(tracks: Tracks): String {
    for (group in tracks.groups) {
        if (group.type != C.TRACK_TYPE_VIDEO) continue
        for (i in 0 until group.length) {
            if (group.isTrackSelected(i)) {
                val height = group.getTrackFormat(i).height
                if (height > 0) return "${height}p"
            }
        }
    }
    return "Auto"
}
