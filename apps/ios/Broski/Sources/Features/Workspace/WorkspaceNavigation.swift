import Observation

/// Which machine the Workspace tab shows, and the screens pushed on it.
@Observable
final class WorkspaceNavigation {
    var machineId: String?
    var path: [Route] = []

    /// The chosen machine while it is paired, else the oldest pairing.
    func machine(in machines: [MachineModel]) -> MachineModel? {
        machines.first { $0.id == machineId } ?? machines.first
    }

    func choose(_ machineId: String) {
        guard machineId != self.machineId else { return }
        self.machineId = machineId
        path = []
    }

    /// Shows `target`'s folder on its machine, in place of whatever the tab showed.
    func open(_ target: FolderTarget) {
        machineId = target.machineId
        path = [.workspace(machineId: target.machineId, place: .folder(target.path))]
    }
}
