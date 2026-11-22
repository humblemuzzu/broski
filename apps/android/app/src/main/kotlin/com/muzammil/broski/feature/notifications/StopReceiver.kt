package com.muzammil.broski.feature.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.CoreState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import uniffi.broski_contract.AbortRequest
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.ClientException

/**
 * Stop on the Live Update: `abort` for that run, through the app's own link to its machine. The bridge
 * takes `abort` only for a session the phone views, so the session is viewed while it is sent.
 */
class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val target = OpenSession.from(intent) ?: return
        val phone = ((context.applicationContext as BroskiApplication).core.state.value as? CoreState.Ready)?.session ?: return
        val machine = phone.machine(target.machineId) ?: return
        val pending = goAsync()
        val session = SessionRef(target.backend, target.sessionId)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val view = machine.attach(session)
                try {
                    // A receiver that holds on past its few seconds is an ANR; the abort is sent by then.
                    withTimeoutOrNull(STOP_WAIT_MS) { machine.request(ClientMessage.Abort(AbortRequest("", session))) }
                } finally {
                    view.detach()
                    view.close()
                }
            } catch (error: ClientException) {
                Log.w(LiveUpdate.TAG, "Stop did not reach the machine", error)
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        const val STOP_WAIT_MS = 8_000L
    }
}
