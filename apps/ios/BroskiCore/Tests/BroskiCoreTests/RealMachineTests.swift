#if os(macOS)
import BroskiCore
import Foundation
import Testing

/// The real daemon and the real bridge on this Mac: `packages/link/testkit`'s `test-machine`, run
/// with cargo, serving until its stdin closes. It needs cargo, Bun, and `bun install` in
/// `packages/bridge`, as `cargo test -p broski-client` does.
private final class TestMachine {
    let offer: String
    let root: String
    private let process = Process()
    private let input = Pipe()

    private struct Ready: Decodable {
        let offer: String
        let root: String
    }

    struct Exited: Error {}

    init() async throws {
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "cargo", "run", "--quiet", "--locked", "-p", "broski-link-testkit", "--bin", "test-machine",
        ]
        process.currentDirectoryURL = repository.appending(path: "packages/link")
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        for try await line in output.fileHandleForReading.bytes.lines {
            if let ready = try? JSONDecoder().decode(Ready.self, from: Data(line.utf8)) {
                offer = ready.offer
                root = ready.root
                return
            }
        }
        throw Exited()
    }

    func stop() {
        try? input.fileHandleForWriting.close()
        process.waitUntilExit()
    }
}

private func createSession(_ machine: Machine, cwd: String) async throws -> SessionRef {
    let options = NewSessionOptions(cwd: cwd, modelId: nil, thinking: nil, modes: nil)
    let create = ClientMessage.sessionCreate(
        SessionCreateRequest(requestId: "", backend: "pi", options: options))
    let answer = try await machine.request(message: create)
    guard case .sessionCreateResult(let created) = answer, case .accepted(let accepted) = created.result
    else { throw UnexpectedAnswer(answer: answer) }
    return accepted.session
}

private func prompt(_ machine: Machine, _ session: SessionRef, _ text: String) async throws {
    let input = PromptInput(
        clientRequestId: UUID().uuidString.lowercased(), mode: .start, text: text, attachments: [],
        command: nil)
    let answer = try await machine.request(
        message: .prompt(PromptRequest(requestId: "", session: session, input: input)))
    guard case .promptResult(let prompted) = answer, case .accepted = prompted.result else {
        throw UnexpectedAnswer(answer: answer)
    }
}

private struct UnexpectedAnswer: Error {
    let answer: ServerMessage
}

/// Applies the view's updates as a UI does until its copy satisfies `done`.
private func updates(of view: SessionView, into ui: inout Replica, until done: (Replica) -> Bool)
    async throws
{
    while !done(ui) {
        ui.apply(try #require(await view.nextUpdate(), "the view goes on"))
    }
}

@Test(.timeLimit(.minutes(5)))
func anAppPairsWithARealMachineAndARunStreamsIntoItsView() async throws {
    let mac = try await TestMachine()
    defer { mac.stop() }
    let phone = try Phone(identitySecret: try newIdentitySecret(), config: config)
    let scanned = try parsePairingOffer(uri: mac.offer)
    let machine = try await phone.pair(offer: mac.offer)
    #expect(machine.id() == scanned.machineId)
    try await events(of: machine) {
        if case .ready = $0.contract { true } else { false }
    }
    #expect(try await machine.backends().map(\.id) == ["pi"])

    let session = try await createSession(machine, cwd: mac.root)
    let view = try machine.attach(session: session)
    var ui = Replica()
    try await updates(of: view, into: &ui) { $0.resets == 1 }
    try await prompt(machine, session, "Hello from Swift")
    try await updates(of: view, into: &ui) {
        $0.snapshot?.run == nil && $0.snapshot?.lastOutcome != nil
    }
    #expect(ui.resets == 1 && ui.batches > 0, "the run came as change records")
    #expect(ui.snapshot == view.snapshot())
    view.detach()
    #expect(await view.nextUpdate() == nil)

    phone.forget(id: machine.id())
    while await machine.nextEvent() != nil {}
}
#endif
