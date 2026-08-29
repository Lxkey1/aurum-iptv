package com.aurum.tv.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The same champagne-on-charcoal palette as the desktop app. */
object Aurum {
    val Void = Color(0xFF06070A)
    val Base = Color(0xFF0A0C11)
    val Raised = Color(0xFF10131A)
    val Panel = Color(0xFF141821)
    val Hover = Color(0xFF1A1F2B)

    val Accent = Color(0xFFE3C77E)
    val AccentBright = Color(0xFFF5E3B3)
    val AccentDeep = Color(0xFFB08D3F)
    val AccentInk = Color(0xFF1A1408)
    val AccentSoft = Color(0x1AE3C77E)

    val Text = Color(0xFFF2F3F6)
    val Text1 = Color(0xFFE4E6EC)
    val Text2 = Color(0xFFA2A8B8)
    val Text3 = Color(0xFF6E7688)
    val Text4 = Color(0xFF4A5164)

    val Live = Color(0xFFFF4D5E)
    val Good = Color(0xFF4ADE80)
    val Warn = Color(0xFFFBBF24)
    val Bad = Color(0xFFF87171)

    val Border = Color(0x14FFFFFF)
    val BorderStrong = Color(0x26FFFFFF)
    val Glass = Color(0x0DFFFFFF)

    val AccentGradient = Brush.linearGradient(listOf(AccentBright, AccentDeep))

    /**
     * TVs overscan. Everything meaningful stays inside a 5% margin so nothing is
     * clipped on older sets.
     */
    val OverscanH = 48.dp
    val OverscanV = 27.dp
}

private val AurumColors = darkColorScheme(
    primary = Aurum.Accent,
    onPrimary = Aurum.AccentInk,
    secondary = Aurum.AccentDeep,
    background = Aurum.Base,
    onBackground = Aurum.Text,
    surface = Aurum.Raised,
    onSurface = Aurum.Text,
    surfaceVariant = Aurum.Panel,
    onSurfaceVariant = Aurum.Text2,
    error = Aurum.Bad
)

/**
 * Type is scaled for a 10-foot viewing distance — everything is a few steps
 * larger than the equivalent phone or desktop style.
 */
private val AurumType = Typography(
    displayLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 44.sp, lineHeight = 50.sp),
    headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 32.sp, lineHeight = 38.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, lineHeight = 32.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 18.sp, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 15.sp)
)

@Composable
fun AurumTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AurumColors,
        typography = AurumType,
        content = content
    )
}
