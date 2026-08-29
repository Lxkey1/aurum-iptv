package com.aurum.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.ui.components.LoadingState
import com.aurum.tv.ui.components.onFocusChangedCompat
import com.aurum.tv.ui.player.PlayerScreen
import com.aurum.tv.ui.screens.*
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.formatCount
import com.aurum.tv.util.initials
import kotlinx.coroutines.delay

private data class NavItem(val screen: Screen, val label: String, val icon: ImageVector)

private val NAV = listOf(
    NavItem(Screen.Home, "Home", AurumIcons.Home),
    NavItem(Screen.Live, "Live TV", AurumIcons.Tv),
    NavItem(Screen.Guide, "TV Guide", AurumIcons.Guide),
    NavItem(Screen.Movies, "Films", AurumIcons.Film),
    NavItem(Screen.SeriesList, "Box sets", AurumIcons.SeriesIcon),
    NavItem(Screen.Search, "Search", AurumIcons.Search),
    NavItem(Screen.Settings, "Settings", AurumIcons.Settings)
)

@Composable
fun AurumRoot(state: AppState, onExit: () -> Unit) {
    val ui by state.ui.collectAsState()
    val playback by state.playback.collectAsState()

    // The player owns the whole screen and its own key handling.
    if (playback != null) {
        BackHandler { state.stopPlayback() }
        PlayerScreen(state, playback!!)
        return
    }

    BackHandler { if (!state.back()) onExit() }

    when (val screen = ui.screen) {
        is Screen.Boot -> LoadingState(ui.loadingText.ifEmpty { "Starting Aurum…" })

        is Screen.Login -> LoginScreen(state, ui.error, ui.loading)

        else -> Row(Modifier.fillMaxSize().background(Aurum.Base)) {
            Sidebar(state, ui)
            Box(Modifier.weight(1f).fillMaxHeight()) {
                when (screen) {
                    is Screen.Home -> HomeScreen(state, ui.revision)
                    is Screen.Live -> LiveScreen(state, ui.revision)
                    is Screen.Guide -> GuideScreen(state, ui.revision)
                    is Screen.Movies -> MoviesScreen(state, ui.revision)
                    is Screen.SeriesList -> SeriesScreen(state, ui.revision)
                    is Screen.Search -> SearchScreen(state, ui.revision)
                    is Screen.Settings -> SettingsScreen(state, ui.revision)
                    is Screen.MovieDetail -> MovieDetailScreen(state, screen.movie)
                    is Screen.SeriesDetail -> SeriesDetailScreen(state, screen.series)
                    else -> Unit
                }
            }
        }
    }

    // transient messages
    ui.toast?.let { message ->
        LaunchedEffect(message) {
            delay(3200)
            state.showToast(null)
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Text(
                message,
                color = Aurum.AccentInk,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier
                    .padding(bottom = Aurum.OverscanV + 20.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Aurum.Accent)
                    .padding(horizontal = 24.dp, vertical = 12.dp)
            )
        }
    }
}

/**
 * Collapsed to icons until something inside it takes focus, which is the
 * standard Android TV pattern and keeps the content area as wide as possible.
 */
@Composable
private fun Sidebar(state: AppState, ui: UiState) {
    var expanded by remember { mutableStateOf(false) }
    val width by animateDpAsState(if (expanded) 268.dp else 96.dp, tween(200), label = "sidebar")

    Column(
        horizontalAlignment = Alignment.Start,
        modifier = Modifier
            .width(width)
            .fillMaxHeight()
            .background(
                Brush.horizontalGradient(listOf(Color(0xFF0D1017), Aurum.Base))
            )
            .onFocusChangedCompat { expanded = it }
            .padding(vertical = Aurum.OverscanV, horizontal = 16.dp)
    ) {
        // brand
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(start = 8.dp, bottom = 34.dp)
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Aurum.AccentGradient)
            ) {
                Icon(AurumIcons.Play, null, tint = Aurum.AccentInk, modifier = Modifier.size(18.dp))
            }
            if (expanded) {
                Column {
                    Text("Aurum", color = Aurum.Text, style = MaterialTheme.typography.titleLarge)
                    Text("TV", color = Aurum.Text4, fontSize = 10.sp, letterSpacing = 2.sp)
                }
            }
        }

        NAV.forEach { item ->
            val badge = when (item.screen) {
                Screen.Live -> state.repo.channels.size
                Screen.Movies -> state.repo.movies.size
                Screen.SeriesList -> state.repo.series.size
                else -> 0
            }
            NavRow(
                item = item,
                expanded = expanded,
                selected = ui.screen::class == item.screen::class,
                badge = if (badge > 0) formatCount(badge) else null,
                onClick = { state.navigate(item.screen) }
            )
        }

        Spacer(Modifier.weight(1f))

        // account chip
        val account = ui.account
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
            modifier = Modifier.padding(start = 8.dp)
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(Aurum.AccentGradient)
            ) {
                Text(
                    initials(account?.username ?: "?"),
                    color = Aurum.AccentInk,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            if (expanded && account != null) {
                Column {
                    Text(
                        account.username,
                        color = Aurum.Text1,
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(account.status, color = Aurum.Text4, fontSize = 11.sp)
                }
            }
        }

        if (ui.epgLoading && expanded) {
            Text(
                ui.epgProgressText,
                color = Aurum.Text4,
                fontSize = 10.sp,
                maxLines = 2,
                modifier = Modifier.padding(top = 12.dp, start = 8.dp)
            )
        }
    }
}

@Composable
private fun NavRow(
    item: NavItem,
    expanded: Boolean,
    selected: Boolean,
    badge: String?,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .clip(RoundedCornerShape(12.dp))
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
            .padding(horizontal = 14.dp, vertical = 13.dp)
    ) {
        Icon(
            item.icon,
            item.label,
            tint = when {
                focused -> Aurum.AccentInk
                selected -> Aurum.AccentBright
                else -> Aurum.Text3
            },
            modifier = Modifier.size(22.dp)
        )
        if (expanded) {
            Text(
                item.label,
                color = when {
                    focused -> Aurum.AccentInk
                    selected -> Aurum.AccentBright
                    else -> Aurum.Text2
                },
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                modifier = Modifier.weight(1f)
            )
            if (badge != null) {
                Text(
                    badge,
                    color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
                    fontSize = 11.sp
                )
            }
        }
    }
}
