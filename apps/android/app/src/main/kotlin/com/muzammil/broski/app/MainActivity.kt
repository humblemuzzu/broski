package com.muzammil.broski.app

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.ProvideClock
import com.muzammil.broski.design.isDarkTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val core = (application as BroskiApplication).core
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
            BroskiTheme(appearance) {
                ProvideClock { BroskiApp(core, BroskiFeatures) }
            }
        }
    }
}
