import BroskiCore
import SwiftUI

extension EnvironmentValues {
    @Entry var formatBleed: CGFloat = 0
    @Entry var formatWidthHint: CGFloat?
}

struct FormatBlockView: View, Equatable {
    let block: FormatBlock
    var role: FormatRole = .page
    var next: [UInt32] = []
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

    private var maxWidth: CGFloat {
        switch block.content {
        case .code, .table: .infinity
        default: FormatTokens.readableWidth
        }
    }
}

struct FormatContentView: View {
    let block: FormatBlock
    let role: FormatRole
    let streaming: Bool
    @Environment(\.reading) private var reading
    @Environment(\.formatContext) private var context
    @Environment(\.formatBleed) private var screenBleed
    @Environment(\.inQuote) private var inQuote
    @ScaledMetric(relativeTo: .body) private var pageSize: CGFloat = FormatRole.page.baseSize
    @ScaledMetric(relativeTo: .subheadline) private var quietSize: CGFloat = FormatRole.quiet.baseSize
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
            let bodyColor: Color = role == .quiet ? .secondary : (inQuote ? FormatTokens.quoteText : FormatTokens.bodyText)
            let strongColor: Color? = role == .page && !inQuote ? FormatTokens.boldText : nil
            let lines = (role == .page ? pageLines : quietLines) * (reading.compact ? 0.65 : 1)
            prose(spans, font: bodyFont, codeSize: bodySize * FormatTokens.inlineCodeScale, color: bodyColor, strong: strongColor, lineSpacing: lines, tracking: 0)
        case .heading(let level, let spans):
            let spec = role.heading(level)
            let size = headingSize(level)
            prose(
                spans, font: .system(size: size, weight: spec.weight),
                codeSize: size * FormatTokens.inlineCodeScale,
                color: level >= 4 || role == .quiet ? Color.secondary : Color.primary,
                strong: nil, lineSpacing: spec.lineSpacing, tracking: spec.tracking
            )
            .accessibilityAddTraits(.isHeader)
        case .code(let code):
            FormatCodeBlock(code: code, streaming: streaming)
        case .table(let table):
            FormatTableView(table: table, streaming: streaming, bleed: tableBleed)
        case .math(let tex):
            MathBlock(tex: tex)
        case .html(let text):
            Text(text)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.s + Spacing.xxs)
                .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                        .strokeBorder(FormatTokens.cardBorder, lineWidth: 0.5)
                }
        case .rule:
            Rectangle()
                .fill(FormatTokens.ruleColor)
                .frame(height: 0.5)
                .accessibilityHidden(true)
        }
    }

    private var bodySize: CGFloat { role == .page ? pageSize : quietSize }
    private var bodyFont: Font { .system(size: bodySize) }

    private var tableBleed: CGFloat {
        role == .page && block.containers.isEmpty ? screenBleed : 0
    }

    private func headingSize(_ level: UInt8) -> CGFloat {
        switch (role, level) {
        case (.page, 1): h1
        case (.page, 2): h2
        case (.page, 3): h3
        case (.page, _): h4
        case (.quiet, 1): quietH1
        case (.quiet, _): quietH2
        }
    }

    private func prose(
        _ spans: [FormatSpan], font: Font, codeSize: CGFloat, color: Color,
        strong: Color?, lineSpacing: CGFloat, tracking: CGFloat
    ) -> some View {
        let spanStyle = SpanStyle(
            font: font, codeFont: .system(size: codeSize, weight: .medium, design: .monospaced),
            underlinesLinks: reading.underlinesLinks, opensFiles: context != nil, strongColor: strong)
        return (spans.isEmpty ? Text(verbatim: " ") : FormatSpans.text(spans, style: spanStyle))
            .font(font)
            .tracking(tracking)
            .foregroundStyle(color)
            .lineSpacing(lineSpacing)
            .tint(FormatTokens.link)
            .textRenderer(ChipRenderer())
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.layoutDirection, block.direction == .rightToLeft ? .rightToLeft : .leftToRight)
    }
}

private struct MathBlock: View {
    let tex: String

    var body: some View {
        Text(tex)
            .font(.system(.callout, design: .monospaced).italic())
            .multilineTextAlignment(.center)
            .padding(.vertical, Spacing.m)
            .padding(.horizontal, Spacing.m)
            .frame(maxWidth: .infinity)
            .background(Palette.codeBackground, in: .rect(cornerRadius: FormatTokens.tableRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: FormatTokens.tableRadius, style: .continuous)
                    .strokeBorder(FormatTokens.cardBorder, lineWidth: 0.5)
            }
            .accessibilityLabel("Math: \(tex)")
    }
}
