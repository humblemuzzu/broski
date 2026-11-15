package com.muzammil.broski.feature.workspace

import com.muzammil.broski.feature.workspace.files.FileContent
import com.muzammil.broski.feature.workspace.git.DiffRow
import com.muzammil.broski.feature.workspace.git.DiffRowKind
import com.muzammil.broski.feature.workspace.git.diffRows
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.FileEncoding
import uniffi.broski_contract.FileRead
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitDiffFile
import uniffi.broski_contract.GitDiffHunk
import uniffi.broski_contract.GitDiffLine
import uniffi.broski_contract.GitDiffLineKind
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_contract.ProtocolErrorCode
import uniffi.broski_contract.Rejection
import uniffi.broski_contract.RejectionCode
import uniffi.broski_core.ClientException
import uniffi.broski_core.SendFailure

/** What the workspace screens make of the contract's answers before they draw anything. */
class WorkspaceShapesTest {
    @Test
    fun textIsShownByLineWithTabsAtFourColumnsAndNoLineForTheFinalNewline() {
        val read = FileRead("/repo/main.rs", FileEncoding.UTF8, "fn main() {\r\n\tlet x\t= 1;\n}\n", 0, 27, 27, false)
        val content = FileContent.of(read) as FileContent.Text
        assertEquals(listOf("fn main() {", "    let x   = 1;", "}"), content.lines)
        assertFalse(content.truncated)
    }

    @Test
    fun aCutReadSaysHowMuchOfTheFileItShows() {
        val bytes = byteArrayOf(0, 1, 2, 3)
        val read = FileRead("/repo/a.bin", FileEncoding.BASE64, Base64.getEncoder().encodeToString(bytes), 0, 4, 9_000_000, true)
        val content = FileContent.of(read) as FileContent.Bytes
        assertArrayEquals(bytes, content.bytes)
        assertTrue(content.truncated)
        assertEquals(4L to 9_000_000L, content.shown to content.size)
    }

    @Test
    fun aHunkBecomesUnifiedLinesWithBothLineNumbers() {
        val file = GitDiffFile(
            path = "README.md",
            previousPath = null,
            change = GitChange.MODIFIED,
            binary = false,
            hunks = listOf(
                GitDiffHunk(
                    oldStart = 9, oldLines = 2, newStart = 9, newLines = 2, header = "## Usage",
                    lines = listOf(
                        GitDiffLine(GitDiffLineKind.CONTEXT, "# Demo", 9, 9, null),
                        GitDiffLine(GitDiffLineKind.REMOVED, "old", 10, null, true),
                        GitDiffLine(GitDiffLineKind.ADDED, "new", null, 10, null),
                    ),
                ),
            ),
        )
        assertEquals(
            listOf(
                DiffRow(DiffRowKind.Hunk, "@@ -9,2 +9,2 @@ ## Usage", ""),
                DiffRow(DiffRowKind.Context, " # Demo", " 9  9"),
                DiffRow(DiffRowKind.Removed, "-old", "10   "),
                DiffRow(DiffRowKind.NoNewline, "\\ No newline at end of file", ""),
                DiffRow(DiffRowKind.Added, "+new", "   10"),
            ),
            diffRows(file),
        )
    }

    @Test
    fun everyRejectionHasAReasonAndGitsRefusalKeepsItsWords() {
        val expected = mapOf(
            RejectionCode.FORBIDDEN to WorkspaceFailure.Reason.Forbidden,
            RejectionCode.NOT_FOUND to WorkspaceFailure.Reason.NotFound,
            RejectionCode.INVALID_INPUT to WorkspaceFailure.Reason.Refused,
            RejectionCode.CLOSED to WorkspaceFailure.Reason.Closed,
            RejectionCode.BUSY to WorkspaceFailure.Reason.Busy,
            RejectionCode.UNSUPPORTED to WorkspaceFailure.Reason.Unsupported,
            RejectionCode.BACKEND_ERROR to WorkspaceFailure.Reason.MachineError,
        )
        expected.forEach { (code, reason) -> assertEquals(code.name, reason, WorkspaceFailure.of(Rejection(code, "words")).reason) }
        val refused = WorkspaceFailure.of(Rejection(RejectionCode.INVALID_INPUT, "nothing to commit, working tree clean"))
        assertEquals(null, refused.extra)
        assertEquals("git timed out", WorkspaceFailure.of(Rejection(RejectionCode.BACKEND_ERROR, "git timed out")).extra)
    }

    @Test
    fun aLinkThatFailsUnderARequestIsSaidAsTheConnection() {
        assertEquals(WorkspaceFailure.Reason.Timeout, WorkspaceFailure.of(ClientException.Timeout()).reason)
        assertEquals(WorkspaceFailure.Reason.Offline, WorkspaceFailure.of(ClientException.LinkReset()).reason)
        assertEquals(WorkspaceFailure.Reason.Offline, WorkspaceFailure.of(ClientException.NotSent(SendFailure.CLOSED)).reason)
        assertEquals(WorkspaceFailure.Reason.TooMany, WorkspaceFailure.of(ClientException.Refused(ProtocolErrorCode.RATE_LIMITED, "slow down")).reason)
        assertEquals(WorkspaceFailure.Reason.MachineError, WorkspaceFailure.of(ClientException.Refused(ProtocolErrorCode.INTERNAL, "x")).reason)
    }

    @Test
    fun foldersInOneRepositoryAreOneRepositoryListedByName() {
        fun status(root: String, changes: Int) = GitStatusRead(root, "main", "abc", null, emptyList(), emptyList(), List(changes) { "f$it" }, false)
        val found = repositories(listOf(status("/w/zeta", 0), status("/w/Alpha", 2), status("/w/zeta", 0)))
        assertEquals(listOf("/w/Alpha" to 2, "/w/zeta" to 0), found.map { it.root to it.changes })
    }

    @Test
    fun pathsAreJoinedAndShortenedAsTheBridgeSpellsThem() {
        assertEquals("/a/b", childPath("/a", "b"))
        assertEquals("/b", childPath("/", "b"))
        assertEquals("b", lastComponent("/a/b/"))
        assertEquals("/", lastComponent("/"))
        assertEquals("/a", parentPath("/a/b"))
        assertEquals("~/code", shortPath("/Users/me/code", "/Users/me"))
        assertEquals("/Users/meet", shortPath("/Users/meet", "/Users/me"))
    }
}
