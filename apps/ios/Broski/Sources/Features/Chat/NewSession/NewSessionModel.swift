import BroskiCore
import Foundation
import Observation

/// A folder sessions ran in on one Mac, whichever agent ran them: every agent reports each session's
/// real working directory (Claude Code from the session file, Pi from its header), so a project is
/// a folder, not something either agent defines.
nonisolated struct Project: Hashable, Identifiable {
    let path: String
    /// When a session in it last moved.
    let updatedAt: Int64

    var id: String { path }
    var name: String { path.lastPathComponent }

    /// The folders of the sessions on `machineId`, the most recently used first, each once.
    static func recent(_ rows: [InboxRow], machineId: String?) -> [Project] {
        var newest: [String: Int64] = [:]
        for row in rows where row.machineId == machineId {
            if let cwd = row.cwd { newest[cwd] = max(newest[cwd] ?? .min, row.updatedAt) }
        }
        return newest.map { Project(path: $0.key, updatedAt: $0.value) }
            .sorted { ($0.updatedAt, $1.path) > ($1.updatedAt, $0.path) }
    }
}

/// A session about to be made: on which Mac, in which folder, with which agent, model, thinking and
/// modes, and its first prompt. What the person has not picked follows the Mac (`settle`). Send
/// creates the session (`session.create`); its chat then sends the prompt once its view is attached,
/// as the bridge requires.
@Observable
final class NewSessionModel {
    private(set) var machineId: String?
    private(set) var folder: String?
    private(set) var backend: String?
    var draft = ComposerDraft()
    private(set) var choices = ComposerChoices()
    let catalog = ComposerCatalog()
    /// The Mac's home folder, where browsing starts and which paths are written from as `~`.
    private(set) var home: String?
    private(set) var problem: ChatProblem?
    private(set) var isCreating = false

    /// Whether the person picked the agent: until they do, it follows the folder.
    @ObservationIgnored private var pickedBackend = false

    /// Fills what the person has not picked. The Mac: the first ready, else the first. The folder:
    /// the newest session's there. The agent: the one last used in that folder while it can run, else
    /// the first that can; one the person picked stays while the Mac lists it and can run it.
    func settle(machines: [MachineModel], rows: [InboxRow]) {
        if !machines.contains(where: { $0.id == machineId }) {
            pickMachine((machines.first { $0.summary.isReady } ?? machines.first)?.id)
        }
        guard let machine = machines.first(where: { $0.id == machineId }) else { return }
        if folder == nil { folder = Project.recent(rows, machineId: machine.id).first?.path }
        let keeps = pickedBackend && backend.map { id in machine.backends.contains { $0.id == id } && machine.canRun(id) } == true
        guard !keeps else { return }
        pickedBackend = false
        let fitting = Self.defaultBackend(machine, folder: folder, rows: rows)
        if fitting != backend {
            backend = fitting
            choices = ComposerChoices()
        }
    }

    static func defaultBackend(_ machine: MachineModel, folder: String?, rows: [InboxRow]) -> String? {
        let lastHere = rows.filter { $0.machineId == machine.id && $0.cwd == folder }
            .max { $0.updatedAt < $1.updatedAt }?.session.backend
        if let lastHere, machine.canRun(lastHere) { return lastHere }
        return machine.backends.first { machine.canRun($0.id) }?.id ?? machine.backends.first?.id
    }

    func pickMachine(_ id: String?) {
        guard id != machineId else { return }
        machineId = id
        folder = nil
        backend = nil
        pickedBackend = false
        home = nil
        choices = ComposerChoices()
        problem = nil
    }

    func pickFolder(_ path: String) {
        folder = path
        problem = nil
    }

    func pickBackend(_ id: String) {
        guard id != backend else { return }
        backend = id
        pickedBackend = true
        choices = ComposerChoices()
    }

    func choose(_ choice: ComposerChoice) {
        switch choice {
        case .model(let id, let thinking):
            choices.modelId = id
            choices.thinking = thinking
        case .thinking(let value): choices.thinking = value
        case .mode(let axis, let value): choices.modes[axis] = value
        }
    }

    /// What the composer could not take, such as an image too large for one message.
    func report(_ message: String) {
        problem = ChatProblem(message: message)
    }

    func loadHome(_ machine: Machine) async {
        home = try? await WorkspaceRequests(machine: machine).info().roots.first
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
            problem = nil
            return target
        } catch {
            problem = error
            return nil
        }
    }
}

extension MachineModel {
    /// Whether the agent can run now; one whose status has not come yet is taken to.
    func canRun(_ backend: String) -> Bool {
        backendStatuses[backend]?.usable ?? true
    }
}
