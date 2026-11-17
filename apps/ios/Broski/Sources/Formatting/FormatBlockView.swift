import BroskiCore
import SwiftUI

/// One block of formatted text with the containers around it and the space above it. Equatable, so
/// a finished block is never drawn again while the open one streams below it. `next` is the block
/// after it, whose containers say where a quote's bar or a callout's card ends.
struct FormatBlockView: View, Equatable {
    let block: FormatBlock
    var role: FormatRole = .page
    var next: [UInt32] = []
    /// The text is still arriving: a table's columns only grow, code is coloured line by line.
    var streaming = false
    @Environment(\.reading) private var reading

    nonisolated static func == (lhs: FormatBlockView, rhs: FormatBlockView) -> Bool {
        lhs.block == rhs.block && lhs.role == rhs.role && lhs.next == rhs.next && lhs.streaming == rhs.streaming
    }

    var body: some View {
        let gap = FormatTokens.spacing(block.spacing, quiet: role == .quiet, compact: reading.compact)
        FormatContainersView(containers: block.containers, next: next, gap: gap, role: role) {
            FormatContentView(block: block, role: role, streaming: streaming)
        }
        .padding(.top, gap)
        .frame(maxWidth: maxWidth, alignment: .leading)
        .frame(maxWidth: .infinity)
        .readingTextSize()
        .formatLinkHandling()
    }

    /// Prose keeps a readable width; code and tables may use all of it.
    private var maxWidth: CGFloat {
        switch block.content {
        case .code, .table: .infinity
        default: FormatTokens.readableWidth
        }
    }
}

/// What a block holds, drawn by its kind.
struct FormatContentView: View {
    let block: FormatBlock
    let role: FormatRole
    let streaming: Bool
    @Environment(\.reading) private var reading
    @ScaledMetric(relativeTo: .body) private var pageCode: CGFloat = 17 * FormatTokens.inlineCodeScale
    @ScaledMetric(relativeTo: .subheadline) private var quietCode: CGFloat = 15 * FormatTokens.inlineCodeScale
    @ScaledMetric(relativeTo: .body) private var pageLines: CGFloat = FormatRole.page.lineSpacing
    @ScaledMetric(relativeTo: .subheadline) private var quietLines: CGFloat = FormatRole.quiet.lineSpacing

    var body: some View {
        switch block.content {
        case .paragraph(let spans):
            prose(spans, font: .system(role.textStyle), style: role.style)
        case .heading(let level, let spans):
            prose(spans, font: role.headingFont(level), style: level >= 4 ? .secondary : role.style)
                .accessibilityAddTraits(.isHeader)
        case .code(let code):
            FormatCodeBlock(code: code, streaming: streaming)
        case .table(let table):
            FormatTableView(table: table, streaming: streaming)
        case .math(let tex):
            MathBlock(tex: tex)
        case .html(let text):
            Text(text)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.s + Spacing.xxs)
                .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
        case .rule:
            Rectangle()
                .fill(FormatTokens.hairline)
                .frame(height: 1)
                .padding(.vertical, Spacing.s)
                .accessibilityHidden(true)
        }
    }

    private func prose(_ spans: [FormatSpan], font: Font, style: HierarchicalShapeStyle) -> some View {
        let code = role == .page ? pageCode : quietCode
        let spanStyle = SpanStyle(
            font: font, codeFont: .system(size: code, design: .monospaced), underlinesLinks: reading.underlinesLinks)
        let lines = (role == .page ? pageLines : quietLines) * (reading.compact ? 0.6 : 1)
        return Text(spans.isEmpty ? AttributedString(" ") : FormatSpans.attributed(spans, style: spanStyle))
            .font(font)
            .foregroundStyle(style)
            .lineSpacing(lines)
            .tint(FormatTokens.link)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.layoutDirection, block.direction == .rightToLeft ? .rightToLeft : .leftToRight)
    }
}

/// Display math, as its TeX: centred, italic, monospaced. No math library draws it.
private struct MathBlock: View {
    let tex: String

    var body: some View {
        Text(tex)
            .font(.system(.body, design: .monospaced).italic())
            .multilineTextAlignment(.center)
            .padding(.vertical, Spacing.s + Spacing.xxs)
            .padding(.horizontal, Spacing.m)
            .frame(maxWidth: .infinity)
            .background(Palette.codeBackground.opacity(0.6), in: .rect(cornerRadius: Radius.small, style: .continuous))
            .accessibilityLabel("Math: \(tex)")
    }
}
