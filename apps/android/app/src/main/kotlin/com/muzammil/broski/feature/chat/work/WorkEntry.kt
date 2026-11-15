package com.muzammil.broski.feature.chat.work

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.ImageRef
import uniffi.broski_contract.JsonValue
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.ToolOutcome

/** What a tool call did, by its name: what the fold's summary counts and the row's icon shows. */
enum class ToolKind { Read, Edit, Command, Search, Fetch, Agent, Other }

/** One row of a fold of work: a tool call, a thought, or text written inside a tool call (a subagent's). */
@Immutable
sealed interface WorkEntry {
    val id: String

    @Immutable
    data class Tool(
        override val id: String,
        val name: String,
        val kind: ToolKind,
        val label: String,
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
        val running: Boolean get() = outcome == null

        val failed: Boolean get() = outcome == ToolOutcome.FAILED || (exitCode != null && exitCode != 0L)
    }

    @Immutable
    data class Thought(override val id: String, val text: String, val live: Boolean) : WorkEntry

    @Immutable
    data class Aside(override val id: String, val text: String) : WorkEntry
}

private val READ = setOf("read", "view", "cat", "notebookread", "read_file")
private val EDIT = setOf("edit", "write", "multiedit", "notebookedit", "patch", "apply_patch", "str_replace", "create", "write_file")
private val COMMAND = setOf("bash", "shell", "exec", "command", "run", "terminal", "bashoutput")
private val SEARCH = setOf("grep", "glob", "find", "ls", "search", "list", "toolsearch")
private val FETCH = setOf("webfetch", "websearch", "fetch", "web_fetch", "web_search", "browse")
private val AGENT = setOf("task", "agent", "subagent")

/** A tool's kind from its name, as the backend spells it (`Bash`, `bash`, `mcp__…` falls to [ToolKind.Other]). */
fun toolKind(name: String): ToolKind = when (name.lowercase()) {
    in READ -> ToolKind.Read
    in EDIT -> ToolKind.Edit
    in COMMAND -> ToolKind.Command
    in SEARCH -> ToolKind.Search
    in FETCH -> ToolKind.Fetch
    in AGENT -> ToolKind.Agent
    else -> ToolKind.Other
}

private val PATH_KEYS = listOf("path", "file_path", "filePath", "notebook_path", "file")
private val COMMAND_KEYS = listOf("command", "cmd")
private val SEARCH_KEYS = listOf("pattern", "query", "glob")
private val FETCH_KEYS = listOf("url", "query")
private val AGENT_KEYS = listOf("description", "prompt")

/**
 * The words a row shows for a call: the backend's own title, else what the call acts on read from
 * its input (the command, the path, the pattern, the URL), else its name.
 */
fun toolLabel(name: String, title: String?, input: JsonValue?): String {
    if (!title.isNullOrBlank()) return title
    val keys = when (toolKind(name)) {
        ToolKind.Read, ToolKind.Edit -> PATH_KEYS
        ToolKind.Command -> COMMAND_KEYS
        ToolKind.Search -> SEARCH_KEYS + PATH_KEYS
        ToolKind.Fetch -> FETCH_KEYS
        ToolKind.Agent -> AGENT_KEYS
        ToolKind.Other -> emptyList()
    }
    return keys.firstNotNullOfOrNull { input.string(it) }?.lineSequence()?.first() ?: name
}

/** A string member of an object input, or `null`. */
fun JsonValue?.string(key: String): String? =
    ((this as? JsonValue.Object)?.v1?.firstOrNull { it.key == key }?.value as? JsonValue.String)?.v1?.takeIf { it.isNotBlank() }

/** The paths a call reads or edits, from its file changes or else its input. */
fun WorkEntry.Tool.paths(): List<String> =
    fileChanges.map { it.path }.ifEmpty { PATH_KEYS.firstNotNullOfOrNull { input.string(it) }?.let(::listOf).orEmpty() }
