package com.aurum.tv.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aurum.tv.data.ServerInput
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumIcons
import com.aurum.tv.ui.components.TvButton
import com.aurum.tv.ui.components.onFocusChangedCompat
import com.aurum.tv.ui.theme.Aurum

@Composable
fun LoginScreen(state: AppState, error: String?, busy: Boolean) {
    var server by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var remember_ by remember { mutableStateOf(true) }
    var showPassword by remember { mutableStateOf(false) }

    val serverFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { serverFocus.requestFocus() } }

    Row(Modifier.fillMaxSize().background(Aurum.Void)) {

        // ---------------------------------------------------------- artwork
        Box(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .background(
                    Brush.radialGradient(
                        colors = listOf(Color(0x33E3C77E), Color(0x110A0C11), Aurum.Void),
                        radius = 1400f
                    )
                )
        ) {
            Column(
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(start = 64.dp, end = 48.dp)
            ) {
                Text(
                    "Every channel.\nEvery film.",
                    color = Aurum.Text,
                    fontSize = 46.sp,
                    fontWeight = FontWeight.Light,
                    lineHeight = 54.sp
                )
                Text(
                    "One elegant place.",
                    fontSize = 46.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = 56.sp,
                    color = Aurum.Accent
                )
                Spacer(Modifier.height(24.dp))
                Text(
                    "Sign in with your Xtream Codes line to unlock live television, a full programme guide, films and box sets — all played back on this Fire TV.",
                    color = Aurum.Text3,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.widthIn(max = 520.dp)
                )
                Spacer(Modifier.height(34.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    Feature(AurumIcons.Tv, "Live TV & EPG")
                    Feature(AurumIcons.Film, "Films & box sets")
                    Feature(AurumIcons.Play, "Built-in player")
                }
            }
        }

        // ------------------------------------------------------------ form
        Column(
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .width(560.dp)
                .fillMaxHeight()
                .background(Color(0xE60A0C11))
                .padding(horizontal = 56.dp, vertical = Aurum.OverscanV)
                .verticalScroll(rememberScrollState())
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Aurum.AccentGradient)
                ) {
                    Icon(AurumIcons.Play, null, tint = Aurum.AccentInk, modifier = Modifier.size(22.dp))
                }
                Column {
                    Text("Aurum TV", color = Aurum.Text, style = MaterialTheme.typography.headlineMedium)
                    Text("XTREAM CODES", color = Aurum.Text4, fontSize = 11.sp, letterSpacing = 2.sp)
                }
            }

            Spacer(Modifier.height(30.dp))

            if (error != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0x1AF87171))
                        .border(BorderStroke(1.dp, Color(0x40F87171)), RoundedCornerShape(10.dp))
                        .padding(14.dp)
                ) {
                    Icon(AurumIcons.Alert, null, tint = Aurum.Bad, modifier = Modifier.size(20.dp))
                    Text(error, color = Color(0xFFFCA5A5), style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(18.dp))
            }

            TvTextField(
                label = "Server URL",
                value = server,
                onValueChange = { text ->
                    server = text
                    // Pasting a get.php / m3u_plus link fills in the rest.
                    if (text.contains("username=", true)) {
                        val parsed = ServerInput.parse(text)
                        if (parsed.username.isNotEmpty()) {
                            server = parsed.host
                            username = parsed.username
                            password = parsed.password
                        }
                    }
                },
                placeholder = "http://your-provider.com:8080",
                keyboardType = KeyboardType.Uri,
                modifier = Modifier.focusRequester(serverFocus)
            )
            Text(
                "You can paste a full get.php or m3u_plus link — the username and password will be filled in for you.",
                color = Aurum.Text4,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 6.dp)
            )

            Spacer(Modifier.height(18.dp))
            TvTextField("Username", username, { username = it }, "Your line username")

            Spacer(Modifier.height(18.dp))
            TvTextField(
                label = "Password",
                value = password,
                onValueChange = { password = it },
                placeholder = "Your line password",
                keyboardType = KeyboardType.Password,
                masked = !showPassword,
                trailing = {
                    Text(
                        if (showPassword) "HIDE" else "SHOW",
                        color = Aurum.Accent,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .focusable()
                            .clickable { showPassword = !showPassword }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            )

            Spacer(Modifier.height(22.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .focusable()
                    .clickable { remember_ = !remember_ }
                    .padding(vertical = 6.dp, horizontal = 4.dp)
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(22.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (remember_) Aurum.Accent else Color.Transparent)
                        .border(BorderStroke(2.dp, if (remember_) Aurum.Accent else Aurum.BorderStrong), RoundedCornerShape(6.dp))
                ) {
                    if (remember_) Icon(AurumIcons.Check, null, tint = Aurum.AccentInk, modifier = Modifier.size(14.dp))
                }
                Text("Stay signed in on this device", color = Aurum.Text2, style = MaterialTheme.typography.bodyMedium)
            }

            Spacer(Modifier.height(24.dp))

            TvButton(
                text = if (busy) "Connecting…" else "Connect",
                primary = true,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                onClick = { state.login(server, username, password, remember_) }
            )

            Spacer(Modifier.height(22.dp))
            Text(
                "Aurum is a player only. It does not provide, host or resell any channels — you need your own subscription from a provider.",
                color = Aurum.Text4,
                fontSize = 11.sp,
                lineHeight = 17.sp
            )
        }
    }
}

@Composable
private fun Feature(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(icon, null, tint = Aurum.Accent, modifier = Modifier.size(18.dp))
        Text(label, color = Aurum.Text2, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Text entry on a TV: the field takes D-pad focus, and pressing select opens the
 * Fire TV on-screen keyboard against the same field.
 */
@Composable
fun TvTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    masked: Boolean = false,
    trailing: (@Composable () -> Unit)? = null
) {
    var focused by remember { mutableStateOf(false) }

    Column(modifier) {
        Text(
            label.uppercase(),
            color = if (focused) Aurum.Accent else Aurum.Text3,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.4.sp
        )
        Spacer(Modifier.height(7.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Aurum.Void)
                .border(
                    BorderStroke(if (focused) 2.dp else 1.dp, if (focused) Aurum.Accent else Aurum.Border),
                    RoundedCornerShape(10.dp)
                )
                .padding(horizontal = 16.dp, vertical = 4.dp)
        ) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) {
                    Text(placeholder, color = Aurum.Text4, style = MaterialTheme.typography.bodyLarge)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = Aurum.Text),
                    cursorBrush = SolidColor(Aurum.Accent),
                    visualTransformation = if (masked) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Next),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 14.dp)
                        .onFocusChangedCompat { focused = it }
                )
            }
            trailing?.invoke()
        }
    }
}
