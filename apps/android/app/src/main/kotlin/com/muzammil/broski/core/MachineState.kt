package com.muzammil.broski.core

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.BackendStatus
import uniffi.broski_core.ContractState
import uniffi.broski_core.MachineStatus

/** An agent backend on a machine, and whether its CLI is installed there, once the bridge said. */
@Immutable
data class AgentInstall(val backend: BackendId, val status: BackendStatus?)

/** What the screens show of one paired machine. */
@Immutable
data class MachineState(
    val id: String,
    val name: String,
    val os: String?,
    val pairedAtMs: Long,
    val health: MachineHealth,
    val lastSeenMs: Long?,
    val bridgeVersion: String?,
    val agents: List<AgentInstall> = emptyList(),
) {
    fun with(status: MachineStatus) = copy(
        health = status.health(),
        lastSeenMs = status.link.lastSeenMs?.toLong() ?: lastSeenMs,
        bridgeVersion = (status.contract as? ContractState.Ready)?.bridgeVersion ?: bridgeVersion,
    )
}
