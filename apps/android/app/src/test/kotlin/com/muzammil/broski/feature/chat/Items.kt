package com.muzammil.broski.feature.chat

import uniffi.broski_contract.ActiveRun
import uniffi.broski_contract.BlockItem
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.FileChangeKind
import uniffi.broski_contract.JsonMember
import uniffi.broski_contract.JsonValue
import uniffi.broski_contract.RunTrigger
import uniffi.broski_contract.ToolCallItem
import uniffi.broski_contract.ToolContent
import uniffi.broski_contract.ToolOutcome
import uniffi.broski_contract.ToolResult
import uniffi.broski_contract.ToolResultItem
import uniffi.broski_contract.TextContent
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.UserMessageItem

/** Transcript items as the contract's generated types carry them, for the chat's JVM tests. */
object Items {
    fun user(id: String, text: String, at: Long? = null, request: String? = null): TranscriptItem =
        TranscriptItem.UserMessage(UserMessageItem(id, at, text, emptyList(), request))

    fun text(id: String, text: String, at: Long? = null, kind: BlockKind = BlockKind.TEXT, parent: String? = null): TranscriptItem =
        TranscriptItem.Block(BlockItem(id, at, "m-$id", kind, text, parent))

    fun call(id: String, name: String, at: Long? = null, vararg input: Pair<String, String>): TranscriptItem =
        TranscriptItem.ToolCall(ToolCallItem(id, at, id, null, name, null, json(*input), null, null))

    fun result(
        id: String,
        at: Long? = null,
        outcome: ToolOutcome = ToolOutcome.COMPLETED,
        output: String = "",
        exitCode: Long? = null,
        changes: List<FileChange> = emptyList(),
    ): TranscriptItem = TranscriptItem.ToolResult(
        ToolResultItem("$id:result", at, id, outcome, ToolResult(listOf(ToolContent.Text(TextContent(output))), changes, null, exitCode)),
    )

    fun change(path: String) = FileChange(path, FileChangeKind.MODIFIED, null, "@@ -1 +1 @@\n-a\n+b\n", 1, 1)

    fun run(vararg items: TranscriptItem, startedAt: Long = 0) = ActiveRun("run", RunTrigger.PROMPT, startedAt, items.toList(), 0)

    fun json(vararg members: Pair<String, String>): JsonValue? =
        if (members.isEmpty()) null else JsonValue.Object(members.map { (key, value) -> JsonMember(key, JsonValue.String(value)) })
}
