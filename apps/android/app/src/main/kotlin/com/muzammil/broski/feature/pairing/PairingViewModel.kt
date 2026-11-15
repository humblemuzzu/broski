package com.muzammil.broski.feature.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.PhoneSession
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import uniffi.broski_core.ClientException
import uniffi.broski_core.PairingOffer
import uniffi.broski_core.parsePairingOffer

sealed interface PairingState {
    data object Idle : PairingState

    data class Preview(val offer: PairingOffer, val alreadyPaired: Boolean) : PairingState

    data class Pairing(val name: String) : PairingState

    data class Failed(val failure: PairingFailure, val detail: String? = null) : PairingState

    data class Paired(val machineId: String) : PairingState
}

/**
 * One pairing from a scanned or pasted link to a stored machine. The link carries a one-time
 * secret, so it stays in this object's memory and never in saved state.
 */
class PairingViewModel(
    private val session: PhoneSession,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val mutableState = MutableStateFlow<PairingState>(PairingState.Idle)
    val state: StateFlow<PairingState> = mutableState.asStateFlow()

    private var link: String? = null

    fun scanned(text: String) {
        link = null
        val offer = try {
            parsePairingOffer(text)
        } catch (error: ClientException) {
            mutableState.value = PairingState.Failed(pairingFailure(error), failureDetail(error))
            return
        }
        if (clock() / 1000 >= offer.expiresAt.toLong()) {
            mutableState.value = PairingState.Failed(PairingFailure.Expired)
            return
        }
        link = text
        val alreadyPaired = session.machines.value.any { it.id == offer.machineId }
        mutableState.value = PairingState.Preview(offer, alreadyPaired)
    }

    fun pasted(text: String?) {
        if (text.isNullOrBlank()) {
            mutableState.value = PairingState.Failed(PairingFailure.EmptyClipboard)
        } else {
            scanned(text.trim())
        }
    }

    fun scannerUnavailable(detail: String?) {
        mutableState.value = PairingState.Failed(PairingFailure.ScannerUnavailable, detail)
    }

    fun pair() {
        val preview = mutableState.value as? PairingState.Preview ?: return
        val offer = link ?: return
        mutableState.value = PairingState.Pairing(preview.offer.name)
        viewModelScope.launch {
            val outcome = try {
                PairingState.Paired(session.pair(offer))
            } catch (error: ClientException) {
                PairingState.Failed(pairingFailure(error), failureDetail(error))
            } catch (error: IOException) {
                PairingState.Failed(PairingFailure.OnThisPhone, failureDetail(error))
            }
            if (outcome !is PairingState.Failed || !outcome.failure.retryable) link = null
            mutableState.value = outcome
        }
    }

    /** Back to the preview of the same link, which is still unused after these failures. */
    fun retry() {
        val text = link ?: return reset()
        scanned(text)
    }

    fun reset() {
        link = null
        mutableState.value = PairingState.Idle
    }

    fun expired() {
        if (mutableState.value is PairingState.Preview) {
            link = null
            mutableState.value = PairingState.Failed(PairingFailure.Expired)
        }
    }
}
