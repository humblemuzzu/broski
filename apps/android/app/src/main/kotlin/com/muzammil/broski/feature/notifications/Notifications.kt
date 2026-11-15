package com.muzammil.broski.feature.notifications

import android.content.Context
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.CoreState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * The app's notifications for the life of the process, made by the Application: the channels, the
 * FCM token and its registration with every machine, and the Live Update while agents work. Each
 * phone session the core starts (a first start, a Start Over) gets its own registration and Live
 * Update.
 */
class Notifications(private val context: Context, private val core: AppCore) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** This install's FCM token, once Firebase gives one; PushService replaces it when FCM rotates it. */
    val pushToken = MutableStateFlow<String?>(null)

    fun start() {
        Notifier(context)
        if (FirebasePush.start(context)) scope.launch { FirebasePush.token()?.let { pushToken.value = it } }
        scope.launch {
            core.state.collectLatest { state ->
                val phone = (state as? CoreState.Ready)?.session ?: return@collectLatest
                coroutineScope {
                    launch { PushRegistration(phone, pushToken).run() }
                    launch { LiveUpdate(context, phone, core::holdConnected).run() }
                }
            }
        }
    }
}
