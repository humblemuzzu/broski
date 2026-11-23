import BroskiCore
import SwiftUI
import UIKit

/// How a table's columns fit a width, the automatic layout of formatting-plan.md §5.6: natural
/// widths when they fit; else each column at least its longest word (56–200 pt) with the rest of
/// the width shared out and cells wrapping; else columns capped near 240 pt and the table scrolls
/// sideways, its first column held still when it is short. A key/value table always fits.
struct TableLayout: Equatable {
    var widths: [CGFloat]
    var scrolls: Bool
    var stickyFirstColumn: Bool
    /// Each row's height, header first, when the first column is held (it and the rest are drawn
    /// apart and must line up); empty otherwise.
    var rowHeights: [CGFloat]

    /// Rows measured for widths: past these, columns are as wide as their first rows need.
    static let measuredRows = 200

    static func fit(_ table: FormatTable, width: CGFloat, fonts: TableFonts, rows: Int) -> TableLayout {
        let (natural, minimum) = columnWidths(table, fonts: fonts)
        if table.shape == .keyValue, natural.count == 2 {
            let key = min(natural[0], width * FormatTokens.keyColumnShare)
            return TableLayout(widths: [key, max(width - key, minimum[1])], scrolls: false, stickyFirstColumn: false, rowHeights: [])
        }
        if natural.reduce(0, +) <= width {
            return TableLayout(widths: share(width, base: natural, weights: natural), scrolls: false, stickyFirstColumn: false, rowHeights: [])
        }
        if minimum.reduce(0, +) <= width {
            let weights = zip(natural, minimum).map { $0 - $1 }
            return TableLayout(widths: share(width, base: minimum, weights: weights), scrolls: false, stickyFirstColumn: false, rowHeights: [])
        }
        let capped = zip(natural, minimum).map { max(min($0, FormatTokens.tableScrollColumn), $1) }
        let sticky = table.columns.first?.short == true && capped.count > 2 && capped[0] < width * 0.4
        let heights = sticky ? rowHeights(table, widths: capped, fonts: fonts, rows: rows) : []
        return TableLayout(widths: capped, scrolls: true, stickyFirstColumn: sticky, rowHeights: heights)
    }

    /// Each column's width on one line, and its narrowest without breaking a word (56–200 pt).
    static func columnWidths(_ table: FormatTable, fonts: TableFonts) -> (natural: [CGFloat], minimum: [CGFloat]) {
        let padding = FormatTokens.tableCellPadding.leading + FormatTokens.tableCellPadding.trailing
        let measured = table.columns.indices.map { measure(column: $0, in: table, fonts: fonts) }
        let natural = measured.map { $0.natural + padding }
        let minimum = measured.map { min(max($0.word + padding, FormatTokens.tableMinColumn), FormatTokens.tableMaxMinColumn) }
        return (natural, minimum)
    }

    /// `base` widened to fill `width`, the extra shared by `weights`.
    private static func share(_ width: CGFloat, base: [CGFloat], weights: [CGFloat]) -> [CGFloat] {
        let extra: CGFloat = max(width - base.reduce(0, +), 0)
        let total: CGFloat = weights.reduce(0, +)
        let even: CGFloat = extra / CGFloat(max(base.count, 1))
        return zip(base, weights).map { (column: CGFloat, weight: CGFloat) -> CGFloat in
            column + (total > 0 ? extra * weight / total : even)
        }
    }

    private static func measure(column: Int, in table: FormatTable, fonts: TableFonts) -> (natural: CGFloat, word: CGFloat) {
        let header = fonts.measurable(table.header[column].spans, header: true)
        var natural = width(of: header)
        var word = longestWord(header)
        for row in table.rows.prefix(measuredRows) {
            let text = fonts.measurable(row[column].spans, header: false)
            natural = max(natural, width(of: text))
            word = max(word, longestWord(text))
        }
        return ((natural + 1).rounded(.up), (word + 1).rounded(.up))
    }

    /// `widths` as they are, with every row's height measured, for the viewer.
    static func measured(_ table: FormatTable, widths: [CGFloat], fonts: TableFonts) -> TableLayout {
        TableLayout(widths: widths, scrolls: true, stickyFirstColumn: true, rowHeights: rowHeights(table, widths: widths, fonts: fonts, rows: table.rows.count))
    }

