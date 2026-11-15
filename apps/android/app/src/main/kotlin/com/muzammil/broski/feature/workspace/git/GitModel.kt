package com.muzammil.broski.feature.workspace.git

import uniffi.broski_contract.GitBranch
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitStatusRead

/** Where a change sits: staged in the index, changed in the work tree, or not tracked at all. */
enum class Area { Staged, Unstaged, Untracked }

/** One row of a git list. Counts are absent for a binary or conflicted file, and for an untracked one. */
data class ChangeRow(
    val path: String,
    val previousPath: String?,
    val change: GitChange?,
    val additions: Long?,
    val deletions: Long?,
    val area: Area,
) {
    val name: String get() = path.substringAfterLast('/')
    val folder: String? get() = path.substringBeforeLast('/', "").ifEmpty { null }
}

data class ChangeSection(val area: Area, val rows: List<ChangeRow>)

/** The repository's lists in the order the screen shows them; an empty list is left out. */
fun changeSections(status: GitStatusRead): List<ChangeSection> = listOf(
    ChangeSection(Area.Staged, status.staged.map { ChangeRow(it.path, it.previousPath, it.change, it.additions, it.deletions, Area.Staged) }),
    ChangeSection(Area.Unstaged, status.unstaged.map { ChangeRow(it.path, it.previousPath, it.change, it.additions, it.deletions, Area.Unstaged) }),
    ChangeSection(Area.Untracked, status.untracked.map { ChangeRow(it, null, null, null, null, Area.Untracked) }),
).filter { it.rows.isNotEmpty() }

/** The one-letter mark git itself prints for a change. */
val ChangeRow.letter: String
    get() = when (change) {
        null -> "U"
        GitChange.ADDED -> "A"
        GitChange.MODIFIED -> "M"
        GitChange.DELETED -> "D"
        GitChange.RENAMED -> "R"
        GitChange.COPIED -> "C"
        GitChange.TYPE_CHANGED -> "T"
        GitChange.CONFLICTED -> "!"
    }

/** The name `git.checkout` takes: a remote branch without its remote, which makes a local branch tracking it. */
fun checkoutName(branch: GitBranch): String = if (branch.remote) branch.name.substringAfter('/') else branch.name
