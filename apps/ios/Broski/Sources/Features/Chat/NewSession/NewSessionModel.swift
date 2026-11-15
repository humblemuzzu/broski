import BroskiCore
import Foundation
import Observation

/// A session about to be made: on which Mac, with which agent, in which folder, with which model,
/// thinking and modes, and its first prompt. Send creates it (`session.create`); its chat then sends
/// the prompt once its view is attached, as the bridge requires.
@Observable
final class NewSessionModel {
    var machineId: String?
    var backend: BackendId?
    var folder: String?
    var draft = ComposerDraft()
    var choices = ComposerChoices()
    let catalog = ComposerCatalog()
    private(set) var roots: [String] = []
    private(set) var problem: ChatProblem?
    private(set) var isCreating = false

    /// The folders sessions on `machineId` ran in, newest first, each once.
    static func recentFolders(_ rows: [InboxRow], machineId: String?) -> [String] {
        var seen = Set<String>()
        return rows.filter { $0.machineId == machineId }
            .sorted { $0.updatedAt > $1.updatedAt }
            .compactMap(\.cwd)
            .filter { seen.insert($0).inserted }
    }

    /// The first agent this Mac can run now, else the first it lists.
    static func defaultBackend(_ machine: MachineModel) -> BackendId? {
        machine.backends.first { machine.backendStatuses[$0.id]?.usable ?? true }?.id ?? machine.backends.first?.id
    }

    func loadRoots(_ machine: Machine) async {
        if let info = try? await WorkspaceRequests(machine: machine).info() { roots = info.roots }
        if folder == nil { folder = roots.first }
    }

    var canCreate: Bool { machineId != nil && backend != nil && folder != nil && draft.hasContent && !isCreating }

    /// Creates the session and hands its first prompt to the draft store for its chat to send.
    func create(on machine: Machine, drafts: DraftStore) async -> SessionTarget? {
        guard let machineId, let backend, let folder, canCreate else { return nil }
        isCreating = true
        defer { isCreating = false }
        let options = NewSessionOptions(
            cwd: folder, modelId: choices.modelId, thinking: choices.thinking,
            modes: choices.modes.isEmpty ? nil : choices.modes.map { ModeSetting(axis: $0.key, value: $0.value) }.sorted { $0.axis < $1.axis })
        do throws(ChatProblem) {
            let session = try await ChatRequests(machine: machine).create(backend, options)
            let target = SessionTarget(machineId: machineId, session: session)
            drafts.setFirstPrompt(draft, for: target)
            draft = ComposerDraft()
            return target
        } catch {
            problem = error
            return nil
        }
    }

    func choose(_ choice: ComposerChoice) {
        switch choice {
        case .model(let id):
            choices.modelId = id
            choices.thinking = nil
        case .thinking(let value): choices.thinking = value
        case .mode(let axis, let value): choices.modes[axis] = value
        }
    }
}
