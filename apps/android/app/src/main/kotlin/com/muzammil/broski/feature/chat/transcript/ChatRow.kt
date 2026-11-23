package com.muzammil.broski.feature.chat.transcript

import androidx.compose.runtime.Immutable
import com.muzammil.broski.feature.chat.work.WorkFold
import com.muzammil.broski.feature.images.ImageTarget
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RunLimit
import uniffi.broski_core.ActivityLook
import uniffi.broski_core.FormatBlock

/**
 * One item of the transcript's list. Keys are unique and stable: a formatted block of the agent's text
 * keeps its key while the text streams, and the person's message keeps its key from the moment it is
 * sent to the moment the agent's `user_message` stands for it.
 */
@Immutable
sealed interface ChatRow {
    val key: String

    /** When it happened by the machine's clock, if known; only a row this new animates in. */
    val at: Long?

    @Immutable
    data class User(
        override val key: String,
        override val at: Long?,
        val text: String,
        val images: List<ImageTarget>,
        /** Sent, and not yet the agent's: dimmed until its `user_message` arrives. */
        val pending: Boolean,
    ) : ChatRow

    /** One formatted block of the agent's words; [first] blocks of a message get the message's top space. */
    @Immutable
    data class Text(
        override val key: String,
        override val at: Long?,
        val block: FormatBlock,
        val first: Boolean,
        val plan: Boolean,
        /** The containers of the block after it, where a quote's bar or a callout's card ends. */
        val next: List<UInt> = emptyList(),
        /** The last block of a text still arriving. */
        val streaming: Boolean = false,
    ) : ChatRow

    /** Under a finished answer: the pages its searches found, then the quiet copy button. */
    @Immutable
    data class CopyAnswer(
        override val key: String,
        override val at: Long?,
        val text: String,
        val sources: List<uniffi.broski_contract.LinkItem> = emptyList(),
    ) : ChatRow

    @Immutable
    data class Work(override val key: String, override val at: Long?, val fold: WorkFold) : ChatRow

    /**
     * A turn's work as one line above its answer (`WorkGroups`): the [members] rows after it, the
     * stretches of work and the words between them, show only while it is open.
     */
    @Immutable
    data class WorkGroup(override val key: String, override val at: Long?, val summary: WorkFold, val members: Int) : ChatRow

    @Immutable
    data class Note(override val key: String, override val at: Long?, val note: TranscriptNote) : ChatRow

    /** Something that happened that is not a turn, and how the core reads it. */
    @Immutable
    data class Activity(override val key: String, override val at: Long?, val activity: uniffi.broski_contract.Activity, val look: ActivityLook) : ChatRow

    /** More of the conversation is being read, above everything shown. */
    @Immutable
    data class Older(override val key: String = "older", override val at: Long? = null) : ChatRow
}

/** What the transcript says between turns, in a line. */
@Immutable
sealed interface TranscriptNote {
    data class Notice(val level: NoticeLevel, val text: String) : TranscriptNote

    data class Compacted(val tokensBefore: Long?, val tokensAfter: Long?) : TranscriptNote

    data class ModelChanged(val modelId: String?, val thinking: String?) : TranscriptNote

    /** A run that did not complete: stopped, failed with the agent's words, or cut at a limit. */
    data class Stopped(val failure: String?, val limit: RunLimit?) : TranscriptNote
}
