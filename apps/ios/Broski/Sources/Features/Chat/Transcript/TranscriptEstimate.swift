import BroskiCore
import CoreGraphics
import UIKit

/// Pre-measures transcript rows before their cells dequeue using TextKit metrics and the exact
/// formatter spacing tokens, so scrolling up through long history produces minimal height deltas.
enum TranscriptEstimate {
    private static let bodyBaseSize: CGFloat = FormatRole.page.baseSize

    static func height(of entry: TranscriptEntry, width: CGFloat, compact: Bool = false) -> CGFloat {
        let usable = max(width, 200)
        switch entry {
        case .older: return 64
        case .lane: return 40
        case .row(let row): return row.gap + height(of: row.content, width: usable, compact: compact)
        }
    }

    private static func height(of content: ChatRow.Content, width: CGFloat, compact: Bool) -> CGFloat {
        switch content {
        case .user(let turn): return bubble(turn.text, imageCount: turn.attachments.imageTargets.count, width: width)
        case .pending(let prompt): return bubble(prompt.draft.text, imageCount: prompt.draft.images.count, width: width) + 18
        case .text(let piece):
            let planHeader: CGFloat = (piece.kind == .plan && piece.isFirst) ? 20 : 0
            return planHeader + block(piece.block, width: width, compact: compact)
        case .work, .activity, .marker: return 32
        case .notice: return 44
        case .answerEnd(let end):
            return end.sources.isEmpty ? 36 : 36 + 44 * CGFloat(min(end.sources.count, SourcesList.shown))
        }
    }

    private static func bubble(_ text: String, imageCount: Int, width: CGFloat) -> CGFloat {
        var total: CGFloat = 0
        if imageCount == 1 {
            total += 138
        } else if imageCount > 1 {
            total += imageCount <= 3 ? 110 : 220
        }
        guard !text.isEmpty else { return max(total, 36) }
        let lineHeight = measuredLineHeight(font: bodyFont(), lineSpacing: FormatRole.page.lineSpacing)
        let bubbleWidth = max(120, width - 56 - 32)
        let measured = textHeight(text, font: bodyFont(), lineSpacing: FormatRole.page.lineSpacing, width: bubbleWidth)
        if measured > lineHeight * 10 {
            total += ceil(lineHeight * 6 + 4 + 32 + 20)
        } else {
            total += ceil(measured + 20)
        }
        return total
    }

    private static func block(_ block: FormatBlock, width: CGFloat, compact: Bool) -> CGFloat {
        let gap = FormatTokens.spacing(block.spacing, quiet: false, compact: compact)
        let indent = containerIndent(block.containers)
        let extra = containerVerticalExtra(block.containers)
        let proseWidth = max(120, min(width, FormatTokens.readableWidth) - indent)
        let lineSpacing = FormatRole.page.lineSpacing * (compact ? 0.65 : 1)
        switch block.content {
        case .paragraph(let spans):
            return gap + extra + spansHeight(spans, font: bodyFont(), lineSpacing: lineSpacing, width: proseWidth)
        case .heading(let level, let spans):
            let spec = FormatRole.page.heading(level)
            let font = headingFont(level)
            return gap + extra + spansHeight(spans, font: font, lineSpacing: spec.lineSpacing, width: proseWidth)
        case .code(let code):
            let count = code.text.reduce(1) { $1 == "\n" ? $0 + 1 : $0 }
            let folded = count > FormatTokens.codeFoldLines
            let shown = min(count, FormatTokens.codeFoldLines)
            return gap + extra + 35 + CGFloat(shown) * 20 + (folded ? 40 : 22)
        case .table(let table):
            let rows = table.rows.count > FormatTokens.tableFoldRows ? FormatTokens.tableShownRows : table.rows.count
            let controls: CGFloat = table.shape == .grid ? 26 : 0
            let fold: CGFloat = table.rows.count > FormatTokens.tableFoldRows ? 36 : 0
            return gap + extra + controls + CGFloat(rows + 1) * 40 + fold
        case .math, .html:
            return gap + extra + 56
        case .rule:
            return gap + extra + 1
        }
    }

    private static func containerIndent(_ containers: [FormatContainer]) -> CGFloat {
        var indent: CGFloat = 0
        var runCount = 0
        var lastMarker: ListMarker?
        func flushRun() {
            guard runCount > 0, let marker = lastMarker else { return }
            indent += FormatTokens.listBaseIndent(depth: runCount - 1)
            switch marker {
            case .bullet: indent += FormatTokens.bulletBoxWidth + FormatTokens.bulletGap
            case .number(let value, _):
                let digits = value >= 100 ? 3 : (value >= 10 ? 2 : 1)
                indent += max(15, CGFloat(digits) * 9 + 4) + FormatTokens.numberGap
            case .task: indent += FormatTokens.taskGutter + FormatTokens.taskGap
            }
            runCount = 0
            lastMarker = nil
        }
        for container in containers {
            switch container.kind {
            case .item(_, let marker, _, _):
                runCount += 1
                lastMarker = marker
            case .quote:
                flushRun()
                indent += FormatTokens.quoteBarWidth + FormatTokens.quoteGap
            case .callout:
                flushRun()
                indent += FormatTokens.calloutPadding * 2 + FormatTokens.calloutBarWidth
            case .footnote:
                flushRun()
                indent += 22
            }
        }
        flushRun()
        return indent
    }

    private static func containerVerticalExtra(_ containers: [FormatContainer]) -> CGFloat {
        var extra: CGFloat = 0
        for container in containers {
            if case .callout = container.kind {
                extra += container.first ? 40 : 12
            }
        }
        return extra
    }

    private static func spansHeight(_ spans: [FormatSpan], font: UIFont, lineSpacing: CGFloat, width: CGFloat) -> CGFloat {
        let plain = spans.map(\.text).joined()
        guard !plain.isEmpty else { return measuredLineHeight(font: font, lineSpacing: lineSpacing) }
        return textHeight(plain, font: font, lineSpacing: lineSpacing, width: width)
    }

    private static func textHeight(_ text: String, font: UIFont, lineSpacing: CGFloat, width: CGFloat) -> CGFloat {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = lineSpacing
        let attributed = NSAttributedString(string: text, attributes: [.font: font, .paragraphStyle: paragraph])
        let rect = attributed.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil)
        return ceil(rect.height)
    }

    private static func measuredLineHeight(font: UIFont, lineSpacing: CGFloat) -> CGFloat {
        ceil(font.lineHeight + lineSpacing)
    }

    private static func bodyFont() -> UIFont {
        UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: bodyBaseSize, weight: .regular))
    }

    private static func headingFont(_ level: UInt8) -> UIFont {
        let spec = FormatRole.page.heading(level)
        let style: UIFont.TextStyle = switch level {
        case 1: .title2
        case 2: .title3
        case 3: .headline
        default: .body
        }
        return UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: spec.size, weight: .semibold))
    }
}
