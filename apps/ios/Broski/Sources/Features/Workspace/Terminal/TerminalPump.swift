import BroskiCore
import Foundation

/// What a terminal screen needs of the core's `TerminalView`.
nonisolated protocol TerminalChannel: AnyObject, Sendable {
    func nextUpdate() async -> TerminalUpdate?
    func input(data: Data) async throws -> ActionResult
    func resize(cols: Int64, rows: Int64, cellWidth: Int64?, cellHeight: Int64?) async throws -> ActionResult
    func detach()
}

extension TerminalView: TerminalChannel {}

/// Where a terminal's output is drawn: the emulator.
protocol TerminalDisplay: AnyObject {
    /// Bytes that follow the previous ones, or, with `reset`, a new start: the emulator is cleared
    /// before it writes them.
    func show(_ data: Data, reset: Bool)
}

/// How a terminal view ended.
enum TerminalEnd: Equatable {
    case exited(code: Int64?, signal: String?)
    case failed(String)
    /// The view was detached, by this screen or by another view of the same terminal.
    case detached
}

enum TerminalPump {
    /// Writes every output of `channel` to `screen` until the view ends. Cancelling the calling
    /// task detaches the view, which is what ends the pull (mobile-packaging.md §1).
    static func run(_ channel: some TerminalChannel, into screen: some TerminalDisplay) async -> TerminalEnd {
        await withTaskCancellationHandler {
            while let update = await channel.nextUpdate() {
                switch update {
                case .output(let data, let reset):
                    screen.show(data, reset: reset)
                case .exited(let code, let signal):
                    return .exited(code: code, signal: signal)
                case .failed(let message):
                    return .failed(message)
                }
            }
            return .detached
        } onCancel: {
            channel.detach()
        }
    }
}

/// A keystroke's bytes or a new size, handed over by the emulator on whichever thread it runs.
nonisolated enum TerminalOutgoing: Equatable, Sendable {
    case input(Data)
    case resize(TerminalGrid)
}

/// Keystrokes and resizes on their way to the terminal, sent one request at a time in the order
/// they came (contract §20.2). While a request is out, keystrokes that follow join into one input
/// and a newer size replaces an older one waiting behind it.
final class TerminalOutbox {
    private let channel: any TerminalChannel
    private let refused: (WorkspaceProblem) -> Void
    private var pending: [TerminalOutgoing] = []
    private var isSending = false

    init(channel: any TerminalChannel, refused: @escaping (WorkspaceProblem) -> Void) {
        self.channel = channel
        self.refused = refused
    }

    func send(_ item: TerminalOutgoing) {
        switch (pending.last, item) {
        case (.input(let waiting)?, .input(let more)):
            pending[pending.count - 1] = .input(waiting + more)
        case (.resize?, .resize):
            pending[pending.count - 1] = item
        default:
            pending.append(item)
        }
        guard !isSending else { return }
        isSending = true
        Task { await drain() }
    }

    private func drain() async {
        while !pending.isEmpty {
            let item = pending.removeFirst()
            do {
                let result: ActionResult
                switch item {
                case .input(let data):
                    result = try await channel.input(data: data)
                case .resize(let grid):
                    result = try await channel.resize(
                        cols: grid.cols, rows: grid.rows, cellWidth: grid.cellWidth, cellHeight: grid.cellHeight)
                }
                if case .rejected(let rejected) = result { refused(WorkspaceProblem(rejected.rejection)) }
            } catch {
                refused(WorkspaceProblem(error))
            }
        }
        isSending = false
    }
}
