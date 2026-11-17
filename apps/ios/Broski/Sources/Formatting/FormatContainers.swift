import BroskiCore
import SwiftUI

/// A block inside its quotes, callouts, list items and footnotes, outermost first. A container the
/// previous block shares draws up through the gap above this block, and one the next block shares
/// leaves its bottom open, so a quote's bar and a callout's card run on unbroken across blocks.
struct FormatContainersView<Content: View>: View {
    let containers: [FormatContainer]
    let next: [UInt32]
    let gap: CGFloat
    let role: FormatRole
    @ViewBuilder let content: Content

    var body: some View {
        wrapped(containers[...])
    }

    private func wrapped(_ rest: ArraySlice<FormatContainer>) -> AnyView {
        guard let outer = rest.first else { return AnyView(content) }
        let inner = wrapped(rest.dropFirst())
        let continues = next.contains(outer.id)
        let above = outer.first ? 0 : gap
        switch outer.kind {
        case .quote:
            return AnyView(QuoteFrame(above: above) { inner })
        case .callout(let kind):
            return AnyView(CalloutFrame(kind: kind, first: outer.first, continues: continues, above: above) { inner })
        case .item(_, let marker, let depth, let width):
            return AnyView(ListItemFrame(marker: marker, depth: depth, width: width, first: outer.first, role: role) { inner })
        case .footnote(let label):
            return AnyView(FootnoteFrame(label: label, first: outer.first) { inner })
        }
    }
}

private struct QuoteFrame<Content: View>: View {
    let above: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.leading, FormatTokens.quoteBarWidth + FormatTokens.quoteGap)
            .background(alignment: .leading) {
                Capsule()
                    .fill(.tertiary)
                    .frame(width: FormatTokens.quoteBarWidth)
                    .padding(.top, -above)
                    .accessibilityHidden(true)
            }
    }
}

private struct CalloutFrame<Content: View>: View {
    let kind: CalloutKind
    let first: Bool
    let continues: Bool
    let above: CGFloat
    @ViewBuilder let content: Content
    private let pad = FormatTokens.calloutPadding

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if first {
                Label(kind.title, systemImage: kind.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(kind.tint)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(.horizontal, pad)
        .padding(.top, first ? pad - 2 : 0)
        .padding(.bottom, continues ? 0 : pad - 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .top) {
            let radius = FormatTokens.calloutRadius
            UnevenRoundedRectangle(
                topLeadingRadius: first ? radius : 0, bottomLeadingRadius: continues ? 0 : radius,
                bottomTrailingRadius: continues ? 0 : radius, topTrailingRadius: first ? radius : 0, style: .continuous
            )
            .fill(kind.tint.opacity(0.1))
            .padding(.top, -above)
            .accessibilityHidden(true)
        }
    }
}

/// A list item: its marker in a gutter as wide as the list's widest (so `9.` and `10.` line up),
/// the text beside it; past four levels the indent stops growing and the marker sits inline.
private struct ListItemFrame<Content: View>: View {
    let marker: ListMarker
    let depth: UInt32
    let width: UInt32
    let first: Bool
    let role: FormatRole
    @ViewBuilder let content: Content
    @ScaledMetric(relativeTo: .body) private var bulletGutter = FormatTokens.bulletGutter

    var body: some View {
        if depth >= FormatTokens.maxListIndent {
            HStack(alignment: .firstTextBaseline, spacing: FormatTokens.markerGap) {
                if first { markerView }
                content
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: FormatTokens.markerGap) {
                ZStack(alignment: .trailing) {
                    gutterPlaceholder.hidden()
                    if first { markerView }
                }
                .accessibilityHidden(!first)
                content.opacity(isDone ? 0.55 : 1)
            }
        }
    }

    private var isDone: Bool {
        if case .task(true) = marker { true } else { false }
    }

    @ViewBuilder
    private var gutterPlaceholder: some View {
        switch marker {
        case .number:
            Text(String(repeating: "0", count: Int(max(width, 2)) - 1) + ".").monospacedDigit()
                .font(.system(role.textStyle))
        case .bullet, .task:
            Color.clear.frame(width: bulletGutter, height: 1)
        }
    }

    @ViewBuilder
    private var markerView: some View {
        switch marker {
        case .bullet:
            Text(listBullets[Int(depth) % listBullets.count])
                .font(.system(role.textStyle))
                .foregroundStyle(.secondary)
                .accessibilityLabel("Bullet")
        case .number(let value, let paren):
            Text("\(value)\(paren ? ")" : ".")")
                .font(.system(role.textStyle))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        case .task(let checked):
            Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                .font(.system(role.textStyle))
                .imageScale(.medium)
                .foregroundStyle(checked ? Palette.done : Color.secondary)
                .accessibilityLabel(checked ? "Done" : "To do")
        }
    }
}

/// A bullet list's marks by depth.
private let listBullets = ["•", "◦", "▪"]

private struct FootnoteFrame<Content: View>: View {
    let label: String
    let first: Bool
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: FormatTokens.markerGap) {
            Text(first ? label : "")
                .font(.caption.weight(.semibold))
                .foregroundStyle(FormatTokens.link)
                .frame(minWidth: 16, alignment: .trailing)
                .accessibilityLabel("Footnote \(label)")
            content
        }
    }
}
