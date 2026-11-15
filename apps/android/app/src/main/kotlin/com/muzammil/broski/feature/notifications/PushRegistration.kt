package com.muzammil.broski.feature.notifications

import android.util.Log
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import uniffi.broski_core.ClientException
import uniffi.broski_core.PushPlatform

/**
 * Gives every paired machine this install's FCM token once its link is up: at start, for each
 * machine paired later, and again whenever FCM hands out a new token. A registration the link would
 * not send is tried again at the machine's next change of status.
 */
class PushRegistration(private val phone: PhoneSession, private val token: StateFlow<String?>) {
    private val registered = mutableSetOf<Pair<String, String>>()

    suspend fun run() {
        combine(token.filterNotNull(), phone.machines) { token, machines -> token to machines }.collectLatest { (token, machines) ->
            machines.filter { it.health.isOnline }.forEach { machine -> register(machine.id, token) }
        }
    }

    private fun register(machineId: String, token: String) {
        if (machineId to token in registered) return
        try {
            phone.machine(machineId)?.registerPush(PushPlatform.FCM, token) ?: return
            registered += machineId to token
        } catch (error: ClientException) {
            Log.i(TAG, "the push registration was not sent; it is tried again at the next status", error)
        }
    }

    private companion object {
        const val TAG = "PushRegistration"
    }
}
