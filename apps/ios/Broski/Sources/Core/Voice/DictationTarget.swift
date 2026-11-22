import BroskiCore
import Foundation

/// A composer that dictates: where the text goes, and what the session can tell the speech model.
struct DictationTarget {
    /// The composer's identity; only that composer shows the recording.
    let id: String
    /// The session's names, gathered while the person speaks.
    let sources: () async -> DictationSources
    let insert: (String) -> Void
    /// Sends the composer as its button would; `nil` where it cannot send by itself.
    let send: (() -> Void)?
}

/// A session folder's listing and git status, asked of the Mac at most once a minute per folder
/// while dictating, and never waited on for long: dictation needs no Mac.
final class WorkspaceGlance {
    private struct Seen {
        let at: Date
        let folder: FilesListed?
        let git: GitStatusRead?
    }

    private var seen: [String: Seen] = [:]
    static let freshFor: TimeInterval = 60

    func look(_ machine: Machine, machineId: String, cwd: String) async -> (FilesListed?, GitStatusRead?) {
        let key = machineId + "\n" + cwd
        if let known = seen[key], Date.now.timeIntervalSince(known.at) < Self.freshFor {
            return (known.folder, known.git)
        }
        let requests = WorkspaceRequests(machine: machine)
        async let folder = try? requests.list(path: cwd, cursor: nil, hidden: false)
        async let git = try? requests.status(cwd: cwd)
        let found = await (folder, git)
        seen[key] = Seen(at: .now, folder: found.0, git: found.1)
        return found
    }
}

extension DictationSources {
    static let empty = DictationSources(items: [], folder: nil, git: nil, cwd: nil, dictionary: [])
}

extension DictationTarget {
    /// A chat's composer: the newest transcript items and the session folder.
    static func chat(
        _ chat: ChatModel, cwd: @escaping () -> String?, machine: MachineModel, glance: WorkspaceGlance,
        send: @escaping () -> Void
    ) -> DictationTarget {
        DictationTarget(
            id: "chat:\(chat.machineId):\(chat.session.backend):\(chat.session.sessionId)",
            sources: { [weak chat] in
                guard let chat else { return .empty }
                let cwd = cwd()
                var sources = DictationSources(items: chat.recentItems(), folder: nil, git: nil, cwd: cwd, dictionary: [])
                if let cwd {
                    (sources.folder, sources.git) = await glance.look(machine.machine, machineId: machine.id, cwd: cwd)
                }
                return sources
            },
            insert: { chat.draft.text = Dictation.joined(chat.draft.text, $0) },
            send: send)
    }

    /// New session's composer: no transcript yet, only the folder chosen.
    static func newSession(_ model: NewSessionModel, machine: MachineModel, glance: WorkspaceGlance) -> DictationTarget {
        DictationTarget(
            id: "new-session",
            sources: { [weak model] in
                guard let cwd = model?.folder else { return .empty }
                let (folder, git) = await glance.look(machine.machine, machineId: machine.id, cwd: cwd)
                return DictationSources(items: [], folder: folder, git: git, cwd: cwd, dictionary: [])
            },
            insert: { model.draft.text = Dictation.joined(model.draft.text, $0) },
            send: nil)
    }
}
