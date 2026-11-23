import BroskiCore
import SwiftUI

extension EnvironmentValues {
    @Entry var inQuote = false
}

struct FormatContainersView<Content: View>: View {
    let containers: [FormatContainer]
    let next: [UInt32]
    let gap: CGFloat
    let role: FormatRole
    @ViewBuilder let content: Content

    var body: some View {
        let segments = ContainerSegment.group(containers)
        SegmentStack(segments: segments[...], next: next, gap: gap, role: role) { content }
    }
}

private enum ContainerSegment {
    case quote(FormatContainer)
    case callout(FormatContainer, CalloutKind)
    case listRun([FormatContainer])
    case footnote(FormatContainer, String)

    static func group(_ containers: [FormatContainer]) -> [ContainerSegment] {
        var result: [ContainerSegment] = []
        var items: [FormatContainer] = []
        func flushItems() {
            if !items.isEmpty {
                result.append(.listRun(items))
                items.removeAll(keepingCapacity: true)
            }
        }
        for container in containers {
            switch container.kind {
            case .item:
                items.append(container)
            case .quote:
                flushItems()
                result.append(.quote(container))
            case .callout(let kind):
                flushItems()
                result.append(.callout(container, kind))
            case .footnote(let label):
                flushItems()
                result.append(.footnote(container, label))
            }
        }
        flushItems()
        return result
    }
}

private struct SegmentStack<Content: View>: View {
    let segments: ArraySlice<ContainerSegment>
    let next: [UInt32]
    let gap: CGFloat
    let role: FormatRole
    @ViewBuilder let content: Content

    var body: some View {
        if let first = segments.first {
            let tail = segments.dropFirst()
            switch first {
            case .quote(let container):
                QuoteFrame(above: container.first ? 0 : gap) {
                    SegmentStack(segments: tail, next: next, gap: gap, role: role) { content }
                }
            case .callout(let container, let kind):
                CalloutFrame(
                    kind: kind, first: container.first, continues: next.contains(container.id),
                    above: container.first ? 0 : gap
                ) {
                    SegmentStack(segments: tail, next: next, gap: gap, role: role) { content }
                }
            case .listRun(let items):
                FlatListFrame(items: items, next: next, gap: gap, role: role) {
                    SegmentStack(segments: tail, next: next, gap: gap, role: role) { content }
                }
            case .footnote(let container, let label):
                FootnoteFrame(label: label, first: container.first) {
                    SegmentStack(segments: tail, next: next, gap: gap, role: role) { content }
                }
            }
        } else {
            content
        }
    }
}

