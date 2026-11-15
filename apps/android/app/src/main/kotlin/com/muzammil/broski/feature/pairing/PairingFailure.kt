package com.muzammil.broski.feature.pairing

import androidx.annotation.StringRes
import com.muzammil.broski.R
import uniffi.broski_core.ClientException
import uniffi.broski_core.LinkFailure

/** Why a pairing did not happen, in the words the person reads, and whether the same code may work again. */
enum class PairingFailure(@StringRes val message: Int, val retryable: Boolean = false) {
    Expired(R.string.pairing_error_expired),
    WrongCode(R.string.pairing_error_wrong_code),
    Unreachable(R.string.pairing_error_unreachable, retryable = true),
    FingerprintMismatch(R.string.pairing_error_fingerprint),
    Rejected(R.string.pairing_error_rejected),
    Timeout(R.string.pairing_error_timeout),
    OnThisPhone(R.string.pairing_error_phone),
    EmptyClipboard(R.string.pairing_error_empty_clipboard),
    ScannerUnavailable(R.string.pairing_error_scanner),
}

fun pairingFailure(error: Exception): PairingFailure = when (error) {
    is ClientException.Link -> when (error.failure) {
        LinkFailure.OFFER_EXPIRED -> PairingFailure.Expired
        LinkFailure.OFFER -> PairingFailure.WrongCode
        LinkFailure.MACHINE_UNREACHABLE -> PairingFailure.Unreachable
        LinkFailure.FINGERPRINT_MISMATCH -> PairingFailure.FingerprintMismatch
        LinkFailure.PAIRING_REJECTED -> PairingFailure.Rejected
        LinkFailure.PAIRING_TIMEOUT -> PairingFailure.Timeout
        LinkFailure.IDENTITY, LinkFailure.RECORD, LinkFailure.PUSH, LinkFailure.RANDOMNESS, LinkFailure.RUNTIME ->
            PairingFailure.OnThisPhone
    }
    is ClientException.Timeout -> PairingFailure.Timeout
    else -> PairingFailure.OnThisPhone
}

/** The core's own words for a failure, tucked under the plain sentence. */
fun failureDetail(error: Exception): String? = when (error) {
    is ClientException.Link -> error.detail
    else -> error.message
}?.takeIf { it.isNotBlank() }
