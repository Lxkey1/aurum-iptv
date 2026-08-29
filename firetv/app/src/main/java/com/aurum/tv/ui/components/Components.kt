package com.aurum.tv.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.util.initials

/*
 * Every interactive element on a TV has to make its focus state unmistakable
 * from three metres away — there is no cursor and no touch. These components
 * all lift, brighten and outline in gold when focused.
 */

/** Primary action button. */
@Composable
fun TvButton(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, tween(140), label = "btnScale")

    val background = when {
        focused && primary -> Aurum.AccentBright
        focused -> Aurum.Accent
        primary -> Aurum.Accent
        danger -> Color(0x1FF87171)
        else -> Aurum.Glass
    }
    val content = when {
        focused || primary -> Aurum.AccentInk
        danger -> Aurum.Bad
        else -> Aurum.Text1
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier
            .scale(scale)
            .alpha(if (enabled) 1f else 0.4f)
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(
                BorderStroke(1.dp, if (focused) Aurum.AccentBright else Aurum.Border),
                RoundedCornerShape(12.dp)
            )
            .onFocusChangedCompat { focused = it }
            .focusable(enabled)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 22.dp, vertical = 13.dp)
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(20.dp))
        }
        Text(text, color = content, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/** Compact circular icon button. */
@Composable
fun TvIconButton(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.12f else 1f, tween(140), label = "iconScale")

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .scale(scale)
            .size(46.dp)
            .clip(CircleShape)
            .background(if (focused) Aurum.Accent else Aurum.Glass)
            .border(BorderStroke(1.dp, if (focused) Aurum.AccentBright else Aurum.Border), CircleShape)
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = when {
                focused -> Aurum.AccentInk
                active -> Aurum.Accent
                else -> Aurum.Text2
            },
            modifier = Modifier.size(21.dp)
        )
    }
}

/** Category / filter chip. */
@Composable
fun TvChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.06f else 1f, tween(140), label = "chipScale")

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        modifier = modifier
            .scale(scale)
            .clip(RoundedCornerShape(50))
            .background(
                when {
                    focused -> Aurum.AccentBright
                    selected -> Aurum.Accent
                    else -> Aurum.Glass
                }
            )
            .border(
                BorderStroke(1.dp, if (focused) Aurum.AccentBright else Aurum.Border),
                RoundedCornerShape(50)
            )
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
            .padding(horizontal = 18.dp, vertical = 9.dp)
    ) {
        Text(
            label,
            color = if (focused || selected) Aurum.AccentInk else Aurum.Text2,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1
        )
        if (trailing != null) {
            Text(
                trailing,
                color = if (focused || selected) Aurum.AccentInk.copy(alpha = 0.65f) else Aurum.Text4,
                fontSize = 11.sp
            )
        }
    }
}

