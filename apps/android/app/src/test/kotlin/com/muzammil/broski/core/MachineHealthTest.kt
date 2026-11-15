package com.muzammil.broski.core

import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.broski_core.BridgeState
import uniffi.broski_core.BridgeStatus
import uniffi.broski_core.ContractState
import uniffi.broski_core.LinkRoute
import uniffi.broski_core.LinkState
import uniffi.broski_core.LinkStatus
import uniffi.broski_core.MachineStatus
import uniffi.broski_core.WaitReason

class MachineHealthTest {
    private val connected = LinkState.Connected(resumed = false, sessionReset = false)

    private fun status(
        link: LinkState,
        bridge: BridgeState? = null,
        contract: ContractState = ContractState.Waiting,
        route: LinkRoute? = null,
    ) = MachineStatus(
        link = LinkStatus(link, route, null, null, null),
        bridge = bridge?.let { BridgeStatus(it, 1u, "exit 1") },
        contract = contract,
    )

    @Test
    fun onlyALinkUpWithABridgeThatAgreedIsOnline() {
        val ready = ContractState.Ready("1.2.3")
        assertEquals(MachineHealth.Online(LinkRoute.RELAY), status(connected, BridgeState.UP, ready, LinkRoute.RELAY).health())
        assertEquals(MachineHealth.Connecting, status(connected, BridgeState.UP).health())
        assertEquals(MachineHealth.Connecting, status(connected).health())
        assertEquals(MachineHealth.Connecting, status(LinkState.Connecting).health())
    }

    @Test
    fun aBridgeThatIsNotUpSaysWhyAndADownOneCanBeRestarted() {
        assertEquals(MachineHealth.BridgeStarting, status(connected, BridgeState.STARTING).health())
        assertEquals(MachineHealth.BridgeDown("exit 1"), status(connected, BridgeState.CRASHED).health())
        assertEquals(MachineHealth.BridgeDown("exit 1"), status(connected, BridgeState.DOWN).health())
        assertEquals(
            MachineHealth.Incompatible("protocol 2"),
            status(connected, BridgeState.UP, ContractState.Incompatible("protocol 2")).health(),
        )
    }

    @Test
    fun aLinkThatIsNotUpIsWaitingRevokedOrEnded() {
        assertEquals(
            MachineHealth.Waiting(WaitReason.MACHINE_ASLEEP),
            status(LinkState.Waiting(WaitReason.MACHINE_ASLEEP), BridgeState.UP).health(),
        )
        assertEquals(MachineHealth.Revoked, status(LinkState.Revoked).health())
        assertEquals(MachineHealth.Ended, status(LinkState.Closed).health())
    }
}