    private static func rowHeights(_ table: FormatTable, widths: [CGFloat], fonts: TableFonts, rows: Int) -> [CGFloat] {
        let padding = FormatTokens.tableCellPadding
        let inner = widths.map { $0 - padding.leading - padding.trailing }
        let height = { (cells: [TableCell], header: Bool) -> CGFloat in
            let tallest = zip(cells, inner).map { height(of: fonts.measurable($0.spans, header: header), width: $1) }.max() ?? 0
            return (tallest + padding.top + padding.bottom).rounded(.up)
        }
        return [height(table.header, true)] + table.rows.prefix(rows).map { height($0, false) }
    }

    static func plain(_ spans: [FormatSpan]) -> String {
        spans.map(\.text).joined()
    }

    private static func width(of text: NSAttributedString) -> CGFloat {
        text.boundingRect(with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).width
    }

    private static func longestWord(_ text: NSAttributedString) -> CGFloat {
        let string = text.string as NSString
        var widest: CGFloat = 0
        var start = 0
        for index in 0...string.length {
            let ends = index == string.length || CharacterSet.whitespacesAndNewlines.contains(UnicodeScalar(string.character(at: index)) ?? " ")
            guard ends else { continue }
            if index > start { widest = max(widest, text.attributedSubstring(from: NSRange(location: start, length: index - start)).size().width) }
            start = index + 1
        }
        return widest
    }

    private static func height(of text: NSAttributedString, width: CGFloat) -> CGFloat {
        text.boundingRect(
            with: CGSize(width: max(width, 1), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        ).height
    }
}

/// Layouts kept by table, width, text size and rows shown, since measuring a table's cells in their
/// fonts is the costly part of drawing it and a row scrolled back into view asks again.
@MainActor
enum TableLayoutCache {
    private struct Key: Hashable {
        let table: FormatTable
        let width: CGFloat
        let fonts: TableFonts
        let rows: Int
        /// The viewer's layout: every column up to `width`, every row measured.
        let whole: Bool
    }

    private static var layouts: [Key: TableLayout] = [:]
    private static let capacity = 64

    static func fit(_ table: FormatTable, width: CGFloat, fonts: TableFonts, rows: Int) -> TableLayout {
        cached(Key(table: table, width: width, fonts: fonts, rows: rows, whole: false)) {
            TableLayout.fit(table, width: width, fonts: fonts, rows: rows)
        }
    }

    /// Every column at its natural width up to `maxColumn`, every row measured, for the viewer.
    static func whole(_ table: FormatTable, maxColumn: CGFloat, fonts: TableFonts) -> TableLayout {
        cached(Key(table: table, width: maxColumn, fonts: fonts, rows: table.rows.count, whole: true)) {
            let (natural, minimum) = TableLayout.columnWidths(table, fonts: fonts)
            let widths = zip(natural, minimum).map { max(min($0, maxColumn), $1) }
            return TableLayout.measured(table, widths: widths, fonts: fonts)
        }
    }

    private static func cached(_ key: Key, measure: () -> TableLayout) -> TableLayout {
        if let known = layouts[key] { return known }
        if layouts.count >= capacity { layouts.removeAll(keepingCapacity: true) }
        let layout = measure()
        layouts[key] = layout
        return layout
    }
}

/// The fonts a table is drawn and measured in, at the text size on screen, in points so the
/// measurement and the drawing agree: digits tabular, inline code monospaced.
struct TableFonts: Hashable {
    let cell: UIFont
    let header: UIFont
    let code: UIFont

    init(typeSize: DynamicTypeSize, scale: CGFloat = 1) {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(typeSize))
        let size = (UIFont.preferredFont(forTextStyle: .subheadline, compatibleWith: traits).pointSize - 0.5) * scale
        cell = .monospacedDigitSystemFont(ofSize: size, weight: .regular)
        header = .monospacedDigitSystemFont(ofSize: size, weight: .medium)
        code = .monospacedSystemFont(ofSize: size * FormatTokens.inlineCodeScale, weight: .regular)
    }

    func spanStyle(underlinesLinks: Bool) -> SpanStyle {
        SpanStyle(
            font: .system(size: cell.pointSize).monospacedDigit(),
            codeFont: .system(size: code.pointSize, design: .monospaced),
            underlinesLinks: underlinesLinks, size: cell.pointSize)
    }

    func measurable(_ spans: [FormatSpan], header isHeader: Bool) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 2
        let text = NSMutableAttributedString()
        for span in spans {
            let mono = span.code || span.math || span.html
            let font = mono ? code : (span.strong || isHeader ? header : cell)
            text.append(NSAttributedString(string: span.text, attributes: [.font: font, .paragraphStyle: paragraph]))
        }
        return text.length == 0
            ? NSAttributedString(string: " ", attributes: [.font: isHeader ? header : cell, .paragraphStyle: paragraph])
            : text
    }
}
