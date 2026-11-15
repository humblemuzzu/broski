import BroskiCore
import Foundation
import Observation

/// A repository's branches, local first, and switching to one. A switch git refuses (local
/// changes it would overwrite) is said in git's words.
@Observable
final class BranchesModel {
    enum Phase {
        case loading
        case loaded
        case failed(WorkspaceProblem)
    }

    let cwd: String
    private(set) var phase: Phase = .loading
    private(set) var branches: [GitBranch] = []
    private(set) var truncated = false
    private(set) var switching: String?
    private(set) var problem: WorkspaceProblem?
    /// Counts each switch git made, for the success haptic.
    private(set) var switchCount = 0

    @ObservationIgnored private let requests: WorkspaceRequests

    init(cwd: String, requests: WorkspaceRequests) {
        self.cwd = cwd
        self.requests = requests
    }

    var local: [GitBranch] { branches.filter { !$0.remote } }
    var remote: [GitBranch] { branches.filter(\.remote) }

    func load() async {
        do throws(WorkspaceProblem) {
            let listed = try await requests.branches(cwd: cwd)
            branches = listed.branches
            truncated = listed.truncated
            phase = .loaded
        } catch {
            phase = .failed(error)
        }
    }

    func checkout(_ branch: GitBranch) async {
        switching = branch.name
        defer { switching = nil }
        do throws(WorkspaceProblem) {
            _ = try await requests.checkout(cwd: cwd, branch: branch.checkoutName)
            problem = nil
            switchCount += 1
        } catch {
            problem = error
        }
        await load()
    }
}

extension GitBranch {
    /// What `git.checkout` takes: a local branch's name, or a remote one's without its remote,
    /// which makes the local branch that tracks it.
    var checkoutName: String {
        guard remote, let slash = name.firstIndex(of: "/") else { return name }
        return String(name[name.index(after: slash)...])
    }
}
