package com.muzammil.broski.design

import com.muzammil.broski.core.MachineHealth
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_core.LinkRoute
import uniffi.broski_core.WaitReason

/** Only a link being made is shown by an orb; a machine that is away, paused or broken is not under way. */
class MachineSettlingTest {
    @Test
    fun aLinkBeingMadeSettlesAndNothingElseDoes() {
        assertTrue(MachineHealth.Connecting.settling)
        assertTrue(MachineHealth.BridgeStarting.settling)
        assertTrue(MachineHealth.Waiting(WaitReason.RETRY).settling)

        assertFalse(MachineHealth.Waiting(WaitReason.PAUSED).settling)
        assertFalse(MachineHealth.Waiting(WaitReason.MACHINE_OFFLINE).settling)
        assertFalse(MachineHealth.Waiting(WaitReason.MACHINE_ASLEEP).settling)
        assertFalse(MachineHealth.Waiting(WaitReason.RELAY_REFUSED).settling)
        assertFalse(MachineHealth.Online(LinkRoute.LAN).settling)
        assertFalse(MachineHealth.BridgeDown(detail = null).settling)
        assertFalse(MachineHealth.Revoked.settling)
    }
}
