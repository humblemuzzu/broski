import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// One call or thought in an open fold: a 28 pt line (kind, label, how it ended) that opens in place
/// to the command and its output, its files, or the reasoning.
struct WorkRowView: View {
    let entry: WorkEntry
    @Environment(Disclosure.self) private var disclosure
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = 18

    private var isOpen: Bool { disclosure.isOpen(entry.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Button {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { disclosure.toggle(entry.id) }
            } label: {
                line.frame(minHeight: 28).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            if isOpen {
                detail
                    .padding(.leading, iconWidth + Spacing.s)
                    .padding(.bottom, Spacing.s)
                    .transition(.opacity)
            }
        }
        .padding(.leading, isNested ? iconWidth : 0)
    }

    private var isNested: Bool {
        if case .tool(let tool) = entry { tool.parentToolCallId != nil } else { false }
    }

    private var line: some View {
        HStack(spacing: Spacing.s) {
            icon
                .frame(width: iconWidth)
                .accessibilityHidden(true)
            label
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: Spacing.s)
            if case .tool(let tool) = entry { ToolOutcomeBadge(tool: tool) }
        }
        .font(.footnote)
    }

    @ViewBuilder
    private var label: some View {
        switch entry {
        case .tool(let tool) where isOpen:
            Text(tool.look.verb).foregroundStyle(.primary)
        case .tool(let tool) where tool.kind == .command && tool.title == nil:
            Text(tool.label).font(.codeSmall).foregroundStyle(.primary)
        case .tool(let tool):
            Text(tool.label).foregroundStyle(.primary)
        case .thinking(let thinking):
            Text(thinking.isOpen ? "Thinking" : "Thought").foregroundStyle(.secondary)
        }
    }

    /// A live thought's orb is still: the status lane under the run is the one that moves.
    @ViewBuilder
    private var icon: some View {
        if case .thinking(let thinking) = entry, thinking.isOpen {
            Orb(.breathing, side: 18, relativeTo: .footnote, still: true)
        } else {
            Image(systemName: symbol)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var symbol: String {
        switch entry {
        case .tool(let tool):
            if case .todos = tool.display { "checklist" } else { tool.kind.symbol }
        case .thinking: "brain"
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch entry {
        case .tool(let tool):
            ToolDetailView(tool: tool)
        case .thinking(let thinking):
            FormattedText(text: thinking.text, role: .quiet, streaming: thinking.isOpen)
        }
    }
}

/// How a call ended, at the end of its row, in words: nothing for a call that completed cleanly.
struct ToolOutcomeBadge: View {
    let tool: ToolWork

    var body: some View {
        if let words {
            Text(words)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .padding(.horizontal, Spacing.s)
                .padding(.vertical, Spacing.xxs)
                .background(tint.opacity(0.14), in: .capsule)
        }
    }

    private var words: String? {
        if tool.isRunning { return "Running" }
        if let code = tool.exitCode, code != 0 { return "Exit \(code)" }
        return switch tool.outcome {
        case .failed: "Failed"
        case .denied: "Denied"
        case .aborted: "Stopped"
        case .completed, nil: nil
        }
    }

    private var tint: Color {
        if tool.isRunning { return Palette.working }
        return tool.failed ? Palette.failed : .secondary
    }
}
