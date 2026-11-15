import BroskiCore
import Foundation
import GhosttyTerminal
import Observation

/// One terminal on a machine, opened here or attached from the list: the emulator, the pump that
/// feeds it the terminal's output, and the outbox that carries keystrokes and resizes back. The
/// view is attached only while the screen shows and the app is in front; attaching again starts
/// from what the bridge still holds, as a reset.
@Observable
final class TerminalModel {
    enum Start: Hashable {
        case attach(String)
        case open(cwd: String)
    }

    enum Phase: Equatable {
        case opening
        case attached
        case detached
        case ended(TerminalEnd)
        case failed(WorkspaceProblem)
    }

    private(set) var phase: Phase = .opening
    /// A keystroke or resize the terminal refused.
    private(set) var problem: WorkspaceProblem?

    @ObservationIgnored let state = TerminalViewState()
    @ObservationIgnored private var id: String?
    @ObservationIgnored private let emulator: GhosttyScreen
    @ObservationIgnored private let start: Start
    @ObservationIgnored private let requests: WorkspaceRequests
    @ObservationIgnored private let attach: (String) throws -> any TerminalChannel
    @ObservationIgnored private var outbox: TerminalOutbox?
    @ObservationIgnored private var pump: Task<Void, Never>?
    @ObservationIgnored private var forwarding: Task<Void, Never>?
    @ObservationIgnored private var grid: TerminalGrid?
    @ObservationIgnored private var isOpening = false
    /// Counts attaches, so the end of a pump that was let go is not taken for the current one's.
    @ObservationIgnored private var attachment = 0

    init(
        start: Start, requests: WorkspaceRequests, fontSize: Float?,
        attach: @escaping (String) throws -> any TerminalChannel
    ) {
        self.start = start
        self.requests = requests
        self.attach = attach
        if case .attach(let id) = start { self.id = id }
        let (items, sink) = AsyncStream.makeStream(of: TerminalOutgoing.self)
        let session = InMemoryTerminalSession(
            write: { sink.yield(.input($0)) },
            resize: { sink.yield(.resize(TerminalGrid($0))) })
        emulator = GhosttyScreen(session: session)
        state.configuration = TerminalSurfaceOptions(backend: .inMemory(session), fontSize: fontSize)
        state.inputAccessoryItems = []
        forwarding = Task { [weak self] in
            for await item in items { self?.forward(item) }
        }
    }

    isolated deinit {
        forwarding?.cancel()
        pump?.cancel()
    }

    /// Opens the terminal when this screen made it, then attaches; a call while attached or
    /// opening does nothing.
    func show() async {
        guard pump == nil, !isOpening else { return }
        if id == nil, case .open(let cwd) = start {
            isOpening = true
            defer { isOpening = false }
            phase = .opening
            do throws(WorkspaceProblem) {
                id = try await requests.openTerminal(cwd: cwd, size: grid ?? .standard).id
            } catch {
                phase = .failed(error)
                return
            }
        }
        connect()
    }

    /// Lets go of the view: the screen went away or the app went to the background.
    func hide() {
        pump?.cancel()
        pump = nil
        outbox = nil
        if phase == .attached { phase = .detached }
    }

    private func connect() {
        guard let id, pump == nil else { return }
        let channel: any TerminalChannel
        do {
            channel = try attach(id)
        } catch {
            phase = .failed(WorkspaceProblem(error))
            return
        }
        let outbox = TerminalOutbox(channel: channel) { [weak self] in self?.problem = $0 }
        self.outbox = outbox
        if let grid { outbox.send(.resize(grid)) }
        phase = .attached
        problem = nil
        attachment += 1
        pump = Task { [weak self, emulator, attachment] in
            let end = await TerminalPump.run(channel, into: emulator)
            self?.ended(end, attachment: attachment)
        }
    }

    /// A view another view of this terminal replaced is `detached`; one this screen let go of is
    /// already forgotten.
    private func ended(_ end: TerminalEnd, attachment: Int) {
        guard attachment == self.attachment, pump != nil else { return }
        pump = nil
        outbox = nil
        phase = end == .detached ? .detached : .ended(end)
    }

    private func forward(_ item: TerminalOutgoing) {
        if case .resize(let grid) = item { self.grid = grid }
        outbox?.send(item)
    }
}

/// The emulator a terminal's output is drawn into.
final class GhosttyScreen: TerminalDisplay {
    private let session: InMemoryTerminalSession

    init(session: InMemoryTerminalSession) {
        self.session = session
    }

    /// A reset drops whatever the emulator has not parsed yet and replays the new start behind
    /// RIS (ESC c), which in Ghostty clears the screen and its scrollback. Replayed output had its
    /// queries answered when it was live, so it goes through the replay entry, which answers none.
    func show(_ data: Data, reset: Bool) {
        if reset {
            session.discardPendingOutput()
            session.receiveReplay(Data([0x1B, 0x63]) + data)
        } else {
            session.receive(data)
        }
    }
}

extension TerminalGrid {
    /// The emulator's grid in the contract's bounds (1–500 each); a cell size it has not measured
    /// yet is left out.
    nonisolated init(_ viewport: InMemoryTerminalViewport) {
        func bounded(_ value: some BinaryInteger) -> Int64 { min(max(Int64(value), 1), 500) }
        func measured(_ value: UInt32) -> Int64? { value == 0 ? nil : bounded(value) }
        self.init(
            cols: bounded(viewport.columns), rows: bounded(viewport.rows),
            cellWidth: measured(viewport.cellWidthPixels), cellHeight: measured(viewport.cellHeightPixels))
    }
}
