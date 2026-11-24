package com.muzammil.broski.core

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.BackendStatus
import uniffi.broski_core.ContractState
import uniffi.broski_core.MacDialog
import uniffi.broski_core.MachineStatus

/** An agent backend on a machine, and whether its CLI is installed there, once the bridge said. */
@Immutable
data class AgentInstall(val agent: Agent, val status: BackendStatus?) {
    val backend: String get() = agent.id
}

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
    val macDialogs: List<MacDialog> = emptyList(),
) {
    fun with(status: MachineStatus) = copy(
        health = status.health(),
        lastSeenMs = status.link.lastSeenMs?.toLong() ?: lastSeenMs,
        bridgeVersion = (status.contract as? ContractState.Ready)?.bridgeVersion ?: bridgeVersion,
    )

    fun agent(backend: String): Agent = agents.firstOrNull { it.backend == backend }?.agent ?: Agent.known(backend)
}

/** [backend] as [machineId] describes it, or as its id alone says while that machine has not. */
fun List<MachineState>.agent(machineId: String, backend: String): Agent =
    firstOrNull { it.id == machineId }?.agent(backend) ?: Agent.known(backend)
