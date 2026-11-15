import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The workspace's models over answers shaped as the bridge sends them (the generated contract
/// types), from a responder standing in for `Machine.request`.
@Suite
struct WorkspaceTests {
    @Test func aFolderPagesInTheBridgesOrderAndAsksForEachPageOnce() async {
        let machine = ScriptedMachine { message in
            guard case .fsList(let request) = message else { return nil }
            let page: FilesListed =
                request.cursor == nil
                ? FilesListed(path: "/w", entries: [.dir("src"), .file("a.txt")], nextCursor: "c1")
                : FilesListed(path: "/w", entries: [.file("b.txt")], nextCursor: nil)
            return .fsListResult(FsListResponse(requestId: request.requestId, result: .accepted(page)))
        }
        let folder = FolderModel(path: "/w", requests: machine.requests)

        await folder.load()
        #expect(folder.phase == .loaded)
        #expect(folder.entries.map(\.name) == ["src", "a.txt"])
        #expect(folder.hasMore)

        async let first: Void = folder.loadMore()
        async let second: Void = folder.loadMore()
        _ = await (first, second)
        #expect(folder.entries.map(\.name) == ["src", "a.txt", "b.txt"])
        #expect(!folder.hasMore)
        #expect(machine.sent.map(\.cursor) == [nil, "c1"], "the second call while one is out does nothing")

        await folder.loadMore()
        #expect(machine.sent.count == 2, "nothing after the last page")
        #expect(folder.childPath(.dir("src")) == "/w/src")
    }

    @Test func aRejectedRequestSaysWhatHappenedInTheContractsWordsWithTheMacsOwnBeneath() async throws {
        let gitWords = "error: Your local changes to the following files would be overwritten by checkout:\n\tnotes.md"
        let machine = ScriptedMachine { message in
            switch message {
            case .fsList(let request):
                .fsListResult(
                    FsListResponse(
                        requestId: request.requestId,
                        result: .rejected(Rejected(rejection: Rejection(code: .forbidden, message: "/etc is outside the served folders")))))
            case .gitCheckout(let request):
                .gitCheckoutResult(
                    GitCheckoutResponse(
                        requestId: request.requestId,
                        result: .rejected(Rejected(rejection: Rejection(code: .invalidInput, message: gitWords)))))
            case .gitBranches(let request):
                .gitBranchesResult(
                    GitBranchesResponse(
                        requestId: request.requestId,
                        result: .accepted(
                            GitBranchesListed(
                                branches: [
                                    GitBranch(name: "main", remote: false, current: true, upstream: nil),
                                    GitBranch(name: "origin/feature/x", remote: true, current: false, upstream: nil),
                                ], truncated: false))))
            default: nil
            }
        }
        let folder = FolderModel(path: "/etc", requests: machine.requests)
        await folder.load()
        #expect(
            folder.phase
                == .failed(
                    WorkspaceProblem(
                        message: "That's outside the folders this Mac shares with Broski.",
                        detail: "/etc is outside the served folders", code: .forbidden)))

        let branches = BranchesModel(cwd: "/w", requests: machine.requests)
        await branches.load()
        #expect(branches.local.map(\.name) == ["main"])
        await branches.checkout(try #require(branches.remote.first))
        #expect(machine.checkouts == ["feature/x"], "a remote branch is checked out by its name without the remote")
        #expect(branches.problem?.message == "Your Mac didn't do that.")
        #expect(branches.problem?.detail == gitWords)
        #expect(branches.switchCount == 0)
    }

    @Test func aRequestThatGotNoAnswerSaysSoWithoutACode() async {
        let machine = ScriptedMachine { _ in throw ClientError.Timeout }
        let folder = FolderModel(path: "/w", requests: machine.requests)
        await folder.load()
        guard case .failed(let problem) = folder.phase else {
            Issue.record("expected a failure")
            return
        }
        #expect(problem.message == "Your Mac didn't answer in time. Try again.")
        #expect(problem.code == nil)
    }

