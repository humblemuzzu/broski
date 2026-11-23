package com.muzammil.broski.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.KeepScreenAwake
import com.muzammil.broski.core.settings.ModelPreferences
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.core.voice.DictationPhase
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.ProvideClock
import com.muzammil.broski.design.format.LocalReading
import com.muzammil.broski.design.format.LocalSetReading
import com.muzammil.broski.design.isDarkTheme
import com.muzammil.broski.feature.chat.composer.LocalModelPreferences
import com.muzammil.broski.feature.chat.composer.ModelPreferencesHook
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import uniffi.broski_core.InboxState

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
            val coreState by core.state.collectAsStateWithLifecycle()
            val dictationState by core.dictation.state.collectAsStateWithLifecycle()
            val inboxFlow = remember(coreState) { (coreState as? CoreState.Ready)?.session?.inboxRows ?: flowOf(emptyList()) }
            val inboxRows by inboxFlow.collectAsStateWithLifecycle(initialValue = emptyList())
            val hasLiveWork = inboxRows.any { !it.cached && (it.state == InboxState.WORKING || it.state == InboxState.NEEDS_YOU) }
            val isDictating = dictationState.phase is DictationPhase.Recording || dictationState.phase is DictationPhase.Transcribing
            val keepScreenAwake = isDictating || when (settings?.keepScreenAwake ?: KeepScreenAwake.DictationOnly) {
                KeepScreenAwake.DictationOnly -> false
                KeepScreenAwake.WhileWorking -> hasLiveWork
                KeepScreenAwake.Always -> true
            }
            DisposableEffect(keepScreenAwake) {
                if (keepScreenAwake) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            }
            val appearance = settings?.appearance ?: Appearance.System
            val dynamicColor = settings?.dynamicColor ?: false
            val dark = isDarkTheme(appearance)
            DisposableEffect(dark) {
                val bars = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark }
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            val scope = rememberCoroutineScope()
            BroskiTheme(appearance, dynamicColor) {
                CompositionLocalProvider(
                    LocalReading provides (settings?.reading ?: ReadingSettings()),
                    LocalSetReading provides { reading -> scope.launch { core.settingsStore.setReading(reading) } },
                    LocalModelPreferences provides ModelPreferencesHook(settings?.models ?: ModelPreferences()) { change ->
                        scope.launch { core.settingsStore.updateModels(change) }
                    },
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
