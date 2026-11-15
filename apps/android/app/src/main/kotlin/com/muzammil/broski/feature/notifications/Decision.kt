package com.muzammil.broski.feature.notifications

import android.content.Intent
import androidx.annotation.StringRes
import com.muzammil.broski.R
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

/** The session a notification opens, carried in the intent that starts the app. */
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
        val backend = intent.getStringExtra(BACKEND) ?: return null
        val session = intent.getStringExtra(SESSION) ?: return null
        return SessionTarget(machine, backend, session)
    }
}
