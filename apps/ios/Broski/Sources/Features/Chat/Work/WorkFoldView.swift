import BroskiCore
import SwiftUI

/// Which folds and rows the person opened. Kept by the chat rather than each row, since the lazy
/// stack drops a row's own state once it scrolls far away.
@Observable
final class Disclosure {
    private(set) var open: Set<String> = []

    func isOpen(_ id: String) -> Bool { open.contains(id) }

    func toggle(_ id: String) {
        if open.remove(id) == nil { open.insert(id) }
    }
}

/// A stretch of work as one muted row, `Worked for 2m · Edited 1 file · Ran 2 commands ›`, that
/// opens in place to its calls (other clients's work log): 28 pt rows, the list capped at 256 pt with
/// faded edges so opening it never pushes the answer away.
struct WorkFoldView: View {
    let fold: WorkFold
    @Environment(Disclosure.self) private var disclosure
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var listHeight: CGFloat = 0

    static let cap: CGFloat = 256

    private var isOpen: Bool { disclosure.isOpen(fold.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            header
            if isOpen {
                list.transition(.opacity)
            }
        }
        .haptic(.toggled(expanded: true), trigger: isOpen) { !$0 && $1 }
        .haptic(.toggled(expanded: false), trigger: isOpen) { $0 && !$1 }
    }

    private var header: some View {
        Button {
            withAnimation(reduceMotion ? .easeOut(duration: 0.14) : .easeOut(duration: 0.18)) {
                disclosure.toggle(fold.id)
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                summary
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .rotationEffect(.degrees(isOpen ? 90 : 0))
                    .foregroundStyle(.tertiary)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(minHeight: 28)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(fold.summary.text + (fold.summary.failedText.map { ", \($0)" } ?? ""))
        .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
        .accessibilityHint("Shows each step")
        .accessibilityIdentifier("work.fold")
    }

    private var summary: some View {
        let summary = fold.summary
        let failed = summary.failedText.map { Text(summary.text.isEmpty ? $0 : " · \($0)").foregroundStyle(Palette.failed) }
        return Text("\(summary.text)\(failed ?? Text(""))")
            .lineLimit(1)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .spring(duration: 0.24, bounce: 0.14), value: summary.text)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(fold.entries) { entry in
                    WorkRowView(entry: entry)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { listHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
        .frame(height: min(listHeight, Self.cap))
        .mask { EdgeFade(active: listHeight > Self.cap) }
        .padding(.leading, Spacing.xs)
    }
}

/// Fades a capped list's top and bottom 12 pt, so rows read as going on beyond the edge.
private struct EdgeFade: View {
    let active: Bool

    var body: some View {
        if active {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 12)
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 12)
            }
        } else {
            Color.black
        }
    }
}
