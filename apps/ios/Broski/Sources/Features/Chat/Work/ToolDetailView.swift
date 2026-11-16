import BroskiCore
import SwiftUI

/// A call opened in place: what it was given (the command exactly, or its arguments), what its
/// result shows (its tool's own view, else the last lines it printed, the whole output a tap away),
/// its error, the files it changed (each opening its diff), and the session a subagent ran in.
struct ToolDetailView: View {
    let tool: ToolWork
    @Environment(\.chatMachineId) private var machineId

    static let outputCap: CGFloat = 220
    /// Lines of output drawn in place; a tool can print megabytes.
    static let outputLines: UInt32 = 200

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let given {
                Text(given)
                    .font(.codeSmall)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let display = tool.display {
                ToolDisplayView(display: display)
            } else {
                output
            }
            if let error = tool.error, !error.isEmpty {
                Text(error).font(.footnote).foregroundStyle(Palette.failed).textSelection(.enabled)
            }
            ForEach(tool.fileChanges, id: \.path) { change in
                NavigationLink(value: Route.toolDiff(change)) {
                    FileChangeRow(change: change)
                }
                .buttonStyle(.plain)
            }
            if let child = tool.childSession, let machineId {
                NavigationLink(value: Route.session(machineId: machineId, session: child)) {
                    Label("Open the subagent's session", systemImage: "arrow.up.forward.square")
                        .font(.footnote.weight(.medium))
                }
            }
        }
    }

    /// The command as the agent wrote it, else one `key: value` line per argument; a task list's
    /// arguments are the list it shows.
    private var given: String? {
        if let command = tool.look.command { return "$ " + command }
        if case .todos = tool.display { return nil }
        return tool.input.map { $0.argumentLines.joined(separator: "\n") }
    }

    @ViewBuilder
    private var output: some View {
        if tool.output.isEmpty {
            if !tool.isRunning && tool.fileChanges.isEmpty {
                Text("No output.").font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            let clip = clipText(text: tool.output, maxLines: Self.outputLines, keep: .tail)
            ScrollView {
                Text(clip.text)
                    .font(.codeSmall)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.s)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .frame(maxHeight: Self.outputCap)
            .fixedSize(horizontal: false, vertical: true)
            .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
            if clip.hiddenLines > 0 {
                NavigationLink(value: Route.text(TextPage(title: tool.label, text: tool.output, format: .log))) {
                    HStack(spacing: Spacing.xs) {
                        Text("Show all output")
                        Text("· ^[\(clip.hiddenLines) more line](inflect: true)").foregroundStyle(.secondary)
                    }
                    .font(.footnote.weight(.medium))
                }
            }
        }
    }
}

/// A file a call changed: its name, folder and counts; it opens the diff.
struct FileChangeRow: View {
    let change: FileChange

    var body: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: "doc.text").foregroundStyle(.secondary).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(change.path.lastPathComponent).font(.footnote.weight(.medium))
                Text(change.path).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
            }
            Spacer(minLength: Spacing.s)
            LineCounts(additions: change.additions, deletions: change.deletions)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(Spacing.s)
        .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the diff")
    }
}

extension EnvironmentValues {
    /// The machine whose chat is on screen, for links to other sessions on it.
    @Entry var chatMachineId: String?
}
