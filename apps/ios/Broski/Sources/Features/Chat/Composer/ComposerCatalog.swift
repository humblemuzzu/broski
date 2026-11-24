import BroskiCore
import Observation

/// The composer's choices for one agent in one folder: its models, slash commands and modes, read
/// from the core's cached catalog (mobile-core.md, "Catalog") and read again when it is invalidated.
@Observable
final class ComposerCatalog {
    private(set) var models: [ModelSummary] = []
    private(set) var commands: [CommandSummary] = []
    private(set) var modes: [ModeAxis] = []
    @ObservationIgnored private var loadedBackend: String?

    private enum Piece: Sendable {
        case models([ModelSummary])
        case modes([ModeAxis])
        case commands([CommandSummary])
    }

    func load(_ machine: Machine, backend: String, cwd: String?, session: SessionRef?) async {
        if loadedBackend != backend {
            loadedBackend = backend
            models = []
            commands = []
            modes = []
        }
        await withTaskGroup(of: Piece?.self) { group in
            group.addTask {
                guard case .accepted(let listed) = try? await machine.models(backend: backend, cwd: cwd, includeUnavailable: false) else { return nil }
                return .models(listed.models)
            }
            group.addTask {
                guard case .accepted(let listed) = try? await machine.modes(backend: backend, cwd: cwd) else { return nil }
                return .modes(listed.modes)
            }
            group.addTask {
                guard case .accepted(let listed) = try? await machine.commands(backend: backend, cwd: cwd, session: session) else { return nil }
                return .commands(listed.commands)
            }
            for await piece in group {
                guard !Task.isCancelled, loadedBackend == backend, let piece else { continue }
                switch piece {
                case .models(let list): models = list
                case .modes(let list): modes = list
                case .commands(let list): commands = list
                }
            }
        }
    }

    func model(_ id: String?) -> ModelSummary? {
        models.first { $0.id == id } ?? models.first(where: \.isDefault) ?? models.first
    }

    /// Slash commands whose name holds what follows the `/`, those that start with it first.
    func commands(matching query: String) -> [CommandSummary] {
        let query = query.lowercased()
        guard !query.isEmpty else { return commands }
        let matching = commands.filter { $0.name.lowercased().contains(query) }
        return matching.filter { $0.name.lowercased().hasPrefix(query) } + matching.filter { !$0.name.lowercased().hasPrefix(query) }
    }
}

/// What the chips show as chosen: the session's (or, for a new session, the person's) model,
/// thinking level and the value of each mode axis.
struct ComposerChoices: Equatable {
    var modelId: String?
    var thinking: String?
    var modes: [String: String] = [:]

    init(modelId: String? = nil, thinking: String? = nil, modes: [String: String] = [:]) {
        self.modelId = modelId
        self.thinking = thinking
        self.modes = modes
    }

    /// The session's choices, with what the person just picked shown before the session reports it.
    init(_ snapshot: SessionSnapshot, pending: ComposerChoices? = nil) {
        self.init(
            modelId: pending?.modelId ?? snapshot.modelId, thinking: pending?.thinking ?? snapshot.thinking,
            modes: Dictionary(snapshot.modes.map { ($0.axis, $0.value) }, uniquingKeysWith: { $1 })
                .merging(pending?.modes ?? [:]) { $1 })
    }

    func merged(with next: ComposerChoices) -> ComposerChoices {
        let switched = next.modelId != nil && next.modelId != modelId
        return ComposerChoices(
            modelId: next.modelId ?? modelId,
            thinking: switched ? next.thinking : (next.thinking ?? thinking),
            modes: modes.merging(next.modes) { $1 })
    }
}

/// One step the model sheet takes. A model comes with the level last chosen on it, when it offers
/// that level, applied after the model.
enum ComposerChoice: Equatable {
    case model(String, thinking: String?)
    case thinking(String)
    case mode(axis: String, value: String)
}