    @Test func gitListsComeFromTheStatusStagedFirstAndEmptyOnesLeftOut() {
        let status = GitStatusRead(
            root: "/w", branch: "main", head: "abc", upstream: GitUpstream(name: "origin/main", ahead: 2, behind: 0),
            staged: [GitFileChange(path: "a.swift", previousPath: nil, change: .modified, additions: 3, deletions: 1)],
            unstaged: [],
            untracked: ["new.txt"], truncated: false)
        let sections = GitSection.sections(status)
        #expect(sections.map(\.area) == [.staged, .untracked])
        #expect(sections[0].rows[0].additions == 3 && sections[0].rows[0].change == .modified)
        #expect(sections[1].rows[0].change == nil && sections[1].rows[0].path == "new.txt")
        #expect(status.upstream?.summary == "2 ahead origin/main")
        #expect(GitUpstream(name: "origin/main", ahead: 0, behind: 0).summary == "Up to date with origin/main")
    }

    @Test func stagingReadsTheStatusAgainAndACommitClearsTheMessage() async {
        let machine = ScriptedMachine.repository()
        let git = GitModel(cwd: "/w/src", requests: machine.requests)
        await git.load()
        #expect(git.sections.map(\.area) == [.unstaged])
        #expect(!git.canCommit)

        await git.stage(["notes.md"])
        #expect(git.sections.map(\.area) == [.staged])
        git.message = "  Update the notes \n"
        #expect(git.canCommit)
        await git.commit()
        #expect(machine.commits == ["Update the notes"])
        #expect(git.message.isEmpty && git.commitCount == 1)
        #expect(git.sections.isEmpty)
        #expect(git.commits.map(\.subject) == ["Update the notes"])
    }

    @Test func aFolderInNoRepositoryIsSaidAsSuchNotAsAFailure() async {
        let machine = ScriptedMachine { message in
            guard case .gitStatus(let request) = message else { return nil }
            return .gitStatusResult(
                GitStatusResponse(
                    requestId: request.requestId,
                    result: .rejected(Rejected(rejection: Rejection(code: .notFound, message: "/tmp is not inside a git work tree"))))
            )
        }
        let git = GitModel(cwd: "/tmp", requests: machine.requests)
        await git.load()
        guard case .notRepository = git.phase else {
            Issue.record("expected not a repository, got \(git.phase)")
            return
        }
    }

    @Test func aReadIsTextAnImageOrBinaryAndATruncatedTextSaysHowMuchItShows() throws {
        let text = FileContent(FileRead(path: "/w/a", encoding: .utf8, content: "one\ntwo\n", offset: 0, length: 8, size: 20, truncated: true))
        guard case .text(let file) = text else { throw Expectation.failed }
        #expect(file.lines == ["one", "two"])
        #expect(file.truncated && file.shown == 8 && file.size == 20)

        let png = Fixture.png.base64EncodedString()
        guard case .image = FileContent(FileRead(path: "/w/i.png", encoding: .base64, content: png, offset: 0, length: 70, size: 70, truncated: false)) else {
            throw Expectation.failed
        }
        guard case .binary(let size) = FileContent(FileRead(path: "/w/b", encoding: .base64, content: "AAEC", offset: 0, length: 3, size: 3, truncated: false)) else {
            throw Expectation.failed
        }
        #expect(size == 3)
    }

    @Test func aFolderFromAnotherScreenOpensOnItsMachineInPlaceOfWhatWasShown() {
        let navigation = WorkspaceNavigation()
        navigation.path = [.machines]
        navigation.open(FolderTarget(machineId: "m2", path: "/w/src"))
        #expect(navigation.machineId == "m2")
        #expect(navigation.path == [.workspace(machineId: "m2", place: .folder("/w/src"))])

        navigation.choose("m1")
        #expect(navigation.path.isEmpty, "another machine starts at its folders")
    }
}

enum Expectation: Error {
    case failed
}
