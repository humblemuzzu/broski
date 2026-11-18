import BroskiCore
import Foundation
import Observation
import SwiftUI

/// The terminals opened in one folder or below it, newest first. The folder screen lists them above
/// its files, so a terminal opened here is a tap away when the person comes back.
@Observable
final class FolderTerminals {
    let folder: String
    /// The folder with its links resolved, as the bridge spells a terminal's: one opened here names it so.
    var canonicalFolder: String?
    private(set) var terminals: [TerminalSummary] = []
    /// A terminal that did not close.
    private(set) var problem: WorkspaceProblem?

    @ObservationIgnored private let requests: WorkspaceRequests

    init(folder: String, requests: WorkspaceRequests) {
        self.folder = folder
        self.requests = requests
    }

    /// A list that does not come leaves the last one: the files are what the screen is for.
    func load() async {
        guard let all = try? await requests.terminals() else { return }
        terminals = Self.within([folder, canonicalFolder].compactMap(\.self), all)
    }

    /// Ends the terminal's process if it runs, and forgets it.
    func close(_ terminal: TerminalSummary) async {
        do throws(WorkspaceProblem) {
            try await requests.closeTerminal(id: terminal.id)
            problem = nil
        } catch {
            problem = error
        }
        await load()
    }

    nonisolated static func within(_ folders: [String], _ terminals: [TerminalSummary]) -> [TerminalSummary] {
        terminals.filter { terminal in folders.contains { terminal.cwd.isWithin($0) } }.sorted { $0.createdAt > $1.createdAt }
    }
}

/// The folder's terminals as rows that open them; swipe or long-press to close one.
struct FolderTerminalsSection: View {
    let machineId: String
    let model: FolderTerminals
    @Binding var closing: TerminalSummary?

    var body: some View {
        if !model.terminals.isEmpty {
            Section("Terminals") {
                if let problem = model.problem {
                    Banner(problem: problem)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                ForEach(model.terminals, id: \.id) { terminal in
                    NavigationLink(value: Route.workspace(machineId: machineId, place: .terminal(id: terminal.id))) {
                        TerminalRow(terminal: terminal, folder: terminal.cwd.isWithin(model.folder) ? model.folder : model.canonicalFolder ?? model.folder)
                    }
                    .swipeActions {
                        Button("Close", systemImage: "xmark", role: .destructive) { closing = terminal }
                    }
                    .contextMenu {
                        Button("Close Terminal", systemImage: "xmark", role: .destructive) { closing = terminal }
                    }
                }
            }
        }
    }
}

private struct TerminalRow: View {
    let terminal: TerminalSummary
    let folder: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(place).font(.body.weight(.medium)).lineLimit(1).truncationMode(.head)
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

    /// Where it runs: this folder by its name, a folder below by its path from here.
    private var place: String {
        terminal.cwd == folder ? folder.lastPathComponent : String(terminal.cwd.dropFirst(folder.hasSuffix("/") ? folder.count : folder.count + 1))
    }

    private var created: Date { Date(unixMilliseconds: terminal.createdAt) }

    private var state: String {
        switch terminal.status {
        case .running: "Running"
        case .exited: terminal.signal.map { "Ended by \($0)" } ?? "Exited \(terminal.exitCode ?? 0)"
        }
    }
}
