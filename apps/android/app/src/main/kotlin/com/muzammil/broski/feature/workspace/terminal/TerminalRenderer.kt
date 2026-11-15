package com.muzammil.broski.feature.workspace.terminal

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Picture
import android.graphics.Typeface
import android.os.Build
import com.muzammil.broski.terminal.Cell
import com.muzammil.broski.terminal.CursorStyle
import com.muzammil.broski.terminal.Screen

/** The app's colours for what a program leaves to the terminal, ARGB. */
data class TerminalColors(val selection: Int, val onSelection: Int, val cursor: Int)

/** JetBrains Mono at one size: the paints for each face, the cell they make, and which codepoints the font draws. */
class TerminalFont(base: Typeface, sizePx: Float) {
    private val faces = Array(4) { index -> face(base, bold = index and 1 != 0, italic = index and 2 != 0) }
    private val paints = Array(4) { index ->
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            typeface = faces[index]
            textSize = sizePx
            // Ligatures would join `->` into one glyph and shift the grid's reading of it.
            fontFeatureSettings = "'liga' 0, 'calt' 0"
        }
    }
    private val glyphs = HashMap<Int, Boolean>()

    val metrics: CellMetrics = paints[0].let { CellMetrics.of(it.measureText("M"), it.fontMetrics.ascent, it.fontMetrics.descent) }

    fun paint(attrs: Int): Paint = paints[(if (attrs and Cell.BOLD != 0) 1 else 0) or (if (attrs and Cell.ITALIC != 0) 2 else 0)]

    /** Whether JetBrains Mono itself draws `codepoint`, so it keeps the grid's advance. */
    fun draws(codepoint: Int): Boolean = glyphs.getOrPut(codepoint) { paints[0].hasGlyph(String(Character.toChars(codepoint))) }

    private fun face(base: Typeface, bold: Boolean, italic: Boolean): Typeface =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Typeface.create(base, if (bold) BOLD_WEIGHT else REGULAR_WEIGHT, italic)
        } else {
            Typeface.create(base, (if (bold) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0))
        }

    private companion object {
        const val REGULAR_WEIGHT = 400
        const val BOLD_WEIGHT = 700
    }
}

/**
 * Draws a [Screen]. Each row is recorded once into a [Picture] and replayed until its version
 * changes, so a frame redraws only the rows the program touched; the cursor is drawn on top.
 */
class TerminalRenderer(private val font: TerminalFont, private val colors: TerminalColors) {
    private var pictures = arrayOfNulls<Picture>(0)
    private var versions = LongArray(0)
    private var cols = 0
    private val fill = Paint()
    private val runText = StringBuilder()

    fun draw(canvas: Canvas, screen: Screen) {
        if (screen.rows != pictures.size || screen.cols != cols) {
            pictures = arrayOfNulls(screen.rows)
            versions = LongArray(screen.rows) { -1 }
            cols = screen.cols
        }
        val height = font.metrics.height
        canvas.drawColor(screen.background)
        for (row in 0 until screen.rows) {
            if (versions[row] != screen.rowVersions[row] || pictures[row] == null) {
                pictures[row] = record(screen, row)
                versions[row] = screen.rowVersions[row]
            }
            canvas.save()
            canvas.translate(0f, row * height)
            canvas.drawPicture(pictures[row]!!)
            canvas.restore()
        }
        drawCursor(canvas, screen)
    }

    private fun record(screen: Screen, row: Int): Picture {
        val metrics = font.metrics
        val picture = Picture()
        val canvas = picture.beginRecording((metrics.width * screen.cols).toInt() + 1, metrics.height.toInt())
        for (col in 0 until screen.cols) drawBackground(canvas, screen, col, row)
        drawText(canvas, screen, row)
        picture.endRecording()
        return picture
    }

    private fun drawBackground(canvas: Canvas, screen: Screen, col: Int, row: Int) {
        val attrs = screen.attrs(col, row)
        val background = cellColors(screen, col, row, attrs).second ?: return
        val span = if (Cell.width(attrs) == Cell.Width.Wide) 2 else 1
        fill.color = background
        val width = font.metrics.width
        canvas.drawRect(col * width, 0f, (col + span) * width, font.metrics.height, fill)
    }

