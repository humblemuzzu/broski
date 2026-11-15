package com.muzammil.broski.feature.workspace.terminal

import android.view.KeyEvent
import com.muzammil.broski.terminal.Key
import com.muzammil.broski.terminal.Mods
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The terminal's sizing and key maths, without a device. */
class TerminalInputTest {
    private val metrics = CellMetrics.of(advance = 19.5f, ascent = -38.2f, descent = 10.1f)

    @Test
    fun aCellIsTheFontsAdvanceWideAndItsLineTall() {
        assertEquals(19.5f, metrics.width)
        assertEquals(49f, metrics.height)
        assertEquals(39f, metrics.baseline)
        assertEquals(20 to 49, metrics.reportedWidth to metrics.reportedHeight)
    }

    @Test
    fun theGridIsTheWholeCellsThatFitWithinTheContractsBounds() {
        assertEquals(GridSize(cols = 55, rows = 40), metrics.grid(1080, 1984))
        assertEquals(GridSize(cols = 1, rows = 1), metrics.grid(3, 3))
        assertEquals(GridSize(cols = 500, rows = 500), CellMetrics(1f, 1f, 1f).grid(4000, 4000))
    }

    @Test
    fun aTouchLandsInTheCellUnderItAndStaysInTheGrid() {
        val grid = GridSize(55, 40)
        assertEquals(0 to 0, metrics.cellAt(0f, 0f, grid))
        assertEquals(2 to 1, metrics.cellAt(39.1f, 49f, grid))
        assertEquals(54 to 39, metrics.cellAt(5000f, 5000f, grid))
        assertEquals(0 to 0, metrics.cellAt(-4f, -4f, grid))
    }

    @Test
    fun keysOfAHardwareKeyboardBecomeTheEncodersKeys() {
        assertEquals(
            KeyInput.Press(Key.C, Mods.CTRL, "c", 'c'.code),
            keyInput(KeyEvent.KEYCODE_C, KeyEvent.META_CTRL_ON, 'c'.code, 'c'.code),
        )
        assertEquals(
            KeyInput.Press(Key.Digit1, Mods.SHIFT, "!", '1'.code),
            keyInput(KeyEvent.KEYCODE_1, KeyEvent.META_SHIFT_ON, '!'.code, '1'.code),
        )
        assertEquals(KeyInput.Press(Key.ArrowUp, Mods.ALT, null, 0), keyInput(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.META_ALT_ON, 0, 0))
        assertEquals(KeyInput.Press(Key.Space, Mods.NONE, " ", ' '.code), keyInput(KeyEvent.KEYCODE_SPACE, 0, ' '.code, ' '.code))
        assertEquals(KeyInput.Type("é"), keyInput(KeyEvent.KEYCODE_E, 0, 'é'.code, 'é'.code))
        assertNull(keyInput(KeyEvent.KEYCODE_VOLUME_UP, 0, 0, 0))
        assertNull(keyInput(KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.META_SHIFT_ON, 0, 0))
    }
}
