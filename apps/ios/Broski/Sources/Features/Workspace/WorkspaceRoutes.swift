import BroskiCore
import SwiftUI

/// A screen of one machine's workspace, pushed as `Route.workspace(machineId:place:)`.
enum WorkspacePlace: Hashable {
    case folder(String)
    case file(String)
    case git(cwd: String)
    case diff(cwd: String, path: String, staged: Bool)
    case branches(cwd: String)
    case terminal(id: String)
    /// A terminal opened in `cwd` when the screen appears.
    case newTerminal(cwd: String)
}

extension EnvironmentValues {
    /// Whether the machine whose workspace is on screen can be asked anything now. While it
    /// cannot, a request would wait out the core's deadline, so screens hold their loads and
    /// disable what changes the machine.
    @Entry var workspaceReachable = true
}

/// A workspace screen for one machine, under the machine's status while it cannot be reached.
struct WorkspaceDestination: View {
    let machineId: String
    let place: WorkspacePlace
    @Environment(AppModel.self) private var model

    var body: some View {
        if let machine = model.machine(id: machineId) {
            screen(machine.machine)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if !machine.summary.isReady {
                        MachineStatusStrip(summary: machine.summary)
                    }
                }
                .environment(\.workspaceReachable, machine.summary.isReady)
        } else {
            ContentUnavailableView(
                "This Mac isn't paired anymore", systemImage: "laptopcomputer.slash",
                description: Text("Pair it again from Machines to see its files."))
        }
    }

    @ViewBuilder
    private func screen(_ machine: Machine) -> some View {
        let requests = WorkspaceRequests(machine: machine)
        switch place {
        case .folder(let path):
            FolderScreen(machineId: machineId, path: path, requests: requests)
        case .file(let path):
            FileScreen(path: path, requests: requests)
        case .git(let cwd):
            GitScreen(machineId: machineId, cwd: cwd, requests: requests)
        case .diff(let cwd, let path, let staged):
            DiffScreen(cwd: cwd, path: path, staged: staged, requests: requests)
        case .branches(let cwd):
            BranchesScreen(cwd: cwd, requests: requests)
        case .terminal(let id):
            TerminalScreen(machine: machine, start: .attach(id), requests: requests)
        case .newTerminal(let cwd):
            TerminalScreen(machine: machine, start: .open(cwd: cwd), requests: requests)
        }
    }
}

/// The machine's status in a strip under the navigation bar.
struct MachineStatusStrip: View {
    let summary: MachineSummary

    var body: some View {
        StatusChip(text: summary.line, tone: summary.health.tone)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.s)
            .background(.bar)
    }
}