    /** Foreground and background of a cell; a null background is the screen's own. */
    private fun cellColors(screen: Screen, col: Int, row: Int, attrs: Int): Pair<Int, Int?> {
        var foreground = if (attrs and Cell.HAS_FOREGROUND != 0) screen.foreground(col, row) else screen.foreground
        var background: Int? = if (attrs and Cell.HAS_BACKGROUND != 0) screen.background(col, row) else null
        if (attrs and Cell.INVERSE != 0) {
            val swapped = background ?: screen.background
            background = foreground
            foreground = swapped
        }
        if (attrs and Cell.SELECTED != 0) return colors.onSelection to colors.selection
        if (attrs and Cell.FAINT != 0) foreground = (foreground and 0x00FFFFFF) or (FAINT_ALPHA shl 24)
        return foreground to background
    }

    /** Runs of narrow cells with one style and glyphs of the font go out as one string; anything else alone, in its cells. */
    private fun drawText(canvas: Canvas, screen: Screen, row: Int) {
        var runStart = -1
        var runAttrs = 0
        var runColor = 0
        fun flush() {
            if (runStart >= 0) drawString(canvas, runText.toString(), runStart, runAttrs, runColor)
            runText.setLength(0)
            runStart = -1
        }
        for (col in 0 until screen.cols) {
            val attrs = screen.attrs(col, row)
            val text = screen.text(col, row)
            val width = Cell.width(attrs)
            if (text.isEmpty() || attrs and Cell.INVISIBLE != 0 || width == Cell.Width.SpacerTail) {
                flush()
                continue
            }
            val color = cellColors(screen, col, row, attrs).first
            val single = text.codePointCount(0, text.length) == 1 && width == Cell.Width.Narrow && font.draws(text.codePointAt(0))
            if (!single) {
                flush()
                drawString(canvas, text, col, attrs, color)
                continue
            }
            if (runStart >= 0 && (attrs != runAttrs || color != runColor)) flush()
            if (runStart < 0) {
                runStart = col
                runAttrs = attrs
                runColor = color
            }
            runText.append(text)
        }
        flush()
    }

    private fun drawString(canvas: Canvas, text: String, col: Int, attrs: Int, color: Int) {
        val metrics = font.metrics
        val paint = font.paint(attrs)
        paint.color = color
        val x = col * metrics.width
        canvas.drawText(text, x, metrics.baseline, paint)
        val end = x + paint.measureText(text).coerceAtLeast(metrics.width)
        if (Cell.underline(attrs) != 0) canvas.drawRect(x, metrics.baseline + LINE, end, metrics.baseline + 2 * LINE, paint)
        if (attrs and Cell.STRIKETHROUGH != 0) {
            val middle = metrics.height / 2
            canvas.drawRect(x, middle, end, middle + LINE, paint)
        }
    }

    private fun drawCursor(canvas: Canvas, screen: Screen) {
        val cursor = screen.cursor
        if (!cursor.visible || cursor.row >= screen.rows || cursor.col >= screen.cols) return
        val metrics = font.metrics
        val left = cursor.col * metrics.width
        val top = cursor.row * metrics.height
        fill.color = cursor.color ?: colors.cursor
        fill.style = if (cursor.style == CursorStyle.BlockHollow) Paint.Style.STROKE else Paint.Style.FILL
        fill.strokeWidth = CURSOR_LINE
        when (cursor.style) {
            CursorStyle.Bar -> canvas.drawRect(left, top, left + CURSOR_LINE, top + metrics.height, fill)
            CursorStyle.Underline -> canvas.drawRect(left, top + metrics.height - CURSOR_LINE, left + metrics.width, top + metrics.height, fill)
            CursorStyle.Block, CursorStyle.BlockHollow -> canvas.drawRect(left, top, left + metrics.width, top + metrics.height, fill)
        }
        fill.style = Paint.Style.FILL
        if (cursor.style == CursorStyle.Block) {
            val text = screen.text(cursor.col, cursor.row)
            if (text.isNotEmpty()) {
                val paint = font.paint(screen.attrs(cursor.col, cursor.row))
                paint.color = screen.background
                canvas.drawText(text, left, top + metrics.baseline, paint)
            }
        }
    }

    private companion object {
        const val FAINT_ALPHA = 0x99
        const val LINE = 2f
        const val CURSOR_LINE = 4f
    }
}
