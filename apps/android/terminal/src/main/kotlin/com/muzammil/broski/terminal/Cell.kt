package com.muzammil.broski.terminal

/** The bits of a cell's attribute word: libghostty-vt's style flags, then what the shim adds. */
object Cell {
    const val BOLD = 1
    const val ITALIC = 1 shl 1
    const val FAINT = 1 shl 2
    const val BLINK = 1 shl 3
    const val INVERSE = 1 shl 4
    const val INVISIBLE = 1 shl 5
    const val STRIKETHROUGH = 1 shl 6
    const val OVERLINE = 1 shl 7
    private const val UNDERLINE_SHIFT = 8
    const val HAS_FOREGROUND = 1 shl 11
    const val HAS_BACKGROUND = 1 shl 12
    const val SELECTED = 1 shl 13
    private const val WIDE_SHIFT = 14

    /** 0 none, 1 single, 2 double, 3 curly, 4 dotted, 5 dashed (`GhosttySgrUnderline`). */
    fun underline(attrs: Int): Int = (attrs shr UNDERLINE_SHIFT) and 0x7

    fun width(attrs: Int): Width = Width.entries[(attrs shr WIDE_SHIFT) and 0x3]

    /** `GhosttyCellWide`: a wide character takes its cell and the spacer after it. */
    enum class Width { Narrow, Wide, SpacerTail, SpacerHead }
}

/** `GhosttyCursorStyle`. */
enum class CursorStyle { Bar, Block, Underline, BlockHollow }
