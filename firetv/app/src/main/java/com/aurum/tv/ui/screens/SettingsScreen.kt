package com.aurum.tv.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.data.XtreamClient
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.ExpiryTone
import com.aurum.tv.util.expiryLabel
import com.aurum.tv.util.formatCount

private val USER_AGENTS = listOf(
    "VLC/3.0.20 LibVLC/3.0.20" to "VLC",
    "Lavf/60.16.100" to "FFmpeg",
    "IPTVSmarters/1.0" to "Smarters",
    "TiviMate/4.7.0 (Android)" to "TiviMate",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" to "Chrome"
)

@Composable
fun SettingsScreen(state: AppState, revision: Int) {
    val ui by state.ui.collectAsState()
    val prefs = state.prefs
    var settings by remember(revision) { mutableStateOf(prefs.settings) }
    var confirmSignOut by remember { mutableStateOf(false) }

    LazyColumn(
        contentPadding = PaddingValues(
            start = Aurum.OverscanH,
            end = Aurum.OverscanH,
            top = 10.dp,
            bottom = Aurum.OverscanV + 40.dp
        ),
        verticalArrangement = Arrangement.spacedBy(22.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Column {
                Text("Settings", color = Aurum.Text, style = MaterialTheme.typography.headlineLarge)
                Text("Aurum TV 1.0.0", color = Aurum.Text3, style = MaterialTheme.typography.bodyMedium)
            }
        }

        // ------------------------------------------------------------ account
        item {
            val account = ui.account
            SettingsCard("Account", AurumIcons.Logout) {
                if (account == null) {
                    Text("Not signed in.", color = Aurum.Text3)
                } else {
                    val (expiry, tone) = expiryLabel(account.expiresAt)
                    FlowStats(
                        listOf(
                            "Username" to account.username,
                            "Status" to account.status,
                            "Expires" to expiry,
                            "Connections" to "${account.activeConnections} of ${account.maxConnections}",
                            "Server" to account.host.removePrefix("http://").removePrefix("https://"),
                            "Timezone" to account.timezone.ifEmpty { "—" }
                        ),
                        toneFor = { label ->
                            when {
                                label == "Expires" && tone == ExpiryTone.BAD -> Aurum.Bad
                                label == "Expires" && tone == ExpiryTone.WARN -> Aurum.Warn
                                label == "Status" && account.status.equals("Active", true) -> Aurum.Good
                                else -> Aurum.Text
                            }
                        }
                    )
                    Spacer(Modifier.height(18.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TvButton("Refresh catalogue", icon = AurumIcons.Refresh) {
                            state.loadCatalogue(force = true)
                        }
                        TvButton("Sign out", icon = AurumIcons.Logout, danger = true) {
                            confirmSignOut = true
                        }
                    }
                }
            }
        }

        // ----------------------------------------------------------- playback
        item {
            SettingsCard("Playback", AurumIcons.Play) {
                SettingRow(
                    "Live stream format",
                    "MPEG-TS works on nearly every line. HLS is worth trying if a channel stalls, and is the only format that exposes multiple quality levels."
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        TvChip("MPEG-TS", settings.liveFormat == "ts") {
                            settings = prefs.updateSettings { it.copy(liveFormat = "ts") }
                        }
                        TvChip("HLS", settings.liveFormat == "m3u8") {
                            settings = prefs.updateSettings { it.copy(liveFormat = "m3u8") }
                        }
                    }
                }

                SettingRow(
                    "Picture fit",
                    "How the video fills your screen. Fit keeps the original shape; Fill crops to remove black bars."
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        listOf("fit" to "Fit", "fill" to "Fill", "stretch" to "Stretch").forEach { (id, label) ->
                            TvChip(label, settings.surfaceMode == id) {
                                settings = prefs.updateSettings { it.copy(surfaceMode = id) }
                            }
                        }
                    }
                }

                SettingRow(
                    "Buffer size",
                    "A bigger buffer rides out weak Wi-Fi but takes longer to start. 30 seconds suits most Fire TV sticks."
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        listOf(15, 30, 60).forEach { seconds ->
                            TvChip("${seconds}s", settings.bufferSeconds == seconds) {
                                settings = prefs.updateSettings { it.copy(bufferSeconds = seconds) }
                            }
                        }
                    }
                }

                SettingRow(
                    "Channel zapping",
                    "Up and down on the remote change channel while a live stream is playing."
                ) {
                    TvChip(if (settings.zapOnDpad) "On" else "Off", settings.zapOnDpad) {
                        settings = prefs.updateSettings { it.copy(zapOnDpad = !it.zapOnDpad) }
                    }
                }

                SettingRow(
                    "Player identity",
                    "The User-Agent Aurum sends when fetching streams. Some providers only serve players they recognise."
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        USER_AGENTS.forEach { (ua, label) ->
                            TvChip(label, settings.userAgent == ua) {
                                settings = prefs.updateSettings { it.copy(userAgent = ua) }
                                state.repo.client.userAgent = ua
                            }
                        }
                    }
                }
            }
        }

        // --------------------------------------------------------------- EPG
        item {
            SettingsCard("TV guide", AurumIcons.Guide) {
                val stats = ui.epgStats
                Text(
                    when {
                        ui.epgLoading -> ui.epgProgressText
                        stats != null -> "${formatCount(stats.programmeCount)} programmes · " +
                            "${formatCount(stats.channelsWithData)} channels with data · " +
                            "${formatCount(ui.epgMatched)} matched to your line"
                        else -> "The guide has not been downloaded yet."
                    },
                    color = Aurum.Text2,
                    style = MaterialTheme.typography.bodyMedium
                )

                if (ui.epgLoading) {
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { ui.epgProgress / 100f },
                        color = Aurum.Accent,
                        trackColor = Aurum.Panel,
                        modifier = Modifier.fillMaxWidth(0.6f).height(6.dp).clip(RoundedCornerShape(3.dp))
                    )
                }

                Spacer(Modifier.height(16.dp))

                SettingRow(
                    "How far ahead to keep",
                    "A longer window uses more of the Fire TV's limited memory. Two days suits most people."
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        listOf(24, 48, 72).forEach { hours ->
                            TvChip("${hours / 24}d", settings.epgHoursForward == hours) {
                                settings = prefs.updateSettings { it.copy(epgHoursForward = hours) }
                            }
                        }
                    }
                }

                SettingRow("Load automatically at sign-in", "Downloads the guide in the background when Aurum starts.") {
                    TvChip(if (settings.epgAutoLoad) "On" else "Off", settings.epgAutoLoad) {
                        settings = prefs.updateSettings { it.copy(epgAutoLoad = !it.epgAutoLoad) }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                    TvButton(
                        if (ui.epgStats != null) "Update now" else "Download guide",
                        icon = AurumIcons.Download,
                        primary = true,
                        enabled = !ui.epgLoading
                    ) { state.refreshEpg(force = true) }

                    TvButton("Delete guide data", icon = AurumIcons.Trash, danger = true) { state.clearEpg() }
                }
            }
        }

        // ------------------------------------------------------------- start
        item {
            SettingsCard("Startup", AurumIcons.Home) {
                SettingRow("Open on", "Which screen Aurum shows when it starts.") {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        listOf(
                            "home" to "Home", "live" to "Live TV", "guide" to "Guide",
                            "movies" to "Films", "series" to "Box sets"
                        ).forEach { (id, label) ->
                            TvChip(label, settings.startScreen == id) {
                                settings = prefs.updateSettings { it.copy(startScreen = id) }
                            }
                        }
                    }
                }

                SettingRow("Clear watch history", "Forgets every part-watched film and episode. Favourites are kept.") {
                    TvButton("Clear", icon = AurumIcons.Trash, danger = true) {
                        prefs.clearProgress()
                        state.bumpRevision()
                        state.showToast("Watch history cleared")
                    }
                }
            }
        }

        // ------------------------------------------------------------- about
        item {
            SettingsCard("About & privacy", AurumIcons.Info) {
                Text(
                    "Aurum is a player only. It does not host, provide or resell any channels — everything you see comes from the Xtream Codes line you signed in with.",
                    color = Aurum.Text2,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    if (state.repo.secure.isHardwareBacked)
                        "Your password is sealed with this device's hardware keystore and never leaves it."
                    else
                        "This device predates the Android hardware keystore (Fire OS 5), so your password is only obfuscated on disk.",
                    color = Aurum.Text3,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(18.dp))
                Text("REMOTE CONTROL", color = Aurum.Text4, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                listOf(
                    "SELECT" to "Show controls, then play / pause",
                    "◀ ▶" to "Skip 10 seconds (live: back / jump to live)",
                    "▲ ▼" to "Change channel while a live stream plays",
                    "MENU" to "Quality, audio and subtitle picker",
                    "BACK" to "Close the overlay, then leave the player"
                ).forEach { (key, description) ->
                    Row(Modifier.padding(vertical = 3.dp)) {
                        Text(
                            key,
                            color = Aurum.Accent,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.width(100.dp)
                        )
                        Text(description, color = Aurum.Text2, fontSize = 13.sp)
                    }
                }
            }
        }
    }

    if (confirmSignOut) {
        ConfirmDialog(
            title = "Sign out?",
            message = "Your saved credentials, cached catalogue and downloaded TV guide will be removed from this device.",
            confirmLabel = "Sign out",
            onConfirm = {
                confirmSignOut = false
                state.signOut()
            },
            onDismiss = { confirmSignOut = false }
        )
    }
}

