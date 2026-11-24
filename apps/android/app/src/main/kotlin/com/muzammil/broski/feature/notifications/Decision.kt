package com.muzammil.broski.feature.notifications

import android.content.Intent
import androidx.annotation.StringRes
import com.muzammil.broski.R
import com.muzammil.broski.core.BackendIds
import uniffi.broski_core.PushDecision

/** What the person chose on a lock-screen approval; only ever their own tap. */
enum class Decision(val push: PushDecision) {
    Allow(PushDecision.ALLOW),
    Deny(PushDecision.DENY),
}

/** Where a decision letter is on its way to the machine. */
enum class DecisionState {
    Sending,
    Sent,
    Failed;

    @StringRes
    fun words(decision: Decision): Int = when (this) {
        Sending -> if (decision == Decision.Allow) R.string.notify_allowing else R.string.notify_denying
        Sent -> if (decision == Decision.Allow) R.string.notify_allowed else R.string.notify_denied
        Failed -> R.string.notify_decision_failed
    }
}

/** The session a notification opens, carried in the intent that starts the app; one naming no backend id the contract could is none. */
object OpenSession {
    private const val MACHINE = "broski.open.machine"
    private const val BACKEND = "broski.open.backend"
    private const val SESSION = "broski.open.session"

    fun put(intent: Intent, target: SessionTarget): Intent = intent
        .putExtra(MACHINE, target.machineId)
        .putExtra(BACKEND, target.backend)
        .putExtra(SESSION, target.sessionId)

    fun from(intent: Intent?): SessionTarget? {
        val machine = intent?.getStringExtra(MACHINE) ?: return null
        val backend = intent.getStringExtra(BACKEND)?.takeIf(BackendIds::isValid) ?: return null
        val session = intent.getStringExtra(SESSION) ?: return null
        return SessionTarget(machine, backend, session)
    }
}

/** The machine to open in Remote Screen when tapping a macOS system-dialog notification. */
object OpenScreen {
    private const val SCREEN_MACHINE = "broski.open.screen.machine"

    fun put(intent: Intent, machineId: String): Intent = intent.putExtra(SCREEN_MACHINE, machineId)

    fun from(intent: Intent?): String? = intent?.getStringExtra(SCREEN_MACHINE)?.takeIf { it.isNotBlank() }
}
