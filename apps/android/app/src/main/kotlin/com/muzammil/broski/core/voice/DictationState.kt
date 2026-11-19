package com.muzammil.broski.core.voice

import androidx.compose.runtime.Immutable
import uniffi.broski_core.DictationSources
import uniffi.broski_core.dictationInsert

/** A composer that dictates: where the text goes, and what the session can tell the speech model. */
class DictationTarget(
    /** The composer's identity; only that composer shows the recording. */
    val id: String,
    /** The session's names, gathered while the person speaks. */
    val sources: suspend () -> DictationSources,
    val insert: (String) -> Unit,
    /** Sends the composer as its button would; `null` where it cannot send by itself. */
    val send: (() -> Unit)?,
)

sealed interface DictationPhase {
    data object Idle : DictationPhase

    /** [held] while the finger stays on the mic; [cancelling] while it has slid away. */
    data class Recording(val held: Boolean, val cancelling: Boolean) : DictationPhase

    data object Transcribing : DictationPhase

    data class Failed(val problem: DictationProblem) : DictationPhase
}

/** A line under the composer after a dictation, gone after a few seconds. */
data class DictationNotice(val owner: String, val kind: Kind, val id: Long) {
    enum class Kind { HeardNothing, TooShort, PhoneRecognizer, NoRecognizer, MicrophoneReady }
}

/** A moment the owning composer plays a haptic for. */
data class DictationFeedback(val owner: String, val moment: Moment) {
    enum class Moment { Listening, Stopped, Inserted, Cancelled, Failed }
}

@Immutable
data class DictationState(
    /** The composer [phase] belongs to. */
    val owner: String? = null,
    val phase: DictationPhase = DictationPhase.Idle,
    /** The loudness of the last few seconds, newest last. */
    val levels: List<Float> = emptyList(),
    val startedAtMs: Long? = null,
    val notice: DictationNotice? = null,
) {
    fun phaseFor(id: String): DictationPhase = if (owner == id) phase else DictationPhase.Idle

    fun noticeFor(id: String): DictationNotice? = notice?.takeIf { it.owner == id }

    /** Another composer's dictation is under way, so this one's mic waits. */
    fun busyApartFrom(id: String): Boolean = owner != null && owner != id && phase !is DictationPhase.Failed

    companion object {
        /** Inserts [addition] into [text] via the shared Rust rule (CJK no-space, brackets, punctuation). */
        fun joined(text: String, addition: String, language: String? = null): String =
            dictationInsert(text, null, addition, language).text
    }
}

/** What the person did on the mic, as [Dictation.press] reads it. */
enum class PressOutcome {
    Started,
    Ignored,

    /** No xAI key: the phone's own recognizer stands in. */
    NeedsPhoneRecognizer,
}
