import BroskiCore
import SwiftUI

/// The sheet's models on a wheel. The row in the band is the one chosen, and it is chosen when the
/// wheel comes to rest; every row that passes the band ticks. The band's row shows its thinking
/// level, and a tap on it opens the level; a tap on another row turns the wheel to it. Under the
/// wheel, what the band's model is.
struct ModelWheel: View {
    let models: [ModelSummary]
    @Binding var centered: String?
    let level: (ModelSummary) -> String?
    let settle: (ModelSummary) -> Void
    let tapCentered: (ModelSummary) -> Void
    let isPinned: (ModelSummary) -> Bool
    let unpin: (ModelSummary) -> Void

    static let rowHeight: CGFloat = 56

    /// The scroll view's own position, set from `centered` once it is on screen: a position the
    /// scroll view starts with is not applied, one set after it appears is.
    @State private var shown: String?

    private var height: CGFloat { Self.rowHeight * Drum.rows(models.count) }
    private var centeredModel: ModelSummary? { models.first { $0.id == centered } }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            wheel
            if let about = centeredModel.flatMap(about) {
                Text(about)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .padding(.horizontal, 24)
                    .id(centered)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: centered)
    }

    private var wheel: some View {
        let row = Self.rowHeight
        return ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(models, id: \.id) { model in
                    WheelRow(model: model, level: level(model), isCentered: model.id == shown, height: row) {
                        tap(model)
                    }
                    .contextMenu {
                        if isPinned(model) {
                            Button("Unpin", systemImage: "pin.slash") { unpin(model) }
                        }
                    }
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned(limitBehavior: .never))
        .scrollPosition(id: $shown, anchor: .center)
        .contentMargins(.vertical, (height - row) / 2, for: .scrollContent)
        .frame(height: height)
        .background {
            Capsule().fill(Palette.card).frame(height: row)
        }
        .onScrollPhaseChange { _, phase in
            if phase == .idle, let model = models.first(where: { $0.id == shown }) { settle(model) }
        }
        .onChange(of: shown) { _, id in
            if let id { centered = id }
        }
        .onAppear { shown = centered }
        .sensoryFeedback(.selection, trigger: shown) { old, new in old != nil && new != nil }
    }

    private func tap(_ model: ModelSummary) {
        if model.id == shown {
            tapCentered(model)
        } else {
            withAnimation(.snappy(duration: 0.35)) { shown = model.id }
        }
    }

    /// What the agent says about the model, else who serves it and how much it reads at once.
    private func about(_ model: ModelSummary) -> String? {
        if let description = model.description, !description.isEmpty { return description }
        let parts = [model.provider, model.contextWindow.map { "\(CacheFormat.tokens($0)) context" }].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// One model on the drum: turned away and faded by its distance from the band, its level shown only
/// as it reaches the band.
private struct WheelRow: View {
    let model: ModelSummary
    let level: String?
    let isCentered: Bool
    let height: CGFloat
    let tap: () -> Void

    private var options: [ThinkingOption] { model.thinking.options }
    private var title: String? { model.thinking.title(of: level) }
    private var index: Int? { options.firstIndex { $0.value == (level ?? model.thinking.defaultValue) } }

    var body: some View {
        HStack(spacing: Spacing.s) {
            HStack(spacing: 14) {
                Text(model.pillName)
                    .font(.title3)
                    .lineLimit(1)
                if !options.isEmpty {
                    LevelDots(count: options.count, index: index).drumDetail(row: height)
                }
            }
            Spacer(minLength: 0)
            if !options.isEmpty {
                HStack(spacing: Spacing.xs) {
                    Text(title ?? "Default").foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .lineLimit(1)
                .drumDetail(row: height)
            }
        }
        .padding(.horizontal, 24)
        .frame(height: height)
        .contentShape(.rect)
        .onTapGesture(perform: tap)
        .visualEffect { content, proxy in
            let d = Drum.distance(proxy, row: height)
            return content
                .offset(y: (Drum.shown(d) - d) * height)
                .rotation3DEffect(.degrees(-Drum.angle(d)), axis: (x: 1, y: 0, z: 0), perspective: 0.1)
                .opacity(Drum.alpha(d))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.displayName)
        .accessibilityValue(isCentered ? title.map { "Thinking \($0)" } ?? "" : "")
        .accessibilityAddTraits(isCentered ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction(.default, tap)
    }
}

private extension View {
    func drumDetail(row: CGFloat) -> some View {
        visualEffect { content, proxy in
            content.opacity(Drum.detailAlpha(Drum.distance(proxy, row: row)))
        }
    }
}

nonisolated extension Drum {
    /// How many rows the view `proxy` measures sits below the middle of its scroll view: measured
    /// against the scroll view's own bounds, whose origin moves with the content margins.
    static func distance(_ proxy: GeometryProxy, row: CGFloat) -> Double {
        guard let bounds = proxy.bounds(of: .scrollView) else { return 0 }
        return (proxy.size.height / 2 - bounds.midY) / row
    }
}

/// The level in the band's row at a glance: a dot per level and a bar on the chosen one, sliding
/// along as it changes.
struct LevelDots: View {
    let count: Int
    let index: Int?
    private let slot: CGFloat = 9

    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { level in
                Circle()
                    .fill(.secondary)
                    .frame(width: 3.5, height: 3.5)
                    .opacity(level == index ? 0 : 0.8)
                    .frame(width: slot)
            }
        }
        .overlay(alignment: .leading) {
            if let index {
                Capsule()
                    .fill(.primary)
                    .frame(width: 2.5, height: 14)
                    .offset(x: CGFloat(index) * slot + (slot - 2.5) / 2)
            }
        }
        .animation(.snappy(duration: 0.25), value: index)
        .accessibilityHidden(true)
    }
}
