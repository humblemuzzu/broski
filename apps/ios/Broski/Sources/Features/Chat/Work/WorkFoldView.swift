import BroskiCore
import SwiftUI

/// Which folds and rows the person opened. Kept by the chat rather than each row, since a cell
/// that scrolls away is reused for another row and its own state goes with it.
@Observable
final class Disclosure {
    private(set) var open: Set<String> = []

    func isOpen(_ id: String) -> Bool { open.contains(id) }

    func toggle(_ id: String) {
        if open.remove(id) == nil { open.insert(id) }
    }
}

extension EnvironmentValues {
    /// The transcript row a view is drawn in, under which a block keeps what the person opened in
    /// it (a code block's hidden lines, a table's hidden rows) in the chat's `Disclosure`.
    @Entry var disclosureKey: String?
}

/// A stretch of work as one muted row, `Worked for 2m · Edited 1 file · Ran 2 commands ›`, that
/// opens in place to its calls: 28 pt rows, the list capped at 256 pt with
/// faded edges so opening it never pushes the answer away.
struct WorkFoldView: View {
    let fold: WorkFold
    /// What `Disclosure` keeps its open state under: the row's id, which stays the same when the
    /// run's live rows give way to the transcript's.
    let key: String
    @Environment(Disclosure.self) private var disclosure
    @State private var overflows = false

    static let cap: CGFloat = 256

    private var isOpen: Bool { disclosure.isOpen(key) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            WorkSummaryLine(summary: fold.summary, isOpen: isOpen, hint: "Shows each step", identifier: "work.fold") {
                disclosure.toggle(key)
            }
            if isOpen {
                list.transition(.opacity)
            }
        }
    }

    /// The rows at their own height up to the cap, scrolling past it: sized in one pass, so opening
    /// the fold never draws it at one height and then another. The edges fade only while it scrolls.
    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(fold.entries) { entry in
                    WorkRowView(entry: entry)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
        .onScrollGeometryChange(for: Bool.self) { $0.contentSize.height > $0.containerSize.height + 1 } action: { _, now in
            overflows = now
        }
        .mask { if overflows { EdgeFade() } else { Rectangle() } }
        .frame(maxHeight: Self.cap)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, Spacing.xs)
    }
}

/// Fades a capped list's top and bottom 12 pt, so rows read as going on beyond the edge.
private struct EdgeFade: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 12)
            Color.black
            LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 12)
        }
    }
}

/// The one muted line of a fold or a group, its summary and a chevron that turns; a tap opens it.
struct WorkSummaryLine: View {
    let summary: WorkSummary
    let isOpen: Bool
    let hint: LocalizedStringKey
    let identifier: String
    let toggle: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            withAnimation(reduceMotion ? .easeOut(duration: 0.14) : .easeOut(duration: 0.18), toggle)
        } label: {
            HStack(spacing: Spacing.xs) {
                line
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
        .accessibilityLabel(summary.text + (summary.failedText.map { ", \($0)" } ?? ""))
        .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
        .haptic(.toggled(expanded: true), trigger: isOpen) { !$0 && $1 }
        .haptic(.toggled(expanded: false), trigger: isOpen) { $0 && !$1 }
    }

    /// The line, cut at its tail when narrow; the failures, which matter most, are never cut.
    private var line: some View {
        HStack(spacing: 0) {
            Text(summary.text)
                .lineLimit(1)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .spring(duration: 0.24, bounce: 0.14), value: summary.text)
            if let failed = summary.failedText {
                Text(summary.text.isEmpty ? failed : " · \(failed)")
                    .foregroundStyle(Palette.failed)
                    .lineLimit(1)
                    .fixedSize()
                    .layoutPriority(1)
            }
        }
    }
}
