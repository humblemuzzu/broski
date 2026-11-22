import BroskiCore
import SwiftUI

extension EnvironmentValues {
    /// The side margin of the screen the text is on: a code block or a table at the top level of an
    /// answer reaches across it to the screen's edges. Zero where the text sits inside something else.
    @Entry var formatBleed: CGFloat = 0
    /// The width a top-level block is laid out at, where the screen knows it before layout: a table
    /// then fits its columns once rather than first at a guess.
    @Entry var formatWidthHint: CGFloat?
}

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
    @Environment(\.formatContext) private var context
    @Environment(\.formatBleed) private var screenBleed
    @ScaledMetric(relativeTo: .body) private var pageCode: CGFloat = 17 * FormatTokens.inlineCodeScale
    @ScaledMetric(relativeTo: .subheadline) private var quietCode: CGFloat = 15 * FormatTokens.inlineCodeScale
    @ScaledMetric(relativeTo: .body) private var pageLines: CGFloat = FormatRole.page.lineSpacing
    @ScaledMetric(relativeTo: .subheadline) private var quietLines: CGFloat = FormatRole.quiet.lineSpacing
    @ScaledMetric(relativeTo: .title2) private var h1: CGFloat = FormatRole.page.heading(1).size
    @ScaledMetric(relativeTo: .title3) private var h2: CGFloat = FormatRole.page.heading(2).size
    @ScaledMetric(relativeTo: .headline) private var h3: CGFloat = FormatRole.page.heading(3).size
    @ScaledMetric(relativeTo: .body) private var h4: CGFloat = FormatRole.page.heading(4).size
    @ScaledMetric(relativeTo: .callout) private var quietH1: CGFloat = FormatRole.quiet.heading(1).size
    @ScaledMetric(relativeTo: .subheadline) private var quietH2: CGFloat = FormatRole.quiet.heading(2).size

    var body: some View {
        switch block.content {
        case .paragraph(let spans):
            prose(spans, font: .system(role.textStyle), color: role == .page ? FormatTokens.bodyText : Color.secondary, strong: role == .page ? FormatTokens.boldText : nil)
        case .heading(let level, let spans):
            prose(spans, font: headingFont(level), color: level >= 4 || role == .quiet ? Color.secondary : Color.primary, strong: nil)
                .accessibilityAddTraits(.isHeader)
        case .code(let code):
            FormatCodeBlock(code: code, streaming: streaming, bleed: bleed)
        case .table(let table):
            FormatTableView(table: table, streaming: streaming, bleed: bleed)
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
            Color.clear
                .frame(height: 0)
                .accessibilityHidden(true)
        }
    }

    /// A block at the top level of an answer reaches the screen's edges; inside a list, a quote or
    /// a quiet row it keeps to its column.
    private var bleed: CGFloat {
        role == .page && block.containers.isEmpty ? screenBleed : 0
    }

    private func headingFont(_ level: UInt8) -> Font {
        let weight = role.heading(level).weight
        let size: CGFloat = switch (role, level) {
        case (.page, 1): h1
        case (.page, 2): h2
        case (.page, 3): h3
        case (.page, _): h4
        case (.quiet, 1): quietH1
        case (.quiet, _): quietH2
        }
        return .system(size: size, weight: weight)
    }

    private func prose(_ spans: [FormatSpan], font: Font, color: Color, strong: Color?) -> some View {
        let code = role == .page ? pageCode : quietCode
        let spanStyle = SpanStyle(
            font: font, codeFont: .system(size: code, weight: .medium, design: .monospaced),
            underlinesLinks: reading.underlinesLinks, opensFiles: context != nil, strongColor: strong)
        let lines = (role == .page ? pageLines : quietLines) * (reading.compact ? 0.6 : 1)
        return (spans.isEmpty ? Text(verbatim: " ") : FormatSpans.text(spans, style: spanStyle))
            .font(font)
            .foregroundStyle(color)
            .lineSpacing(lines)
            .tint(FormatTokens.link)
            .textRenderer(ChipRenderer())
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
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
