package com.muzammil.broski.feature.workspace

import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.Rejected
import uniffi.broski_contract.Rejection
import uniffi.broski_contract.RejectionCode
import uniffi.broski_contract.ServerMessage

/**
 * A bridge for the workspace screens' tests: it records every request and answers each with what
 * [answer] makes of it, in the contract's own result shapes.
 */
class FakeBridge(private val answer: suspend (ClientMessage) -> ServerMessage) : Requester {
    val requests = mutableListOf<ClientMessage>()

    override suspend fun request(message: ClientMessage): ServerMessage {
        requests += message
        return answer(message)
    }
}

fun rejected(code: RejectionCode, message: String) = Rejected(Rejection(code, message))
