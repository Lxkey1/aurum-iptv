package com.aurum.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aurum.tv.ui.AppState
import com.aurum.tv.ui.AurumRoot
import com.aurum.tv.ui.theme.Aurum
import com.aurum.tv.ui.theme.AurumTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Nothing is worse than the screen dimming halfway through a film.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContent {
            AurumTheme {
                val state: AppState = viewModel()
                LaunchedEffect(Unit) { state.boot() }

                Box(Modifier.fillMaxSize().background(Aurum.Base)) {
                    AurumRoot(state, onExit = { finish() })
                }
            }
        }
    }
}
