package com.muzammil.broski.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.StartupFailure
import com.muzammil.broski.design.MessageScreen
import com.muzammil.broski.feature.welcome.WelcomeScreen

/** The splash screen stays up while the core starts; then the welcome, the shell or why it can't start. */
@Composable
fun BroskiApp(core: AppCore, features: Features) {
    val state by core.state.collectAsStateWithLifecycle()
    when (val current = state) {
        CoreState.Starting -> Unit
        is CoreState.Failed -> StartupFailed(current.failure)
        is CoreState.Ready -> ReadyApp(core, current.session, features)
    }
}

/**
 * The welcome until a first pairing, the shell after it, and the welcome again once the last
 * pairing is forgotten. The switch to the shell is the pairing's own step, not a reaction to the
 * machine list, so the pairing screen finishes its success before it goes.
 */
@Composable
private fun ReadyApp(core: AppCore, phone: PhoneSession, features: Features) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    val unreadable by phone.unreadableMachines.collectAsStateWithLifecycle()
    val nothingPaired = machines.isEmpty() && unreadable.isEmpty()
    var welcome by rememberSaveable { mutableStateOf(nothingPaired) }
    LaunchedEffect(nothingPaired) {
        if (nothingPaired) welcome = true
    }
    if (welcome) {
        WelcomeScreen(phone = phone, onPaired = { welcome = false })
    } else {
        Shell(core, phone, features)
    }
}

@Composable
private fun StartupFailed(failure: StartupFailure) {
    val (title, body) = when (failure) {
        StartupFailure.IdentityUnreadable -> R.string.startup_identity_title to R.string.startup_identity_body
        StartupFailure.IdentityRefused -> R.string.startup_refused_title to R.string.startup_refused_body
        StartupFailure.StorageUnreadable -> R.string.startup_storage_title to R.string.startup_storage_body
    }
    MessageScreen(R.drawable.ic_error, stringResource(title), stringResource(body))
}
