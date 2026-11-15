package com.muzammil.broski.feature.workspace

import androidx.annotation.StringRes
import com.muzammil.broski.R
import uniffi.broski_contract.ProtocolErrorCode
import uniffi.broski_contract.Rejection
import uniffi.broski_contract.RejectionCode
import uniffi.broski_core.ClientException

/** Why a workspace request did not do what was asked (contract README §20.4), and the bridge's own words. */
data class WorkspaceFailure(val reason: Reason, val detail: String?) {
    enum class Reason(@param:StringRes val sentence: Int) {
        Forbidden(R.string.workspace_failure_forbidden),
        NotFound(R.string.workspace_failure_not_found),

        /** Git or the file system said no; [detail] holds git's own words, which are the sentence. */
        Refused(R.string.workspace_failure_refused),
        Closed(R.string.workspace_failure_closed),
        Busy(R.string.workspace_failure_busy),
        TooMany(R.string.workspace_failure_too_many),
        Unsupported(R.string.workspace_failure_unsupported),
        MachineError(R.string.workspace_failure_machine),
        Timeout(R.string.workspace_failure_timeout),
        Offline(R.string.workspace_failure_offline),
        Incompatible(R.string.workspace_failure_incompatible),
    }

    companion object {
        fun of(rejection: Rejection) = WorkspaceFailure(
            reason = when (rejection.code) {
                RejectionCode.FORBIDDEN -> Reason.Forbidden
                RejectionCode.NOT_FOUND -> Reason.NotFound
                RejectionCode.INVALID_INPUT -> Reason.Refused
                RejectionCode.CLOSED -> Reason.Closed
                RejectionCode.BUSY -> Reason.Busy
                RejectionCode.UNSUPPORTED -> Reason.Unsupported
                RejectionCode.BACKEND_ERROR, RejectionCode.AUTH, RejectionCode.NO_MODEL,
                RejectionCode.NOT_STEERABLE, RejectionCode.STALE -> Reason.MachineError
            },
            detail = rejection.message,
        )

        fun of(error: ClientException) = when (error) {
            is ClientException.Timeout -> WorkspaceFailure(Reason.Timeout, null)
            is ClientException.LinkReset, is ClientException.NotSent, is ClientException.Closed,
            is ClientException.Revoked, is ClientException.Link -> WorkspaceFailure(Reason.Offline, error.message)
            is ClientException.Overloaded -> WorkspaceFailure(Reason.TooMany, null)
            is ClientException.Refused ->
                if (error.code == ProtocolErrorCode.RATE_LIMITED) {
                    WorkspaceFailure(Reason.TooMany, error.detail)
                } else {
                    WorkspaceFailure(Reason.MachineError, error.detail)
                }
            is ClientException.Rejected -> WorkspaceFailure(Reason.MachineError, error.detail)
            is ClientException.Incompatible -> WorkspaceFailure(Reason.Incompatible, error.detail)
            is ClientException.InvalidRequest, is ClientException.UnexpectedAnswer ->
                WorkspaceFailure(Reason.Incompatible, error.message)
        }

        /** An answer of another type than the request's: a bridge this app does not speak. */
        val Unexpected = WorkspaceFailure(Reason.Incompatible, null)
    }
}
