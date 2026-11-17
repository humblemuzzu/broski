package com.muzammil.broski.core.voice

import androidx.annotation.StringRes
import com.muzammil.broski.R
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.UnknownHostException
import uniffi.broski_core.DictationException
import uniffi.broski_core.dictationErrorRetryable

/** Why a recording did not become text: a plain sentence, xAI's or the system's words under it, and what the person can do. */
data class DictationProblem(@param:StringRes val message: Int, val detail: String? = null, val fix: Fix) {
    enum class Fix {
        /** Nothing to do but discard. */
        None,

        /** The same recording can go again. */
        Retry,

        /** The key needs changing, in Voice settings. */
        VoiceSettings,

        /** The microphone is off for Broski, in the system's settings. */
        SystemSettings,
    }

    companion object {
        val microphoneDenied = DictationProblem(R.string.dictation_microphone_denied, fix = Fix.SystemSettings)

        fun of(error: DictationException): DictationProblem {
            val retry = if (dictationErrorRetryable(error)) Fix.Retry else Fix.None
            return when (error) {
                is DictationException.InvalidKey -> DictationProblem(R.string.dictation_invalid_key, error.detail, Fix.VoiceSettings)
                is DictationException.OutOfCredits -> DictationProblem(R.string.dictation_out_of_credits, error.detail, Fix.Retry)
                is DictationException.Forbidden -> DictationProblem(R.string.dictation_forbidden, error.detail, Fix.VoiceSettings)
                is DictationException.RateLimited -> DictationProblem(R.string.dictation_rate_limited, error.detail, retry)
                is DictationException.TooLarge -> DictationProblem(R.string.dictation_too_large, fix = Fix.None)
                is DictationException.Rejected -> DictationProblem(R.string.dictation_rejected, error.detail, Fix.None)
                is DictationException.Unavailable -> DictationProblem(R.string.dictation_unavailable, "${error.status} ${error.detail}".trim(), retry)
                is DictationException.Unexpected -> DictationProblem(R.string.dictation_unexpected, "${error.status} ${error.detail}".trim(), retry)
            }
        }

        /** No answer came: no connection, or one too slow. The recording is kept either way. */
        fun of(error: IOException): DictationProblem = when (error) {
            is UnknownHostException, is ConnectException -> DictationProblem(R.string.dictation_offline, fix = Fix.Retry)
            is InterruptedIOException -> DictationProblem(R.string.dictation_timed_out, fix = Fix.Retry)
            else -> DictationProblem(R.string.dictation_not_sent, error.message, Fix.Retry)
        }
    }
}
