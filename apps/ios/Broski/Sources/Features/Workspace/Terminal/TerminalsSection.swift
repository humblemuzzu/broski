import BroskiCore
import SwiftUI

/// The machine's terminals, newest first, each opening its view; swipe to close one. New Terminal
/// opens one in a shared folder.
struct TerminalsSection: View {
    let machineId: String
    let info: WorkspaceInfo
    let home: WorkspaceHomeModel
    @Binding var closing: TerminalSummary?

    var body: some View {
        Section {
            if let problem = home.terminalProblem {
                Banner(problem: problem)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ForEach(home.terminals, id: \.id) { terminal in
                NavigationLink(value: Route.workspace(machineId: machineId, place: .terminal(id: terminal.id))) {
                    TerminalRow(terminal: terminal)
                }
                .swipeActions {
                    Button("Close", systemImage: "xmark", role: .destructive) { closing = terminal }
                }
                .contextMenu {
                    Button("Close Terminal", systemImage: "xmark", role: .destructive) { closing = terminal }
                }
            }
            if info.terminal {
                newTerminal
            }
        } header: {
            Text("Terminals")
        } footer: {
            if !info.terminal {
                Text("This Mac can't open terminals: the bridge's terminal helper is missing.")
            }
        }
    }

    @ViewBuilder
    private var newTerminal: some View {
        if info.roots.count > 1 {
            Menu {
                ForEach(info.roots, id: \.self) { root in
                    NavigationLink(root, value: Route.workspace(machineId: machineId, place: .newTerminal(cwd: root)))
                }
            } label: {
                Label("New Terminal", systemImage: "plus")
            }
        } else if let root = info.roots.first {
            NavigationLink(value: Route.workspace(machineId: machineId, place: .newTerminal(cwd: root))) {
                Label("New Terminal", systemImage: "plus")
            }
        }
    }
}

private struct TerminalRow: View {
    let terminal: TerminalSummary

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(terminal.cwd.lastPathComponent).font(.body.weight(.medium))
                Text("\(state) · \(terminal.cols)×\(terminal.rows) · \(created, format: .relative(presentation: .named, unitsStyle: .abbreviated))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: terminal.status == .running ? "apple.terminal.fill" : "apple.terminal")
                .foregroundStyle(terminal.status == .running ? Palette.working : .secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var created: Date { Date(unixMilliseconds: terminal.createdAt) }

    private var state: String {
        switch terminal.status {
        case .running: "Running"
        case .exited: terminal.signal.map { "Ended by \($0)" } ?? "Exited \(terminal.exitCode ?? 0)"
        }
    }
}
