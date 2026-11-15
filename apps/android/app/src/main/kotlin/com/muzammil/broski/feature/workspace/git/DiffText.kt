package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.CodeLine
import com.muzammil.broski.design.CodeLines
import com.muzammil.broski.design.mono
import uniffi.broski_contract.GitDiffFile
import uniffi.broski_contract.GitDiffLineKind

enum class DiffRowKind { Hunk, Context, Added, Removed, NoNewline }

/** One drawn line of a unified diff: the gutter holds the old and the new line number. */
data class DiffRow(val kind: DiffRowKind, val text: String, val gutter: String)

/** A file's hunks as unified diff lines: a `@@` line per hunk, then its lines with their `+`, `-` or space. */
fun diffRows(file: GitDiffFile): List<DiffRow> {
    val width = file.hunks.maxOfOrNull { maxOf(it.oldStart + it.oldLines, it.newStart + it.newLines).toString().length } ?: 1
    fun number(line: Long?) = (line?.toString() ?: "").padStart(width)
    return file.hunks.flatMap { hunk ->
        val header = "@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@" + (hunk.header?.let { " $it" } ?: "")
        listOf(DiffRow(DiffRowKind.Hunk, header, "")) + hunk.lines.flatMap { line ->
            val (kind, sign) = when (line.kind) {
                GitDiffLineKind.CONTEXT -> DiffRowKind.Context to ' '
                GitDiffLineKind.ADDED -> DiffRowKind.Added to '+'
                GitDiffLineKind.REMOVED -> DiffRowKind.Removed to '-'
            }
            val row = DiffRow(kind, "$sign${line.text}", "${number(line.oldLine)} ${number(line.newLine)}")
            if (line.noNewline == true) listOf(row, DiffRow(DiffRowKind.NoNewline, NO_NEWLINE, "")) else listOf(row)
        }
    }
}

/**
 * A file's diff as a file-shaped card: its path and counts, then its hunks unified, added and removed
 * lines tinted and edged. The one place diff lines are drawn, so the shared core's diff rendering
 * lands here alone.
 */
@Composable
fun DiffText(
    file: GitDiffFile,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: LazyListScope.() -> Unit = {},
) {
    val done = BroskiTheme.semantic.done
    val error = MaterialTheme.colorScheme.error
    val hunk = MaterialTheme.colorScheme.primary.copy(alpha = HUNK_ALPHA)
    val rows = remember(file) { diffRows(file) }
    val lines = remember(rows, done, error, hunk) {
        rows.map { row ->
            when (row.kind) {
                DiffRowKind.Added -> CodeLine(row.text, row.gutter, done.copy(alpha = TINT_ALPHA), done)
                DiffRowKind.Removed -> CodeLine(row.text, row.gutter, error.copy(alpha = TINT_ALPHA), error)
                DiffRowKind.Hunk -> CodeLine(row.text, row.gutter, hunk)
                DiffRowKind.Context, DiffRowKind.NoNewline -> CodeLine(row.text, row.gutter)
            }
        }
    }
    val added = rows.count { it.kind == DiffRowKind.Added }
    val removed = rows.count { it.kind == DiffRowKind.Removed }
    CodeLines(lines, MaterialTheme.typography.bodySmall.mono(), wrap, modifier, contentPadding) {
        header()
        item(key = "file") { FileHeader(file.path, added, removed) }
    }
}

@Composable
private fun FileHeader(path: String, added: Int, removed: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(painterResource(R.drawable.ic_draft), contentDescription = null, modifier = Modifier.size(18.dp))
        Text(
            path,
            style = MaterialTheme.typography.labelLarge.mono(),
            maxLines = 1,
            overflow = TextOverflow.StartEllipsis,
            modifier = Modifier.weight(1f),
        )
        Text("−$removed", style = MaterialTheme.typography.labelLarge.mono(), color = MaterialTheme.colorScheme.error)
        Text("+$added", style = MaterialTheme.typography.labelLarge.mono(), color = BroskiTheme.semantic.done)
    }
}

private const val NO_NEWLINE = "\\ No newline at end of file"
private const val TINT_ALPHA = 0.16f
private const val HUNK_ALPHA = 0.08f