@Composable
private fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Aurum.Glass)
            .border(BorderStroke(1.dp, Aurum.Border), RoundedCornerShape(18.dp))
            .padding(26.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(bottom = 16.dp)
        ) {
            androidx.compose.material3.Icon(icon, null, tint = Aurum.Accent, modifier = Modifier.size(18.dp))
            Text(
                title.uppercase(),
                color = Aurum.Text3,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.6.sp
            )
        }
        content()
    }
}

@Composable
private fun SettingRow(label: String, description: String, control: @Composable () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
    ) {
        Column(Modifier.weight(1f).padding(end = 26.dp)) {
            Text(label, color = Aurum.Text1, style = MaterialTheme.typography.titleMedium)
            Text(
                description,
                color = Aurum.Text3,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
        control()
    }
}

@Composable
private fun FlowStats(stats: List<Pair<String, String>>, toneFor: (String) -> androidx.compose.ui.graphics.Color) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        stats.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(40.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { (label, value) ->
                    Column(Modifier.weight(1f)) {
                        Text(
                            label.uppercase(),
                            color = Aurum.Text4,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.2.sp
                        )
                        Text(
                            value,
                            color = toneFor(label),
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                        )
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    Box(
        Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xC4000000)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .widthIn(max = 560.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Aurum.Raised)
                .border(BorderStroke(1.dp, Aurum.BorderStrong), RoundedCornerShape(20.dp))
                .padding(34.dp)
        ) {
            Text(title, color = Aurum.Text, style = MaterialTheme.typography.headlineMedium)
            Text(message, color = Aurum.Text2, style = MaterialTheme.typography.bodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                TvButton(
                    confirmLabel,
                    danger = true,
                    modifier = Modifier.focusRequester(focusRequester),
                    onClick = onConfirm
                )
                TvButton("Cancel", onClick = onDismiss)
            }
        }
    }
}
