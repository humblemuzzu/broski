package com.muzammil.broski.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.ProvideClock
import com.muzammil.broski.design.format.LocalReading
import com.muzammil.broski.design.format.LocalSetReading
import com.muzammil.broski.design.isDarkTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val app = application as BroskiApplication
        val core = app.core
        if (savedInstanceState == null) app.openRequests.offer(intent)
        splash.setKeepOnScreenCondition { core.state.value == CoreState.Starting || core.settings.value == null }
        enableEdgeToEdge()
        setContent {
            val settings by core.settings.collectAsStateWithLifecycle()
            val appearance = settings?.appearance ?: Appearance.System
            val dark = isDarkTheme(appearance)
            DisposableEffect(dark) {
                val bars = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark }
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            val scope = rememberCoroutineScope()
            BroskiTheme(appearance) {
                CompositionLocalProvider(
                    LocalReading provides (settings?.reading ?: ReadingSettings()),
                    LocalSetReading provides { reading -> scope.launch { core.settingsStore.setReading(reading) } },
                ) {
                    ProvideClock { BroskiApp(core, BroskiFeatures, app.openRequests) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        (application as BroskiApplication).openRequests.offer(intent)
    }
}
