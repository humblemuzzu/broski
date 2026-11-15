import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The terminal's byte pump and outbox over a scripted channel standing in for the core's
/// `TerminalView`.
@Suite
struct TerminalTests {
    @Test func outputIsWrittenInOrderAndAResetStartsTheScreenOver() async {
        let channel = ScriptedTerminal(updates: [
            .output(data: Data("first".utf8), reset: true),
            .output(data: Data(" more".utf8), reset: false),
            .output(data: Data("newest".utf8), reset: true),
            .output(data: Data("!".utf8), reset: false),
            .exited(exitCode: 0, signal: nil),
        ])
        let screen = RecordingScreen()

        let end = await TerminalPump.run(channel, into: screen)

        #expect(end == .exited(code: 0, signal: nil))
        #expect(screen.text == "newest!", "a reset drops what was shown before it")
        #expect(screen.writes == [.reset("first"), .write(" more"), .reset("newest"), .write("!")])
        #expect(!channel.detached)
    }

    @Test func cancellingThePumpDetachesTheViewWhichEndsThePull() async {
        let channel = ScriptedTerminal(updates: [.output(data: Data("$ ".utf8), reset: true)], holdsAtEnd: true)
        let screen = RecordingScreen()
        let pump = Task { await TerminalPump.run(channel, into: screen) }
        while screen.writes.isEmpty { await Task.yield() }

        pump.cancel()

        #expect(await pump.value == .detached)
        #expect(channel.detached)
        #expect(screen.text == "$ ")
    }

    @Test func aFailedViewSaysWhy() async {
        let channel = ScriptedTerminal(updates: [.failed(message: "the terminal could not be attached")])
        #expect(await TerminalPump.run(channel, into: RecordingScreen()) == .failed("the terminal could not be attached"))
    }

    @Test func keystrokesGoInOrderOneRequestAtATimeJoinedWhileOneIsOut() async {
        let channel = ScriptedTerminal(updates: [], gated: true)
        var refusals: [WorkspaceProblem] = []
        let outbox = TerminalOutbox(channel: channel) { refusals.append($0) }

        outbox.send(.input(Data("e".utf8)))
        while channel.sent.isEmpty { await Task.yield() }
        outbox.send(.input(Data("ch".utf8)))
        outbox.send(.input(Data("o".utf8)))
        outbox.send(.resize(TerminalGrid(cols: 80, rows: 24)))
        outbox.send(.resize(TerminalGrid(cols: 100, rows: 30, cellWidth: 9, cellHeight: 18)))
        outbox.send(.input(Data("\r".utf8)))
        channel.openGate()
        while channel.sent.count < 4 { await Task.yield() }

        #expect(
            channel.sent == [
                .input(Data("e".utf8)), .input(Data("cho".utf8)),
                .resize(TerminalGrid(cols: 100, rows: 30, cellWidth: 9, cellHeight: 18)), .input(Data("\r".utf8)),
            ])
        #expect(refusals.isEmpty)
    }

    @Test func aKeystrokeTheTerminalRefusesIsSaid() async {
        let channel = ScriptedTerminal(updates: [], refuses: Rejection(code: .closed, message: "terminal \"t1\" has exited"))
        var refusals: [WorkspaceProblem] = []
        let outbox = TerminalOutbox(channel: channel) { refusals.append($0) }
        outbox.send(.input(Data("x".utf8)))
        while refusals.isEmpty { await Task.yield() }
        #expect(refusals.first?.message == "This terminal has ended.")
    }

}

/// A terminal view that hands over `updates`, then ends (or waits for `detach`), and records what
/// it was sent.
nonisolated final class ScriptedTerminal: TerminalChannel, @unchecked Sendable {
    private let lock = NSLock()
    private var updates: [TerminalUpdate]
    private let holdsAtEnd: Bool
    private let refuses: Rejection?
    private var gate: CheckedContinuation<Void, Never>?
    private var gated: Bool
    private var waiting: CheckedContinuation<TerminalUpdate?, Never>?
    private var isDetached = false
    private var received: [TerminalOutgoing] = []

    var detached: Bool { lock.withLock { isDetached } }
    var sent: [TerminalOutgoing] { lock.withLock { received } }

    init(updates: [TerminalUpdate], holdsAtEnd: Bool = false, gated: Bool = false, refuses: Rejection? = nil) {
        self.updates = updates
        self.holdsAtEnd = holdsAtEnd
        self.gated = gated
        self.refuses = refuses
    }

    func nextUpdate() async -> TerminalUpdate? {
        if let next = lock.withLock({ updates.isEmpty ? nil : updates.removeFirst() }) { return next }
        guard holdsAtEnd else { return nil }
        return await withCheckedContinuation { continuation in
            let ended = lock.withLock {
                if isDetached { return true }
                waiting = continuation
                return false
            }
            if ended { continuation.resume(returning: nil) }
        }
    }

    func input(data: Data) async throws -> ActionResult {
        try await record(.input(data))
    }

    func resize(cols: Int64, rows: Int64, cellWidth: Int64?, cellHeight: Int64?) async throws -> ActionResult {
        try await record(.resize(TerminalGrid(cols: cols, rows: rows, cellWidth: cellWidth, cellHeight: cellHeight)))
    }

    func detach() {
        let waiter = lock.withLock {
            isDetached = true
            defer { waiting = nil }
            return waiting
        }
        waiter?.resume(returning: nil)
    }

    func openGate() {
        let gate = lock.withLock {
            gated = false
            defer { self.gate = nil }
            return self.gate
        }
        gate?.resume()
    }

    private func record(_ item: TerminalOutgoing) async throws -> ActionResult {
        lock.withLock { received.append(item) }
        await withCheckedContinuation { continuation in
            let open = lock.withLock {
                if gated { gate = continuation }
                return !gated
            }
            if open { continuation.resume() }
        }
        if let refuses { return .rejected(Rejected(rejection: refuses)) }
        return .accepted(ActionAccepted())
    }
}

/// An emulator that keeps what it was told to show.
final class RecordingScreen: TerminalDisplay {
    enum Write: Equatable {
        case reset(String)
        case write(String)
    }

    private(set) var writes: [Write] = []
    private(set) var text = ""

    func show(_ data: Data, reset: Bool) {
        let chunk = String(decoding: data, as: UTF8.self)
        writes.append(reset ? .reset(chunk) : .write(chunk))
        text = reset ? chunk : text + chunk
    }
}
