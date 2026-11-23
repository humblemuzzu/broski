import BroskiCore
import Observation

/// The composer's choices for one agent in one folder: its models, slash commands and modes, read
/// from the core's cached catalog (mobile-core.md, "Catalog") and read again when it is invalidated.
@Observable
final class ComposerCatalog {
    private(set) var models: [ModelSummary] = []
    private(set) var commands: [CommandSummary] = []
    private(set) var modes: [ModeAxis] = []

    func load(_ machine: Machine, backend: String, cwd: String?, session: SessionRef?) async {
        async let models = try? machine.models(backend: backend, cwd: cwd, includeUnavailable: false)
        async let commands = try? machine.commands(backend: backend, cwd: cwd, session: session)
        async let modes = try? machine.modes(backend: backend, cwd: cwd)
        if case .accepted(let listed) = await models { self.models = listed.models }
        if case .accepted(let listed) = await commands { self.commands = listed.commands }
        if case .accepted(let listed) = await modes { self.modes = listed.modes }
    }

    func model(_ id: String?) -> ModelSummary? {
        models.first { $0.id == id } ?? (id == nil ? models.first(where: \.isDefault) : nil)
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
}

/// One step the model sheet takes. A model comes with the level last chosen on it, when it offers
/// that level, applied after the model.
enum ComposerChoice: Equatable {
    case model(String, thinking: String?)
    case thinking(String)
    case mode(axis: String, value: String)
}