/** Poster tile for films and box sets. */
@Composable
fun PosterCard(
    title: String,
    subtitle: String?,
    imageUrl: String?,
    modifier: Modifier = Modifier,
    rating: String? = null,
    progress: Float = 0f,
    favourite: Boolean = false,
    width: androidx.compose.ui.unit.Dp = 168.dp,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.08f else 1f, tween(160), label = "posterScale")

    Column(
        modifier = modifier
            .width(width)
            .scale(scale)
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(14.dp))
                .background(Aurum.Panel)
                .border(
                    BorderStroke(if (focused) 2.dp else 1.dp, if (focused) Aurum.Accent else Aurum.Border),
                    RoundedCornerShape(14.dp)
                )
        ) {
            ArtworkImage(imageUrl, title, Modifier.fillMaxSize())

            if (rating != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xD906070A))
                        .padding(horizontal = 7.dp, vertical = 3.dp)
                ) {
                    Icon(AurumIcons.Star, null, tint = Aurum.AccentBright, modifier = Modifier.size(11.dp))
                    Text(rating, color = Aurum.AccentBright, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }

            if (favourite) {
                Icon(
                    AurumIcons.HeartFilled, null, tint = Aurum.Accent,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .size(16.dp)
                )
            }

            if (focused) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(52.dp)
                        .clip(CircleShape)
                        .background(Aurum.Accent)
                ) {
                    Icon(AurumIcons.Play, null, tint = Aurum.AccentInk, modifier = Modifier.size(22.dp))
                }
            }

            if (progress > 0f && progress < 1f) {
                Box(
                    Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(4.dp)
                        .background(Color(0x99000000))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(progress)
                            .fillMaxHeight()
                            .background(Aurum.Accent)
                    )
                }
            }
        }

        Spacer(Modifier.height(9.dp))
        Text(
            title,
            color = if (focused) Aurum.AccentBright else Aurum.Text1,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            minLines = 2
        )
        if (subtitle != null) {
            Text(subtitle, color = Aurum.Text4, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Live channel row with now/next. */
@Composable
fun ChannelRow(
    number: Int,
    name: String,
    logoUrl: String?,
    nowTitle: String?,
    nowProgress: Float,
    nowUntil: String?,
    modifier: Modifier = Modifier,
    favourite: Boolean = false,
    playing: Boolean = false,
    onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(
                when {
                    focused -> Aurum.Accent
                    playing -> Aurum.AccentSoft
                    else -> Color.Transparent
                }
            )
            .border(
                BorderStroke(1.dp, if (focused) Aurum.AccentBright else Color.Transparent),
                RoundedCornerShape(12.dp)
            )
            .onFocusChangedCompat { focused = it }
            .focusable()
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Text(
            number.toString(),
            color = if (focused) Aurum.AccentInk.copy(alpha = 0.6f) else Aurum.Text4,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
            modifier = Modifier.width(38.dp)
        )

        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(56.dp, 40.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(if (focused) Color(0x22000000) else Aurum.Void)
                .padding(4.dp)
        ) {
            if (logoUrl.isNullOrEmpty()) {
                Text(initials(name), color = Aurum.Text4, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            } else {
                SubcomposeAsyncImage(
                    model = logoUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                    error = {
                        Text(initials(name), color = Aurum.Text4, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    },
                    loading = {}
                )
            }
        }

        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    name,
                    color = if (focused) Aurum.AccentInk else Aurum.Text,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                if (favourite) {
                    Icon(
                        AurumIcons.HeartFilled, null,
                        tint = if (focused) Aurum.AccentInk else Aurum.Accent,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }

            if (nowTitle != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    modifier = Modifier.padding(top = 3.dp)
                ) {
                    if (nowProgress > 0f) {
                        Box(
                            Modifier
                                .width(64.dp)
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(if (focused) Color(0x33000000) else Aurum.BorderStrong)
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(nowProgress)
                                    .fillMaxHeight()
                                    .background(if (focused) Aurum.AccentInk else Aurum.Accent)
                            )
                        }
                    }
                    Text(
                        nowTitle,
                        color = if (focused) Aurum.AccentInk.copy(alpha = 0.8f) else Aurum.Text2,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (nowUntil != null) {
                        Text(
                            "until $nowUntil",
                            color = if (focused) Aurum.AccentInk.copy(alpha = 0.55f) else Aurum.Text4,
                            fontSize = 12.sp,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

/** Artwork with a graceful text fallback — provider logos 404 constantly. */
@Composable
fun ArtworkImage(url: String?, title: String, modifier: Modifier = Modifier) {
    if (url.isNullOrEmpty()) {
        FallbackArt(title, modifier)
        return
    }
    SubcomposeAsyncImage(
        model = url,
        contentDescription = title,
        contentScale = ContentScale.Crop,
        modifier = modifier,
        loading = { Box(Modifier.fillMaxSize().background(Aurum.Panel)) },
        error = { FallbackArt(title, Modifier.fillMaxSize()) }
    )
}

@Composable
private fun FallbackArt(title: String, modifier: Modifier) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.background(
            Brush.linearGradient(listOf(Aurum.Panel, Aurum.Void))
        )
    ) {
        Text(
            title,
            color = Aurum.Text4,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(14.dp)
        )
    }
}

/** Section heading with the gold rule the desktop app uses. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth().padding(bottom = 14.dp)
    ) {
        Box(
            Modifier
                .size(3.dp, 20.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Aurum.AccentGradient)
        )
        Spacer(Modifier.width(11.dp))
        Text(title, color = Aurum.Text, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

@Composable
fun Badge(text: String, modifier: Modifier = Modifier, tone: Color = Aurum.Text2, live: Boolean = false) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(tone.copy(alpha = 0.12f))
            .border(BorderStroke(1.dp, tone.copy(alpha = 0.3f)), RoundedCornerShape(6.dp))
            .padding(horizontal = 9.dp, vertical = 4.dp)
    ) {
        if (live) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(Aurum.Live))
        }
        Text(text, color = tone, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = modifier.fillMaxSize().padding(48.dp),
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(76.dp)
                .clip(CircleShape)
                .background(Aurum.Glass)
                .border(BorderStroke(1.dp, Aurum.Border), CircleShape)
        ) {
            Icon(icon, null, tint = Aurum.Text4, modifier = Modifier.size(32.dp))
        }
        Text(title, color = Aurum.Text1, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
        Text(
            message,
            color = Aurum.Text3,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 620.dp)
        )
        action?.invoke()
        Spacer(Modifier.weight(1f))
    }
}

@Composable
fun LoadingState(text: String, modifier: Modifier = Modifier) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = modifier.fillMaxSize()
    ) {
        androidx.compose.material3.CircularProgressIndicator(
            color = Aurum.Accent,
            strokeWidth = 3.dp,
            modifier = Modifier.size(42.dp)
        )
        Spacer(Modifier.height(18.dp))
        Text(text, color = Aurum.Text3, style = MaterialTheme.typography.bodyLarge)
    }
}

/** Focus reporting used by every focusable component in the app. */
fun Modifier.onFocusChangedCompat(onChanged: (Boolean) -> Unit): Modifier =
    this.onFocusChanged { onChanged(it.isFocused) }
