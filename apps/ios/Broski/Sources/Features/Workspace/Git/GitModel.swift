import BroskiCore
import Foundation
import Observation

/// A repository's status, its newest commits, and what the person does to it: stage, unstage,
/// commit. Every change reads the status again, so the lists are always git's.
@Observable
final class GitModel {
    enum Phase {
        case loading
        case loaded(GitStatusRead)
        case notRepository
        case failed(WorkspaceProblem)
    }

    static let logLimit: Int64 = 10

    let cwd: String
    private(set) var phase: Phase = .loading
    private(set) var commits: [GitCommit] = []
    private(set) var isChanging = false
    /// What the last change could not do, in git's words.
    private(set) var problem: WorkspaceProblem?
    /// Counts each commit made here, for the success haptic.
    private(set) var commitCount = 0
    var message = ""

    @ObservationIgnored private let requests: WorkspaceRequests

    init(cwd: String, requests: WorkspaceRequests) {
        self.cwd = cwd
        self.requests = requests
    }

    var status: GitStatusRead? {
        if case .loaded(let status) = phase { status } else { nil }
    }

    var sections: [GitSection] { status.map(GitSection.sections) ?? [] }

    var canCommit: Bool {
        !isChanging && !(status?.staged.isEmpty ?? true)
            && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func load() async {
        do throws(WorkspaceProblem) {
            let status = try await requests.status(cwd: cwd)
            phase = .loaded(status)
            commits = (try? await requests.log(cwd: cwd, limit: Self.logLimit)) ?? commits
        } catch let problem where problem.isNotRepository {
            phase = .notRepository
        } catch {
            phase = .failed(error)
        }
    }

    func stage(_ paths: [String]) async {
        await change { () async throws(WorkspaceProblem) in try await requests.stage(cwd: cwd, paths: paths) }
    }

    func unstage(_ paths: [String]) async {
        await change { () async throws(WorkspaceProblem) in try await requests.unstage(cwd: cwd, paths: paths) }
    }

    func commit() async {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let committed = await change { () async throws(WorkspaceProblem) in
            _ = try await requests.commit(cwd: cwd, message: message)
        }
        if committed {
            self.message = ""
            commitCount += 1
        }
    }

    /// Runs one change, then reads the status again whether or not git took it.
    @discardableResult
    private func change(_ body: () async throws(WorkspaceProblem) -> Void) async -> Bool {
        isChanging = true
        defer { isChanging = false }
        var done = true
        do throws(WorkspaceProblem) {
            try await body()
            problem = nil
        } catch {
            problem = error
            done = false
        }
        await load()
        return done
    }
}

/// One list of the status: staged, unstaged or untracked, in git's order.
struct GitSection: Identifiable, Equatable {
    enum Area: String {
        case staged = "Staged"
        case unstaged = "Changes"
        case untracked = "Untracked"
    }

    let area: Area
    let rows: [GitRow]

    var id: Area { area }

    /// The non-empty lists, staged first.
    static func sections(_ status: GitStatusRead) -> [GitSection] {
        [
            GitSection(area: .staged, rows: status.staged.map { GitRow($0, area: .staged) }),
            GitSection(area: .unstaged, rows: status.unstaged.map { GitRow($0, area: .unstaged) }),
            GitSection(area: .untracked, rows: status.untracked.map { GitRow(untracked: $0) }),
        ].filter { !$0.rows.isEmpty }
    }
}

/// One changed path. `change` is absent for an untracked file; the counts are absent for a binary
/// or conflicted file.
struct GitRow: Identifiable, Equatable {
    let path: String
    let previousPath: String?
    let change: GitChange?
    let additions: Int64?
    let deletions: Int64?
    let area: GitSection.Area

    var id: String { "\(area.rawValue)/\(path)" }

    init(_ change: GitFileChange, area: GitSection.Area) {
        path = change.path
        previousPath = change.previousPath
        self.change = change.change
        additions = change.additions
        deletions = change.deletions
        self.area = area
    }

    init(untracked path: String) {
        self.path = path
        previousPath = nil
        change = nil
        additions = nil
        deletions = nil
        area = .untracked
    }
}

/// Whether a folder is in a repository, and the branch line its folder screen shows.
@Observable
final class RepositoryModel {
    let cwd: String
    private(set) var status: GitStatusRead?

    @ObservationIgnored private let requests: WorkspaceRequests

    init(cwd: String, requests: WorkspaceRequests) {
        self.cwd = cwd
        self.requests = requests
    }

    /// A folder outside any repository, a machine without git, or a status that did not come, all
    /// leave the folder without a repository row.
    func check() async {
        status = try? await requests.status(cwd: cwd)
    }
}

extension WorkspaceProblem {
    /// `not_found` on a git request: the directory is in no work tree (contract §20.4).
    var isNotRepository: Bool { code == .notFound }
}
