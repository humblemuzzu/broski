package com.muzammil.broski.terminal

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The JNI shim over the host build of libghostty-vt 1.0.1, as the app drives it. */
class VtTerminalTest {
    private val terminal = VtTerminal(cols = 20, rows = 5)

    @After
    fun tearDown() = terminal.close()

    private fun write(text: String): ByteArray = terminal.write(text.toByteArray())

    private fun screen(): Screen {
        terminal.update()
        return terminal.screen()
    }

    @Test
    fun anSgrColourReachesTheCellsItColours() {
        write("\u001b[31mred\u001b[0m plain")
        val screen = screen()
        assertEquals("red plain", screen.line(0))
        val red = screen.attrs(0, 0)
        assertTrue(red and Cell.HAS_FOREGROUND != 0)
        val fg = screen.foreground(0, 0)
        val (r, g, b) = Triple(fg shr 16 and 0xFF, fg shr 8 and 0xFF, fg and 0xFF)
        assertTrue("palette red is #%06x".format(fg and 0xFFFFFF), r > g && r > b)
        assertEquals(0, screen.attrs(4, 0) and Cell.HAS_FOREGROUND)
    }

    @Test
    fun boldUnderlineAndInverseAreFlagged() {
        write("\u001b[1;4;7mX")
        val attrs = screen().attrs(0, 0)
        assertTrue(attrs and Cell.BOLD != 0)
        assertTrue(attrs and Cell.INVERSE != 0)
        assertEquals(1, Cell.underline(attrs))
    }

    @Test
    fun onlyRowsThatChangedGetANewVersion() {
        write("one\r\ntwo")
        val first = screen()
        write("\u001b[2;1Hzwo")
        val second = screen()
        assertEquals("zwo", second.line(1))
        assertEquals(first.rowVersions[0], second.rowVersions[0])
        assertNotEquals(first.rowVersions[1], second.rowVersions[1])
        assertFalse(terminal.update())
    }

    @Test
    fun aWideCharacterTakesTwoCellsAndAClusterStaysWhole() {
        write("界a\uD83D\uDC4D\uD83C\uDFFD")
        val screen = screen()
        assertEquals("界", screen.text(0, 0))
        assertEquals(Cell.Width.Wide, Cell.width(screen.attrs(0, 0)))
        assertEquals(Cell.Width.SpacerTail, Cell.width(screen.attrs(1, 0)))
        assertEquals("a", screen.text(2, 0))
        assertEquals("\uD83D\uDC4D\uD83C\uDFFD", screen.text(3, 0))
        write("\r\u001b[2K")
        assertEquals("", screen().text(3, 0))
    }

    @Test
    fun theCursorFollowsTheOutput() {
        write("ab\r\ncd")
        val cursor = screen().cursor
        assertTrue(cursor.visible)
        assertEquals(2, cursor.col)
        assertEquals(1, cursor.row)
        write("\u001b[?25l")
        assertFalse(screen().cursor.visible)
    }

    @Test
    fun aResizeReflowsAndTheScreenTakesTheNewSize() {
        write("0123456789abcdefghij")
        terminal.resize(cols = 10, rows = 4, cellWidth = 9, cellHeight = 18)
        val screen = screen()
        assertEquals(10, screen.cols)
        assertEquals(4, screen.rows)
        assertTrue(terminal.text().contains("0123456789abcdefghij"))
    }

    @Test
    fun aDeviceAttributesQueryIsAnswered() {
        val answer = String(write("\u001b[c"))
        assertTrue(answer, answer.startsWith("\u001b[?"))
        assertEquals(0, write("plain").size)
    }

    @Test
    fun keysAreEncodedForTheProgramsKeyMode() {
        assertArrayEquals(byteArrayOf(3), terminal.encode(Key.C, Mods.CTRL, "c", 'c'.code))
        assertArrayEquals("\u001b[A".toByteArray(), terminal.encode(Key.ArrowUp))
        assertArrayEquals(byteArrayOf(0x7f), terminal.encode(Key.Backspace))
        assertArrayEquals("\r".toByteArray(), terminal.encode(Key.Enter))
        write("\u001b[?1h")
        assertArrayEquals("\u001bOA".toByteArray(), terminal.encode(Key.ArrowUp))
    }

    @Test
    fun aPasteIsBracketedOnlyWhenTheProgramAskedAndALineBreakNeedsAWord() {
        assertArrayEquals("ls".toByteArray(), terminal.paste("ls"))
        assertTrue(terminal.isPasteSafe("ls"))
        assertFalse(terminal.isPasteSafe("rm -rf x\n"))
        write("\u001b[?2004h")
        assertArrayEquals("\u001b[200~ls\u001b[201~".toByteArray(), terminal.paste("ls"))
        assertTrue(terminal.isPasteSafe("two\nlines"))
        assertFalse(terminal.isPasteSafe("a\u001b[201~b"))
    }

    @Test
    fun aSelectionIsMarkedAndCopiedAsText() {
        write("hello world\r\nnext line")
        assertNull(terminal.selectedText())
        assertTrue(terminal.selectWord(7, 0))
        assertEquals("world", terminal.selectedText())
        assertTrue(screen().attrs(6, 0) and Cell.SELECTED != 0)
        assertTrue(terminal.select(6, 0, 3, 1))
        assertEquals("world\nnext", terminal.selectedText())
        terminal.clearSelection()
        assertNull(terminal.selectedText())
    }

    @Test
    fun scrollingMovesTheViewportThroughTheScrollback() {
        repeat(12) { write("line $it\r\n") }
        assertTrue(screen().scrollback.atBottom)
        terminal.scroll(-3)
        val scrolled = screen()
        assertFalse(scrolled.scrollback.atBottom)
        assertEquals("line 5", scrolled.line(0))
        terminal.scrollToBottom()
        assertTrue(screen().scrollback.atBottom)
    }

    @Test
    fun theScrollbackHoldsWhatAReattachReplaysAtAPhonesWidth() {
        VtTerminal(cols = 50, rows = 30).use { phone ->
            phone.write((0 until 9_000).joinToString("") { "line $it ${"x".repeat(30)}\r\n" }.toByteArray())
            val kept = phone.text().lines().filter { it.startsWith("line ") }
            assertEquals("line 0 ${"x".repeat(30)}", kept.first())
            assertEquals(9_000, kept.size)
        }
    }

    @Test
    fun aResetClearsTheScreen() {
        write("gone")
        terminal.reset()
        assertEquals("", screen().line(0))
    }
}
