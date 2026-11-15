package com.muzammil.broski.feature.inbox

import com.muzammil.broski.design.Haptic
import uniffi.broski_contract.PermissionOption
import uniffi.broski_core.AnswerOutcome
import uniffi.broski_core.InboxRow

enum class Decision { Approve, Deny }

/** The person tapped Approve or Deny on an inbox row, and what came of it. */
data class RowAnswer(val decision: Decision, val result: Result) {
    sealed interface Result {
        data object Sent : Result

        /** Another phone, the terminal or the agent itself got there first. */
        data object Stale : Result

        data class Failed(val detail: String) : Result
    }

    val haptic: Haptic
        get() = when {
            result == Result.Sent && decision == Decision.Approve -> Haptic.Success
            result is Result.Failed -> Haptic.Failure
            else -> Haptic.Warning
        }

    companion object {
        fun of(decision: Decision, outcome: AnswerOutcome) = RowAnswer(
            decision,
            when (outcome) {
                AnswerOutcome.Accepted -> Result.Sent
                AnswerOutcome.Stale -> Result.Stale
                is AnswerOutcome.Rejected -> Result.Failed(outcome.detail)
            },
        )
    }
}

/**
 * The backend's own option a tap may choose for this row: present only for a tool permission the
 * inbox sees live, whose options allow a one-tap answer.
 */
fun InboxRow.quickOption(decision: Decision): PermissionOption? = when (decision) {
    Decision.Approve -> pending?.allow
    Decision.Deny -> pending?.deny
}

val InboxRow.quickDecisions: List<Decision> get() = Decision.entries.filter { quickOption(it) != null }

/** Identifies a row across machines, as the list keys it. */
val InboxRow.key: String get() = "$machineId/${session.backend}/${session.sessionId}"
