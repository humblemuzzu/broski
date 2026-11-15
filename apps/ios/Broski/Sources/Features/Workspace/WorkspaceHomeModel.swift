import BroskiCore
import Foundation
import Observation

/// One machine's workspace at a glance: the folders it shares, whether it has git and terminals,
/// and its terminals, newest first.
@Observable
final class WorkspaceHomeModel {
    private(set) var info: WorkspaceInfo?
    private(set) var problem: WorkspaceProblem?
    private(set) var terminals: [TerminalSummary] = []
    /// A terminal that did not close, or a list that did not come.
    private(set) var terminalProblem: WorkspaceProblem?

    @ObservationIgnored private let requests: WorkspaceRequests

    init(requests: WorkspaceRequests) {
        self.requests = requests
    }

    func load() async {
        async let info: Void = loadInfo()
        async let terminals: Void = loadTerminals()
        _ = await (info, terminals)
    }

    func loadTerminals() async {
        do throws(WorkspaceProblem) {
            terminals = try await requests.terminals()
            terminalProblem = nil
        } catch {
            terminalProblem = error
        }
    }

    /// Ends the terminal's process if it runs, and forgets it.
    func close(_ terminal: TerminalSummary) async {
        do throws(WorkspaceProblem) {
            try await requests.closeTerminal(id: terminal.id)
            terminalProblem = nil
        } catch {
            terminalProblem = error
        }
        await loadTerminals()
    }

    private func loadInfo() async {
        do throws(WorkspaceProblem) {
            info = try await requests.info()
            problem = nil
        } catch {
            problem = error
        }
    }
}
