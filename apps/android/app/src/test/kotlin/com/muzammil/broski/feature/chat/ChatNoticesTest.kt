package com.muzammil.broski.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.BackendExtension
import uniffi.broski_contract.NoticeEvent
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RateLimitStatus
import uniffi.broski_contract.RateLimitUpdate
import uniffi.broski_core.SessionChange

/** The notice cards a session's changes raise: the same words as the iOS chat. */
class ChatNoticesTest {
    private fun limit(status: RateLimitStatus?, usedPercent: Double? = null, resetsAt: Long? = null) =
        SessionChange.ExtensionReceived(BackendExtension.RateLimit(RateLimitUpdate("five_hour", status, usedPercent, resetsAt)))

    private fun said(change: SessionChange) = noticeOf(change) { "4:05 PM" }

    @Test
    fun aRefusedRequestSaysWhenTheLimitLiftsOrThatItWasReached() {
        assertEquals(NoticeText(NoticeLevel.WARNING, "Usage limit reached. It resets at 4:05 PM."), said(limit(RateLimitStatus.REJECTED, resetsAt = 1_000)))
        assertEquals(NoticeText(NoticeLevel.WARNING, "Usage limit reached."), said(limit(RateLimitStatus.REJECTED)))
    }

    @Test
    fun aWarningSaysHowMuchIsUsedWhenItIsKnown() {
        assertEquals(NoticeText(NoticeLevel.INFO, "82% of the usage limit is used."), said(limit(RateLimitStatus.ALLOWED_WARNING, usedPercent = 81.6)))
        assertEquals(NoticeText(NoticeLevel.INFO, "Most of the usage limit is used."), said(limit(RateLimitStatus.ALLOWED_WARNING)))
    }

    @Test
    fun aLimitThatIsNoConcernSaysNothing() {
        assertNull(said(limit(RateLimitStatus.ALLOWED, usedPercent = 10.0)))
        assertNull(said(limit(null)))
    }

    @Test
    fun theBackendsOwnNoticesGoThroughAsTheyAre() {
        assertEquals(NoticeText(NoticeLevel.INFO, "Halfway there."), said(SessionChange.NoticeShown(NoticeEvent(NoticeLevel.INFO, "Halfway there."))))
    }
}
