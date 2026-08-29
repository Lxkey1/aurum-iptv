package com.aurum.tv.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.unit.dp

/**
 * Hand-rolled icon set. Pulling in material-icons-extended would add several MB
 * to an APK that has to sit on a 8 GB Fire TV Stick, and we only need a dozen
 * glyphs.
 */
object AurumIcons {

    private fun stroke(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).apply {
            addPath(
                pathData = androidx.compose.ui.graphics.vector.PathData(block),
                stroke = SolidColor(Color.White),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round
            )
        }.build()

    private fun filled(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f
        ).apply {
            addPath(
                pathData = androidx.compose.ui.graphics.vector.PathData(block),
                fill = SolidColor(Color.White)
            )
        }.build()

    val Play = filled("play") {
        moveTo(7f, 4f); lineTo(20f, 12f); lineTo(7f, 20f); close()
    }

    val Pause = filled("pause") {
        moveTo(6f, 4f); lineTo(10f, 4f); lineTo(10f, 20f); lineTo(6f, 20f); close()
        moveTo(14f, 4f); lineTo(18f, 4f); lineTo(18f, 20f); lineTo(14f, 20f); close()
    }

    val Home = stroke("home") {
        moveTo(3f, 10f); lineTo(12f, 3f); lineTo(21f, 10f); lineTo(21f, 20f)
        lineTo(3f, 20f); close()
        moveTo(9f, 20f); lineTo(9f, 13f); lineTo(15f, 13f); lineTo(15f, 20f)
    }

    val Tv = stroke("tv") {
        moveTo(2f, 7f); lineTo(22f, 7f); lineTo(22f, 20f); lineTo(2f, 20f); close()
        moveTo(7f, 3f); lineTo(12f, 7f); lineTo(17f, 3f)
    }

    val Guide = stroke("guide") {
        moveTo(3f, 4f); lineTo(21f, 4f); lineTo(21f, 21f); lineTo(3f, 21f); close()
        moveTo(3f, 10f); lineTo(21f, 10f)
        moveTo(9f, 10f); lineTo(9f, 21f)
        moveTo(15f, 10f); lineTo(15f, 21f)
    }

    val Film = stroke("film") {
        moveTo(3f, 3f); lineTo(21f, 3f); lineTo(21f, 21f); lineTo(3f, 21f); close()
        moveTo(7f, 3f); lineTo(7f, 21f)
        moveTo(17f, 3f); lineTo(17f, 21f)
        moveTo(3f, 9f); lineTo(7f, 9f)
        moveTo(3f, 15f); lineTo(7f, 15f)
        moveTo(17f, 9f); lineTo(21f, 9f)
        moveTo(17f, 15f); lineTo(21f, 15f)
    }

    val SeriesIcon = stroke("series") {
        moveTo(2f, 7f); lineTo(22f, 7f); lineTo(22f, 21f); lineTo(2f, 21f); close()
        moveTo(7f, 3f); lineTo(12f, 7f); lineTo(17f, 3f)
        moveTo(10f, 12f); lineTo(15f, 14.5f); lineTo(10f, 17f); close()
    }

    val Search = stroke("search") {
        moveTo(18f, 11f); arcToRelative(7f, 7f, 0f, true, true, -14f, 0f)
        arcToRelative(7f, 7f, 0f, true, true, 14f, 0f); close()
        moveTo(16.7f, 16.7f); lineTo(21f, 21f)
    }

    val Heart = stroke("heart") {
        moveTo(12f, 21f)
        curveTo(4.5f, 16.4f, 2.5f, 12f, 2.5f, 12f)
        curveTo(0.8f, 8.2f, 5.3f, 4f, 8.8f, 6f)
        curveTo(10.2f, 6.8f, 11.4f, 8f, 12f, 9f)
        curveTo(12.6f, 8f, 13.8f, 6.8f, 15.2f, 6f)
        curveTo(18.7f, 4f, 23.2f, 8.2f, 21.5f, 12f)
        curveTo(21.5f, 12f, 19.5f, 16.4f, 12f, 21f)
        close()
    }

    val HeartFilled = filled("heartFilled") {
        moveTo(12f, 21f)
        curveTo(4.5f, 16.4f, 2.5f, 12f, 2.5f, 12f)
        curveTo(0.8f, 8.2f, 5.3f, 4f, 8.8f, 6f)
        curveTo(10.2f, 6.8f, 11.4f, 8f, 12f, 9f)
        curveTo(12.6f, 8f, 13.8f, 6.8f, 15.2f, 6f)
        curveTo(18.7f, 4f, 23.2f, 8.2f, 21.5f, 12f)
        curveTo(21.5f, 12f, 19.5f, 16.4f, 12f, 21f)
        close()
    }

    val Settings = stroke("settings") {
        moveTo(15f, 12f); arcToRelative(3f, 3f, 0f, true, true, -6f, 0f)
        arcToRelative(3f, 3f, 0f, true, true, 6f, 0f); close()
        moveTo(12f, 2f); lineTo(13.2f, 5.2f)
        moveTo(12f, 22f); lineTo(10.8f, 18.8f)
        moveTo(2f, 12f); lineTo(5.2f, 10.8f)
        moveTo(22f, 12f); lineTo(18.8f, 13.2f)
        moveTo(5f, 5f); lineTo(7.6f, 7.2f)
        moveTo(19f, 19f); lineTo(16.4f, 16.8f)
        moveTo(19f, 5f); lineTo(16.8f, 7.6f)
        moveTo(5f, 19f); lineTo(7.2f, 16.4f)
    }

