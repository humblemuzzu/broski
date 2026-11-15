package com.muzammil.broski.core

import uniffi.broski_core.BridgeState
import uniffi.broski_core.ContractState
import uniffi.broski_core.LinkRoute
import uniffi.broski_core.LinkState
import uniffi.broski_core.MachineStatus
import uniffi.broski_core.WaitReason

/** One answer to "can I use this Mac now, and if not, why", read from the core's [MachineStatus]. */
sealed interface MachineHealth {
    /** The link is up and the bridge agreed on the protocol. */
    data class Online(val route: LinkRoute?) : MachineHealth

    /** Dialling, or the link is up and the bridge has not answered yet. */
    data object Connecting : MachineHealth

    data class Waiting(val reason: WaitReason) : MachineHealth

    /** The link is up and the daemon is starting the bridge. */
    data object BridgeStarting : MachineHealth

    /** The link is up and the bridge is down or crashed: the phone can ask for a restart. */
    data class BridgeDown(val detail: String?) : MachineHealth

    data class Incompatible(val message: String) : MachineHealth

    data class Refused(val message: String) : MachineHealth

    data object Revoked : MachineHealth

    /** The machine's link session ended here (forgotten or paired again). */
    data object Ended : MachineHealth
}

val MachineHealth.isOnline: Boolean get() = this is MachineHealth.Online

/** Whether the inbox should say something about the machine; a paused link is the app's own doing. */
val MachineHealth.needsMention: Boolean
    get() = this !is MachineHealth.Online && this != MachineHealth.Waiting(WaitReason.PAUSED)

fun MachineStatus.health(): MachineHealth = when (val state = link.state) {
    LinkState.Connecting -> MachineHealth.Connecting
    is LinkState.Waiting -> MachineHealth.Waiting(state.v1)
    LinkState.Revoked -> MachineHealth.Revoked
    LinkState.Closed -> MachineHealth.Ended
    is LinkState.Connected -> connectedHealth(this)
}

private fun connectedHealth(status: MachineStatus): MachineHealth {
    val bridge = status.bridge ?: return MachineHealth.Connecting
    return when (bridge.state) {
        BridgeState.UP -> when (val contract = status.contract) {
            is ContractState.Ready -> MachineHealth.Online(status.link.route)
            ContractState.Waiting -> MachineHealth.Connecting
            is ContractState.Refused -> MachineHealth.Refused(contract.message)
            is ContractState.Incompatible -> MachineHealth.Incompatible(contract.message)
        }
        BridgeState.CONNECTING, BridgeState.STARTING -> MachineHealth.BridgeStarting
        BridgeState.DOWN, BridgeState.CRASHED -> MachineHealth.BridgeDown(bridge.detail)
        BridgeState.UNKNOWN -> MachineHealth.Connecting
    }
}
