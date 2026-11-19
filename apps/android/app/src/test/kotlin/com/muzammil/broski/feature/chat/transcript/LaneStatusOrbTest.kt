package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.design.orb.OrbState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The orb that leads the status lane, as on iOS: none while the session waits on the person. */
class LaneStatusOrbTest {
    @Test
    fun eachStatusHasItsOrbAndWaitingForThePersonHasNone() {
        assertEquals(OrbState.BREATHING, LaneStatus.Starting.orb)
        assertEquals(OrbState.BREATHING, LaneStatus.Thinking.orb)
        assertEquals(OrbState.WORKING, LaneStatus.Working.orb)
        assertEquals(OrbState.WEAVING, LaneStatus.Compacting.orb)
        assertEquals(OrbState.CONNECTING, LaneStatus.Retrying(retryAt = null).orb)
        assertNull(LaneStatus.WaitingForApproval.orb)
        assertNull(LaneStatus.WaitingForAnswer.orb)
    }
}
