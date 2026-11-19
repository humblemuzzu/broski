package com.muzammil.broski.feature.inbox

import com.muzammil.broski.design.Haptic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.InteractionKind
import uniffi.broski_contract.MessagePolicy
import uniffi.broski_contract.PermissionEffect
import uniffi.broski_contract.PermissionOption
import uniffi.broski_contract.PermissionScope
import uniffi.broski_contract.RejectionCode
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.AnswerOutcome
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState
import uniffi.broski_core.PendingAsk

class RowAnswerTest {
    private fun option(id: String, effect: PermissionEffect) =
        PermissionOption(id, id, effect, PermissionScope.ONCE, false, MessagePolicy.NONE, null)

    private fun row(pending: PendingAsk?, cached: Boolean = false) = InboxRow(
        machineId = "m-1",
        machineName = "MacBook",
        session = SessionRef(BackendId.CLAUDE_CODE, "cc-ask"),
        title = "Fix the flaky test",
        cwd = "/Users/me/src/broski",
        state = InboxState.NEEDS_YOU,
        updatedAt = 900,
        runStartedAt = null,
        ask = "Allow Bash command?",
        command = "npm test",
        pending = pending,
        cached = cached,
    )

    @Test
    fun aRowOffersOnlyTheOptionsItsPendingAskCarries() {
        val both = PendingAsk("i-1", InteractionKind.TOOL_PERMISSION, option("allow", PermissionEffect.ALLOW), option("deny", PermissionEffect.DENY))
        assertEquals(listOf(Decision.Approve, Decision.Deny), row(both).quickDecisions)
        assertEquals("allow", row(both).quickOption(Decision.Approve)?.id)
        assertEquals("deny", row(both).quickOption(Decision.Deny)?.id)

        val denyOnly = PendingAsk("i-2", InteractionKind.TOOL_PERMISSION, null, option("deny", PermissionEffect.DENY))
        assertEquals("allowing needs a grant chosen", listOf(Decision.Deny), row(denyOnly).quickDecisions)
        val question = PendingAsk("i-3", InteractionKind.QUESTIONS, null, null)
        assertEquals("a question opens the chat", emptyList<Decision>(), row(question).quickDecisions)
        assertEquals("a cached row carries no ask to answer", emptyList<Decision>(), row(null, cached = true).quickDecisions)
        assertNull(row(null).quickOption(Decision.Approve))
    }

    @Test
    fun eachOutcomeGetsTheHapticTheDesignNames() {
        assertEquals(Haptic.Success, RowAnswer.of(Decision.Approve, AnswerOutcome.Accepted).haptic)
        assertEquals(Haptic.Warning, RowAnswer.of(Decision.Deny, AnswerOutcome.Accepted).haptic)
        val stale = RowAnswer.of(Decision.Approve, AnswerOutcome.Stale)
        assertEquals(RowAnswer.Result.Stale, stale.result)
        assertEquals(Haptic.Warning, stale.haptic)
        val refused = RowAnswer.of(Decision.Approve, AnswerOutcome.Rejected(RejectionCode.CLOSED, "the session closed"))
        assertEquals(RowAnswer.Result.Failed("the session closed"), refused.result)
        assertEquals(Haptic.Failure, refused.haptic)
    }
}
