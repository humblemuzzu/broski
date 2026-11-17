package com.muzammil.broski.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.feature.chat.composer.dictation.LocalDictation
import com.muzammil.broski.feature.notifications.LocalNotificationAsk
import com.muzammil.broski.feature.notifications.rememberNotificationAsk
import com.muzammil.broski.feature.welcome.WelcomeScreen

/** The splash screen stays up while the core starts; then the welcome, the shell or why it can't start. */
@Composable
fun BroskiApp(core: AppCore, features: Features, openRequests: OpenRequests) {
    val state by core.state.collectAsStateWithLifecycle()
    when (val current = state) {
        CoreState.Starting -> Unit
        is CoreState.Failed -> StartupFailed(current.failure, core::startOver)
        is CoreState.Ready -> ReadyApp(core, current.session, features, openRequests)
    }
}

/**
 * The welcome until a first pairing, the shell after it, and the welcome again once the last
 * pairing is forgotten. The switch to the shell is the pairing's own step, not a reaction to the
 * machine list, so the pairing screen finishes its success before it goes. The notification ask a
 * pairing starts lives above both, so it outlasts that switch.
 */
@Composable
private fun ReadyApp(core: AppCore, phone: PhoneSession, features: Features, openRequests: OpenRequests) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    val unreadable by phone.unreadableMachines.collectAsStateWithLifecycle()
    val nothingPaired = machines.isEmpty() && unreadable.isEmpty()
    var welcome by rememberSaveable { mutableStateOf(nothingPaired) }
    LaunchedEffect(nothingPaired) {
        if (nothingPaired) welcome = true
    }
    CompositionLocalProvider(LocalNotificationAsk provides rememberNotificationAsk(), LocalDictation provides core.dictation) {
        if (welcome) {
            WelcomeScreen(phone = phone, onPaired = { welcome = false })
        } else {
            Shell(core, phone, features, openRequests)
        }
    }
}
