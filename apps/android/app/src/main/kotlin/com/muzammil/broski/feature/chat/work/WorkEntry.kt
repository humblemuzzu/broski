package com.muzammil.broski.feature.chat.work

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.ImageRef
import uniffi.broski_contract.JsonValue
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.ToolOutcome
import uniffi.broski_core.ToolKind
import uniffi.broski_core.ToolLook

/** One row of a fold of work: a tool call, a thought, or text written inside a tool call (a subagent's). */
@Immutable
sealed interface WorkEntry {
    val id: String

    @Immutable
    data class Tool(
        override val id: String,
        val name: String,
        /** How the core reads the call: its kind, row label and command. */
        val look: ToolLook,
        val input: JsonValue?,
        /** `null` while it runs. */
        val outcome: ToolOutcome?,
        val output: String,
        val error: String?,
        val exitCode: Long?,
        val fileChanges: List<FileChange>,
        val images: List<ImageRef>,
        val childSession: SessionRef?,
        val nested: Boolean,
    ) : WorkEntry {
        val kind: ToolKind get() = look.kind

        val label: String get() = look.label

        val running: Boolean get() = outcome == null

        val failed: Boolean get() = outcome == ToolOutcome.FAILED || (exitCode != null && exitCode != 0L)
    }

    @Immutable
    data class Thought(override val id: String, val text: String, val live: Boolean) : WorkEntry

    @Immutable
    data class Aside(override val id: String, val text: String) : WorkEntry
}
