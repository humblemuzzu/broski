import BroskiCore
import Foundation

/// One machine's files, git and terminals (contract §20), each request answered with its accepted
/// value or a `WorkspaceProblem`. The core mints the request ids, so every request goes out with
/// an empty one.
struct WorkspaceRequests {
    let send: (ClientMessage) async throws -> ServerMessage

    init(machine: Machine) {
        send = { try await machine.request(message: $0) }
    }

    init(send: @escaping (ClientMessage) async throws -> ServerMessage) {
        self.send = send
    }

    func info() async throws(WorkspaceProblem) -> WorkspaceInfo {
        try await ask(.workspaceInfo(WorkspaceInfoRequest(requestId: ""))) { (answer) -> WorkspaceInfoResult? in
            if case .workspaceInfoResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func list(path: String, cursor: String?, hidden: Bool) async throws(WorkspaceProblem) -> FilesListed {
        let request = FsListRequest(requestId: "", path: path, cursor: cursor, limit: nil, hidden: hidden)
        return try await ask(.fsList(request)) { (answer) -> FsListResult? in
            if case .fsListResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func read(path: String) async throws(WorkspaceProblem) -> FileRead {
        try await ask(.fsRead(FsReadRequest(requestId: "", path: path, offset: nil, length: nil))) {
            (answer) -> FsReadResult? in
            if case .fsReadResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func image(path: String, variant: ImageVariant = .full) async throws(WorkspaceProblem) -> FileImageRead {
        try await ask(.fsImage(FsImageRequest(requestId: "", path: path, variant: variant))) {
            (answer) -> FsImageResult? in
            if case .fsImageResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func search(root: String, query: String, limit: Int64? = nil) async throws(WorkspaceProblem) -> FilesFound {
        try await ask(.fsSearch(FsSearchRequest(requestId: "", root: root, query: query, limit: limit))) {
            (answer) -> FsSearchResult? in
            if case .fsSearchResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func status(cwd: String) async throws(WorkspaceProblem) -> GitStatusRead {
        try await ask(.gitStatus(GitStatusRequest(requestId: "", cwd: cwd))) { (answer) -> GitStatusResult? in
            if case .gitStatusResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func diff(cwd: String, path: String, staged: Bool) async throws(WorkspaceProblem) -> GitDiffRead {
        try await ask(.gitDiff(GitDiffRequest(requestId: "", cwd: cwd, path: path, staged: staged))) {
            (answer) -> GitDiffResult? in
            if case .gitDiffResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func stage(cwd: String, paths: [String]) async throws(WorkspaceProblem) {
        _ = try await ask(.gitStage(GitStageRequest(requestId: "", cwd: cwd, paths: paths))) {
            (answer) -> ActionResult? in
            if case .gitStageResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func unstage(cwd: String, paths: [String]) async throws(WorkspaceProblem) {
        _ = try await ask(.gitUnstage(GitUnstageRequest(requestId: "", cwd: cwd, paths: paths))) {
            (answer) -> ActionResult? in
            if case .gitUnstageResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func commit(cwd: String, message: String) async throws(WorkspaceProblem) -> GitCommit {
        try await ask(.gitCommit(GitCommitRequest(requestId: "", cwd: cwd, message: message))) {
            (answer) -> GitCommitResult? in
            if case .gitCommitResult(let answer) = answer { answer.result } else { nil }
        }.commit
    }

    func branches(cwd: String) async throws(WorkspaceProblem) -> GitBranchesListed {
        try await ask(.gitBranches(GitBranchesRequest(requestId: "", cwd: cwd))) { (answer) -> GitBranchesResult? in
            if case .gitBranchesResult(let answer) = answer { answer.result } else { nil }
        }
    }

    func checkout(cwd: String, branch: String) async throws(WorkspaceProblem) -> String {
        try await ask(.gitCheckout(GitCheckoutRequest(requestId: "", cwd: cwd, branch: branch))) {
            (answer) -> GitCheckoutResult? in
            if case .gitCheckoutResult(let answer) = answer { answer.result } else { nil }
        }.branch
    }

    func log(cwd: String, limit: Int64) async throws(WorkspaceProblem) -> [GitCommit] {
        try await ask(.gitLog(GitLogRequest(requestId: "", cwd: cwd, limit: limit))) { (answer) -> GitLogResult? in
            if case .gitLogResult(let answer) = answer { answer.result } else { nil }
        }.commits
    }

    func terminals() async throws(WorkspaceProblem) -> [TerminalSummary] {
        try await ask(.termList(TermListRequest(requestId: ""))) { (answer) -> TermListResult? in
            if case .termListResult(let answer) = answer { answer.result } else { nil }
        }.terminals
    }

    func openTerminal(cwd: String, size: TerminalGrid) async throws(WorkspaceProblem) -> TerminalSummary {
        let request = TermOpenRequest(
            requestId: "", cwd: cwd, cols: size.cols, rows: size.rows, cellWidth: size.cellWidth,
            cellHeight: size.cellHeight)
        return try await ask(.termOpen(request)) { (answer) -> TermOpenResult? in
            if case .termOpenResult(let answer) = answer { answer.result } else { nil }
        }.terminal
    }

    func closeTerminal(id: String) async throws(WorkspaceProblem) {
        _ = try await ask(.termClose(TermCloseRequest(requestId: "", id: id))) { (answer) -> ActionResult? in
            if case .termCloseResult(let answer) = answer { answer.result } else { nil }
        }
    }

    private func ask<Answer: WorkspaceResult>(
        _ message: ClientMessage, _ result: (ServerMessage) -> Answer?
    ) async throws(WorkspaceProblem) -> Answer.Accepted {
        let answer: ServerMessage
        do {
            answer = try await send(message)
        } catch {
            throw WorkspaceProblem(error)
        }
        guard let result = result(answer) else {
            throw WorkspaceProblem(message: "Your Mac answered something Broski didn't expect.", detail: "\(answer)")
        }
        return try result.accepted
    }
}

/// A terminal's size in cells and, once the emulator knows them, its cell's pixels.
nonisolated struct TerminalGrid: Equatable, Sendable {
    var cols: Int64
    var rows: Int64
    var cellWidth: Int64?
    var cellHeight: Int64?

    static let standard = TerminalGrid(cols: 80, rows: 24)
}

/// A workspace result union: its accepted value, or the rejection every union shares.
protocol WorkspaceResult {
    associatedtype Accepted
    var accepted: Accepted { get throws(WorkspaceProblem) }
}

extension WorkspaceInfoResult: WorkspaceResult {
    var accepted: WorkspaceInfo {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension FsListResult: WorkspaceResult {
    var accepted: FilesListed {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension FsReadResult: WorkspaceResult {
    var accepted: FileRead {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension FsImageResult: WorkspaceResult {
    var accepted: FileImageRead {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension FsSearchResult: WorkspaceResult {
    var accepted: FilesFound {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitStatusResult: WorkspaceResult {
    var accepted: GitStatusRead {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitDiffResult: WorkspaceResult {
    var accepted: GitDiffRead {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitCommitResult: WorkspaceResult {
    var accepted: GitCommitted {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitBranchesResult: WorkspaceResult {
    var accepted: GitBranchesListed {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitCheckoutResult: WorkspaceResult {
    var accepted: GitCheckedOut {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension GitLogResult: WorkspaceResult {
    var accepted: GitLogRead {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension TermListResult: WorkspaceResult {
    var accepted: TerminalsListed {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension TermOpenResult: WorkspaceResult {
    var accepted: TerminalOpened {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}

extension ActionResult: WorkspaceResult {
    var accepted: ActionAccepted {
        get throws(WorkspaceProblem) {
            switch self {
            case .accepted(let value): value
            case .rejected(let rejected): throw WorkspaceProblem(rejected.rejection)
            }
        }
    }
}
