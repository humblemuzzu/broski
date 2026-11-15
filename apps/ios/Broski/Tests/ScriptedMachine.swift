import BroskiCore
import Foundation
import UIKit

@testable import Broski

/// Stands in for `Machine.request`: answers each workspace request with what `respond` returns,
/// and keeps every request it was sent.
final class ScriptedMachine {
    private(set) var messages: [ClientMessage] = []
    private let respond: (ClientMessage) throws -> ServerMessage?

    init(respond: @escaping (ClientMessage) throws -> ServerMessage?) {
        self.respond = respond
    }

    var requests: WorkspaceRequests {
        WorkspaceRequests { [self] message in
            messages.append(message)
            await Task.yield()
            guard let answer = try respond(message) else { throw ClientError.UnexpectedAnswer(answer: "\(message)") }
            return answer
        }
    }

    var sent: [FsListRequest] {
        messages.compactMap { if case .fsList(let request) = $0 { request } else { nil } }
    }

    var checkouts: [String] {
        messages.compactMap { if case .gitCheckout(let request) = $0 { request.branch } else { nil } }
    }

    var commits: [String] {
        messages.compactMap { if case .gitCommit(let request) = $0 { request.message } else { nil } }
    }

    /// A repository with one modified file, `notes.md`, that git stages, unstages and commits.
    static func repository() -> ScriptedMachine {
        var staged = false
        var log: [GitCommit] = []
        let change = GitFileChange(path: "notes.md", previousPath: nil, change: .modified, additions: 1, deletions: 1)
        return ScriptedMachine { message in
            switch message {
            case .gitStatus(let request):
                let clean = !log.isEmpty
                let status = GitStatusRead(
                    root: "/w", branch: "main", head: "abc1234", upstream: nil,
                    staged: staged && !clean ? [change] : [], unstaged: staged || clean ? [] : [change],
                    untracked: [], truncated: false)
                return .gitStatusResult(GitStatusResponse(requestId: request.requestId, result: .accepted(status)))
            case .gitLog(let request):
                return .gitLogResult(GitLogResponse(requestId: request.requestId, result: .accepted(GitLogRead(commits: log))))
            case .gitStage(let request):
                staged = true
                return .gitStageResult(GitStageResponse(requestId: request.requestId, result: .accepted(ActionAccepted())))
            case .gitCommit(let request):
                let commit = GitCommit(hash: "def5678", subject: request.message, author: "Test", authoredAt: 1_725_000_000_000)
                log.insert(commit, at: 0)
                return .gitCommitResult(GitCommitResponse(requestId: request.requestId, result: .accepted(GitCommitted(commit: commit))))
            default:
                return nil
            }
        }
    }
}

extension FileEntry {
    static func dir(_ name: String) -> FileEntry { FileEntry(name: name, kind: .dir, size: nil, modifiedAt: nil) }
    static func file(_ name: String) -> FileEntry { FileEntry(name: name, kind: .file, size: 3, modifiedAt: nil) }
}

extension Fixture {
    /// A 2×2 PNG drawn here.
    static var png: Data {
        UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2)).pngData { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
    }
}
