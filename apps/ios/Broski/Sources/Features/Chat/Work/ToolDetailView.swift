import BroskiCore
import SwiftUI

/// A call opened in place: what it was given (the command coloured as shell, its arguments as a
/// property list), what its result shows (its tool's own view, else how the core reads the output:
/// a report formatted, a file's lines, search rows, JSON or a log), its error, the files it changed
/// (each opening its diff), and the session a subagent ran in.
struct ToolDetailView: View {
    let tool: ToolWork
    @Environment(\.chatMachineId) private var machineId

    static let outputCap: CGFloat = 220
    /// Lines of an error drawn in place.
    static let errorLines: UInt32 = 40

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let command = tool.look.command {
                CommandLineView(command: command)
            }
            if !hidesArguments {
                let arguments = toolArguments(facts: tool.facts)
                if !arguments.isEmpty { ToolArgumentsView(rows: arguments) }
            }
            result
            if let error = tool.error, !error.isEmpty {
                LogLinesView(log: formatLog(text: error, maxLines: Self.errorLines, keep: .head), tint: Palette.failed)
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

    /// A task list's arguments are the list it shows.
    private var hidesArguments: Bool {
        if case .todos = tool.display { true } else { false }
    }

    @ViewBuilder
    private var result: some View {
        if let display = tool.display {
            ToolDisplayView(display: display, title: tool.label)
        } else {
            output
        }
    }

    @ViewBuilder
    private var output: some View {
        if tool.output.isEmpty {
            if !tool.isRunning && tool.fileChanges.isEmpty && tool.error == nil {
                Text("No output.").font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            switch toolBody(facts: tool.facts, output: tool.output) {
            case .log(let lines, let hiddenLines):
                LogBox(log: LogText(lines: lines, hiddenLines: hiddenLines), title: tool.label, source: tool.output)
            case let body:
                ToolBodyView(body, title: tool.label)
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
