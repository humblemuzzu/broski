package com.muzammil.broski.feature.workspace.terminal

import android.graphics.Typeface
import android.view.KeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import com.muzammil.broski.R
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.design.mono
import com.muzammil.broski.terminal.Screen

/** The terminal's font size range, in sp, that pinching moves through. */
val TerminalFontSizes = 8f..28f

/** What the terminal canvas reports back to its screen. */
class TerminalCanvasCallbacks(val onFontSize: (Float) -> Unit, val onSelected: () -> Unit)

/**
 * The terminal on screen: its grid drawn from the emulator, sized to the space it has (sent to the
 * Mac once a resize settles), and the input to it: the keyboard while focused, a tap to raise it,
 * a long press then drag to select, a vertical drag through the scrollback, a pinch for the font size.
 */
@Composable
fun TerminalCanvas(
    terminal: TerminalViewModel,
    keyboard: TerminalKeyboard,
    typeface: Typeface,
    fontSize: Float,
    focus: FocusRequester,
    callbacks: TerminalCanvasCallbacks,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val font = remember(typeface, fontSize, density) { TerminalFont(typeface, with(density) { fontSize.sp.toPx() }) }
    val renderer = rememberRenderer(terminal, font)
    val screen = terminal.screen.collectAsStateWithLifecycle()
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    var showRequests by remember { mutableIntStateOf(0) }
    LaunchedEffect(viewSize, font) {
        if (viewSize == IntSize.Zero) return@LaunchedEffect
        val grid = font.metrics.grid(viewSize.width, viewSize.height)
        terminal.resize(TerminalSize(grid.cols, grid.rows, font.metrics.reportedWidth, font.metrics.reportedHeight))
    }
    val scroll = rememberRowScroll(terminal, font.metrics)
    val haptics = LocalHapticFeedback.current
    val label = stringResource(R.string.terminal_title)
    Box(
        modifier
            .onSizeChanged { viewSize = it }
            .semantics {
                contentDescription = label
                text = AnnotatedString(screen.value.visibleText())
            }
            .terminalInput(keyboard, showRequests)
            .focusRequester(focus)
            .hardwareKeys(keyboard)
            .focusable()
            .pointerInput(font) {
                detectTapGestures(onLongPress = {}) {
                    focus.requestFocus()
                    showRequests++
                }
            }
            .selection(terminal, font.metrics, screen, haptics, callbacks.onSelected)
            .scrollable(scroll, Orientation.Vertical)
            .pinch { scale -> callbacks.onFontSize((fontSize * scale).coerceIn(TerminalFontSizes)) },
    ) {
        Box(Modifier.fillMaxSize().drawBehind { drawIntoCanvas { renderer.draw(it.nativeCanvas, screen.value) } })
        Composing(keyboard.composing, screen.value, font.metrics)
    }
}

@Composable
private fun rememberRenderer(terminal: TerminalViewModel, font: TerminalFont): TerminalRenderer {
    val scheme = MaterialTheme.colorScheme
    val foreground = scheme.onSurface.toArgb()
    val background = scheme.surfaceContainerLowest.toArgb()
    val cursor = scheme.primary.toArgb()
    LaunchedEffect(foreground, background, cursor) { terminal.setColors(foreground, background, cursor) }
    val colors = TerminalColors(selection = scheme.primaryContainer.toArgb(), onSelection = scheme.onPrimaryContainer.toArgb(), cursor = cursor)
    return remember(font, colors) { TerminalRenderer(font, colors) }
}

/** A drag through the scrollback a whole row at a time, with fling; up the screen is back in time. */
@Composable
private fun rememberRowScroll(terminal: TerminalViewModel, metrics: CellMetrics): ScrollableState {
    var pending by remember { mutableFloatStateOf(0f) }
    return rememberScrollableState { delta ->
        pending += delta
        val rows = (pending / metrics.height).toInt()
        if (rows != 0) {
            terminal.scroll(-rows)
            pending -= rows * metrics.height
        }
        delta
    }
}

private fun Modifier.selection(
    terminal: TerminalViewModel,
    metrics: CellMetrics,
    screen: State<Screen>,
    haptics: HapticFeedback,
    onSelected: () -> Unit,
): Modifier = pointerInput(metrics) {
    var anchor = 0 to 0
    fun grid() = GridSize(screen.value.cols.coerceAtLeast(1), screen.value.rows.coerceAtLeast(1))
    detectDragGesturesAfterLongPress(
        onDragStart = { offset ->
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            anchor = metrics.cellAt(offset.x, offset.y, grid())
            terminal.selectWord(anchor.first, anchor.second)
        },
        onDrag = { change, _ ->
            val (col, row) = metrics.cellAt(change.position.x, change.position.y, grid())
            val forward = row > anchor.second || (row == anchor.second && col >= anchor.first)
            if (forward) terminal.select(anchor.first, anchor.second, col, row) else terminal.select(col, row, anchor.first, anchor.second)
        },
        onDragEnd = onSelected,
    )
}

private fun Modifier.hardwareKeys(keyboard: TerminalKeyboard): Modifier = onPreviewKeyEvent { event ->
    val input = event.nativeKeyEvent.takeIf { it.action == KeyEvent.ACTION_DOWN }?.let(::keyInput)
    input?.let(keyboard::press)
    input != null
}

/** Two fingers apart or together; the scale is reported once they lift. */
private fun Modifier.pinch(onScale: (Float) -> Unit): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var scale = 1f
        do {
            val event = awaitPointerEvent()
            if (event.changes.size >= 2) {
                scale *= event.calculateZoom()
                event.changes.forEach { it.consume() }
            }
        } while (event.changes.any { it.pressed })
        if (scale != 1f) onScale(scale)
    }
}

/** What the screen shows, line by line, as TalkBack reads it out. */
private fun Screen.visibleText(): String = (0 until rows).joinToString("\n") { line(it) }.trimEnd()

/** The IME's composing text, drawn at the cursor until it is committed. */
@Composable
private fun Composing(text: String, screen: Screen, metrics: CellMetrics) {
    if (text.isEmpty()) return
    val cursor = screen.cursor
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium.mono(),
        textDecoration = TextDecoration.Underline,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = Modifier
            .offset { IntOffset((cursor.col * metrics.width).toInt(), (cursor.row * metrics.height).toInt()) }
            .background(MaterialTheme.colorScheme.primaryContainer),
    )
}