private struct QuoteFrame<Content: View>: View {
    let above: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        content
            .environment(\.inQuote, true)
            .padding(.leading, FormatTokens.quoteBarWidth + FormatTokens.quoteGap)
            .background(alignment: .leading) {
                Capsule()
                    .fill(FormatTokens.markerColor.opacity(0.55))
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
        VStack(alignment: .leading, spacing: Spacing.xs + 2) {
            if first {
                Label(kind.title, systemImage: kind.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(kind.tint)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(.leading, pad + FormatTokens.calloutBarWidth)
        .padding(.trailing, pad)
        .padding(.top, first ? pad - 1 : 0)
        .padding(.bottom, continues ? 0 : pad - 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .top) { backgroundShape }
    }

    private var backgroundShape: some View {
        let radius = FormatTokens.calloutRadius
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: first ? radius : 0, bottomLeadingRadius: continues ? 0 : radius,
            bottomTrailingRadius: continues ? 0 : radius, topTrailingRadius: first ? radius : 0,
            style: .continuous)
        return ZStack(alignment: .leading) {
            shape.fill(kind.tint.opacity(0.085))
            Rectangle()
                .fill(kind.tint.opacity(0.75))
                .frame(width: FormatTokens.calloutBarWidth)
        }
        .clipShape(shape)
        .padding(.top, -above)
        .accessibilityHidden(true)
    }
}

private struct FlatListFrame<Content: View>: View {
    let items: [FormatContainer]
    let next: [UInt32]
    let gap: CGFloat
    let role: FormatRole
    @ViewBuilder let content: Content

    @ScaledMetric(relativeTo: .body) private var step1: CGFloat = FormatTokens.listIndentSteps[0]
    @ScaledMetric(relativeTo: .body) private var step2: CGFloat = FormatTokens.listIndentSteps[1]
    @ScaledMetric(relativeTo: .body) private var step3: CGFloat = FormatTokens.listIndentSteps[2]
    @ScaledMetric(relativeTo: .body) private var bulletBox: CGFloat = FormatTokens.bulletBoxWidth
    @ScaledMetric(relativeTo: .body) private var bulletGap: CGFloat = FormatTokens.bulletGap
    @ScaledMetric(relativeTo: .body) private var numberMinGutter: CGFloat = 15
    @ScaledMetric(relativeTo: .body) private var taskGutter: CGFloat = FormatTokens.taskGutter
    @ScaledMetric(relativeTo: .body) private var pageSize: CGFloat = FormatRole.page.baseSize
    @ScaledMetric(relativeTo: .subheadline) private var quietSize: CGFloat = FormatRole.quiet.baseSize

    private var leaf: FormatContainer { items[items.count - 1] }
    private var visualDepth: Int { items.count - 1 }
    private var fontSize: CGFloat { role == .page ? pageSize : quietSize }

    private var leafMarker: ListMarker {
        if case .item(_, let marker, _, _) = leaf.kind { return marker }
        return .bullet
    }

    private func indentFor(level: Int) -> CGFloat {
        switch level {
        case ...0: 0
        case 1: step1
        case 2: step1 + step2
        default: step1 + step2 + step3
        }
    }

    var body: some View {
        let marker = leafMarker
        let baseIndent = indentFor(level: visualDepth)
        let isDone = if case .task(true) = marker { true } else { false }
        let markerSpacing: CGFloat = switch marker {
        case .bullet: bulletGap
        case .number: FormatTokens.numberGap
        case .task: FormatTokens.taskGap
        }
        HStack(alignment: .firstTextBaseline, spacing: markerSpacing) {
            markerSlot(marker: marker, show: leaf.first)
                .accessibilityHidden(!leaf.first)
            content.opacity(isDone ? 0.55 : 1)
        }
        .padding(.leading, baseIndent)
        .background(alignment: .topLeading) { nestingGuides }
    }

    @ViewBuilder
    private var nestingGuides: some View {
        let levels = min(visualDepth, FormatTokens.listIndentSteps.count)
        if levels > 0 {
            GeometryReader { geo in
                ForEach(0..<levels, id: \.self) { level in
                    let ancestor = items[level]
                    let topExtend: CGFloat = ancestor.first ? 0 : gap
                    let x = indentFor(level: level) + guideCenter(for: ancestor)
                    Rectangle()
                        .fill(FormatTokens.listGuide)
                        .frame(width: 1, height: geo.size.height + topExtend)
                        .offset(x: x - 0.5, y: -topExtend)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func guideCenter(for container: FormatContainer) -> CGFloat {
        if case .item(_, .task, _, _) = container.kind { return taskGutter * 0.5 }
        return bulletBox * 0.5
    }

    @ViewBuilder
    private func markerSlot(marker: ListMarker, show: Bool) -> some View {
        switch marker {
        case .bullet:
            // Baseline anchor matches the first line of prose so the geometric dot centers on x-height.
            Text(verbatim: "\u{200B}")
                .font(.system(size: fontSize))
                .frame(width: bulletBox, alignment: .center)
                .overlay(alignment: .center) {
                    if show { bulletShape }
                }
                .accessibilityLabel(show ? "Bullet" : "")
        case .number(let value, let paren):
            let markerFont = Font.system(size: fontSize * 0.94).monospacedDigit()
            Text("\(value)\(paren ? ")" : ".")")
                .font(markerFont)
                .foregroundStyle(FormatTokens.markerColor)
                .opacity(show ? 1 : 0)
                .frame(minWidth: numberMinGutter, alignment: .leading)
                .fixedSize()
        case .task(let checked):
            Text(verbatim: "\u{200B}")
                .font(.system(size: fontSize))
                .frame(width: taskGutter, alignment: .center)
                .overlay(alignment: .center) {
                    if show {
                        Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: fontSize * 0.92))
                            .foregroundStyle(checked ? Palette.done : FormatTokens.markerColor)
                    }
                }
                .accessibilityLabel(show ? (checked ? "Done" : "To do") : "")
        }
    }

    @ViewBuilder
    private var bulletShape: some View {
        let dot = max(4.5, fontSize * 0.31)
        switch visualDepth % 3 {
        case 0:
            Circle()
                .fill(FormatTokens.markerColor)
                .frame(width: dot, height: dot)
        case 1:
            Circle()
                .strokeBorder(FormatTokens.markerColor, lineWidth: 1.25)
                .frame(width: dot, height: dot)
        default:
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(FormatTokens.markerColor)
                .frame(width: dot * 0.88, height: dot * 0.88)
        }
    }
}

private struct FootnoteFrame<Content: View>: View {
    let label: String
    let first: Bool
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: FormatTokens.numberGap) {
            Text(first ? label : "")
                .font(.caption.weight(.semibold))
                .foregroundStyle(FormatTokens.link)
                .frame(minWidth: 16, alignment: .leading)
                .accessibilityLabel("Footnote \(label)")
            content
        }
    }
}
