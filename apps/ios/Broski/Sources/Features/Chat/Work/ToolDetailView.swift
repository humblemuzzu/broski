import BroskiCore
import SwiftUI

/// A call opened in place: what it was given (the command exactly, or its arguments), what it
/// printed (capped, scrolling), its error, the files it changed (each opening its diff), and the
/// session a subagent ran in.
struct ToolDetailView: View {
    let tool: ToolWork
    @Environment(\.chatMachineId) private var machineId

    static let outputCap: CGFloat = 220

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let given {
                Text(given)
                    .font(.codeSmall)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            output
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

    /// The command as the agent wrote it, else one `key: value` line per argument.
    private var given: String? {
        if tool.kind == .command, let command = tool.command { return "$ " + command }
        return tool.input.map { $0.argumentLines.joined(separator: "\n") }
    }

    @ViewBuilder
    private var output: some View {
        if tool.output.isEmpty {
            if !tool.isRunning && tool.fileChanges.isEmpty {
                Text("No output.").font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            ScrollView {
                Text(tool.output)
                    .font(.codeSmall)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.s)
            }
            .frame(maxHeight: Self.outputCap)
            .fixedSize(horizontal: false, vertical: true)
            .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
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
