package com.muzammil.broski.feature.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.muzammil.broski.app.BroskiApplication
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * FCM's way in. A data message is handled on FCM's own background thread, which may block for the
 * few seconds the system allows; a new token goes to every paired machine.
 */
class PushService : FirebaseMessagingService() {
    private val app get() = application as BroskiApplication
    private val core get() = app.core

    override fun onMessageReceived(message: RemoteMessage) {
        val handler = PushHandler(
            context = this,
            vault = core.vault,
            enabled = { core.settings.filterNotNull().first().notifications },
            visibleSession = Notifications::visibleForegroundSession,
        )
        runBlocking { handler.handle(message.data) }
    }

    override fun onNewToken(token: String) {
        app.notifications.pushToken.value = token
    }
}