    val Star = filled("star") {
        moveTo(12f, 2f); lineTo(15.1f, 8.6f); lineTo(22f, 9.6f); lineTo(17f, 14.5f)
        lineTo(18.2f, 21.4f); lineTo(12f, 18.1f); lineTo(5.8f, 21.4f); lineTo(7f, 14.5f)
        lineTo(2f, 9.6f); lineTo(8.9f, 8.6f); close()
    }

    val Clock = stroke("clock") {
        moveTo(22f, 12f); arcToRelative(10f, 10f, 0f, true, true, -20f, 0f)
        arcToRelative(10f, 10f, 0f, true, true, 20f, 0f); close()
        moveTo(12f, 6f); lineTo(12f, 12f); lineTo(16f, 14f)
    }

    val Info = stroke("info") {
        moveTo(22f, 12f); arcToRelative(10f, 10f, 0f, true, true, -20f, 0f)
        arcToRelative(10f, 10f, 0f, true, true, 20f, 0f); close()
        moveTo(12f, 16f); lineTo(12f, 11f)
        moveTo(12f, 8f); lineTo(12f, 8.1f)
    }

    val Refresh = stroke("refresh") {
        moveTo(21f, 12f); arcToRelative(9f, 9f, 0f, true, true, -2.6f, -6.4f)
        moveTo(21f, 4f); lineTo(21f, 10f); lineTo(15f, 10f)
    }

    val Download = stroke("download") {
        moveTo(12f, 3f); lineTo(12f, 15f)
        moveTo(7f, 10f); lineTo(12f, 15f); lineTo(17f, 10f)
        moveTo(3f, 17f); lineTo(3f, 21f); lineTo(21f, 21f); lineTo(21f, 17f)
    }

    val Logout = stroke("logout") {
        moveTo(9f, 3f); lineTo(4f, 3f); lineTo(4f, 21f); lineTo(9f, 21f)
        moveTo(16f, 7f); lineTo(21f, 12f); lineTo(16f, 17f)
        moveTo(21f, 12f); lineTo(9f, 12f)
    }

    val Back = stroke("back") {
        moveTo(15f, 5f); lineTo(8f, 12f); lineTo(15f, 19f)
    }

    val Forward = stroke("forward") {
        moveTo(9f, 5f); lineTo(16f, 12f); lineTo(9f, 19f)
    }

    val Up = stroke("up") {
        moveTo(5f, 15f); lineTo(12f, 8f); lineTo(19f, 15f)
    }

    val Down = stroke("down") {
        moveTo(5f, 9f); lineTo(12f, 16f); lineTo(19f, 9f)
    }

    val Sliders = stroke("sliders") {
        moveTo(4f, 21f); lineTo(4f, 14f)
        moveTo(4f, 10f); lineTo(4f, 3f)
        moveTo(12f, 21f); lineTo(12f, 12f)
        moveTo(12f, 8f); lineTo(12f, 3f)
        moveTo(20f, 21f); lineTo(20f, 16f)
        moveTo(20f, 12f); lineTo(20f, 3f)
        moveTo(1f, 14f); lineTo(7f, 14f)
        moveTo(9f, 8f); lineTo(15f, 8f)
        moveTo(17f, 16f); lineTo(23f, 16f)
    }

    val Subtitles = stroke("subtitles") {
        moveTo(2f, 5f); lineTo(22f, 5f); lineTo(22f, 19f); lineTo(2f, 19f); close()
        moveTo(6f, 14f); lineTo(10f, 14f)
        moveTo(13f, 14f); lineTo(18f, 14f)
        moveTo(6f, 10f); lineTo(9f, 10f)
        moveTo(12f, 10f); lineTo(18f, 10f)
    }

    val Audio = stroke("audio") {
        moveTo(3f, 18f); lineTo(3f, 12f)
        arcToRelative(9f, 9f, 0f, true, true, 18f, 0f)
        lineTo(21f, 18f)
        moveTo(3f, 14f); lineTo(7f, 14f); lineTo(7f, 20f); lineTo(3f, 20f); close()
        moveTo(17f, 14f); lineTo(21f, 14f); lineTo(21f, 20f); lineTo(17f, 20f); close()
    }

    val Alert = stroke("alert") {
        moveTo(12f, 3f); lineTo(22f, 20f); lineTo(2f, 20f); close()
        moveTo(12f, 9f); lineTo(12f, 14f)
        moveTo(12f, 17f); lineTo(12f, 17.1f)
    }

    val List = stroke("list") {
        moveTo(8f, 6f); lineTo(21f, 6f)
        moveTo(8f, 12f); lineTo(21f, 12f)
        moveTo(8f, 18f); lineTo(21f, 18f)
        moveTo(3f, 6f); lineTo(3.1f, 6f)
        moveTo(3f, 12f); lineTo(3.1f, 12f)
        moveTo(3f, 18f); lineTo(3.1f, 18f)
    }

    val Trash = stroke("trash") {
        moveTo(3f, 6f); lineTo(21f, 6f)
        moveTo(5f, 6f); lineTo(6f, 21f); lineTo(18f, 21f); lineTo(19f, 6f)
        moveTo(9f, 6f); lineTo(9f, 3f); lineTo(15f, 3f); lineTo(15f, 6f)
    }

    val Check = stroke("check") {
        moveTo(4f, 12f); lineTo(9f, 17f); lineTo(20f, 6f)
    }
}
