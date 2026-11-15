import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The chat's session state against a real session view: a phone of the test's own pairs with a
/// `test-machine` that `scripts/e2e-ios-app.sh` starts for this test alone, and for each fake
/// scenario a new session runs it while every update goes through `SessionState.apply`. After every
/// update the state either equals `SessionView.snapshot()` or the stream already holds what makes it
/// equal (the view's snapshot is the stream's newest, a batch may be behind it), so the pull goes on;
/// each scenario only moves on, and only ends, at an update after which the two are equal. A state
/// that drifts never becomes equal again, and the time limit fails the test.
@Suite
struct SessionMachineTests {
    @Test(.enabled(if: ReplicaMachine.fromEnvironment != nil, "run by scripts/e2e-ios-app.sh"), .timeLimit(.minutes(5)))
    func everyUpdateOfRealRunsLeavesTheChatsStateEqualToTheView() async throws {
        let setup = try #require(ReplicaMachine.fromEnvironment)
        let phone = try Phone(
            identitySecret: try newIdentitySecret(),
            config: PhoneConfig(deviceName: "Replica", platform: .ios, clientName: "Broski tests", clientVersion: "0"))
        let machine = try await phone.pair(offer: setup.offer)
        while !machine.status().isReady {
            guard await machine.nextEvent() != nil else { throw ReplicaFailure.machineEnded }
        }
        let player = ScenarioPlayer(machine: machine, setup: setup)
        var totals: [String: (updates: Int, equal: Int)] = [:]
        for scenario in ["work", "permission", "ask", "hold", "replace"] {
            totals[scenario] = try await player.play(scenario)
        }
        for (scenario, total) in totals.sorted(by: { $0.key < $1.key }) {
            #expect(total.updates > 2, "\(scenario) streamed as records")
            print("replica \(scenario): \(total.updates) updates, equal to the view after \(total.equal)")
        }
        phone.forget(id: machine.id())
    }
}

/// The test machine the script started for this test: its offer, its served root, the file it reads
/// commands from and the file it answers in.
nonisolated struct ReplicaMachine: Sendable {
    let offer: String
    let root: String
    let commands: URL
    let output: URL

    static var fromEnvironment: ReplicaMachine? {
        let environment = ProcessInfo.processInfo.environment
        guard let offer = environment["BROSKI_REPLICA_OFFER"], let root = environment["BROSKI_REPLICA_ROOT"],
            let commands = environment["BROSKI_REPLICA_COMMANDS"], let output = environment["BROSKI_REPLICA_OUTPUT"]
        else { return nil }
        return ReplicaMachine(offer: offer, root: root, commands: URL(fileURLWithPath: commands), output: URL(fileURLWithPath: output))
    }
}

private enum ReplicaFailure: Error {
    case machineEnded
    case viewEnded
    case unexpected(ServerMessage)
}

private extension MachineStatus {
    var isReady: Bool { if case .ready = contract { true } else { false } }
}

/// Plays one fake scenario in a session of its own and follows its view to the end.
private struct ScenarioPlayer {
    let machine: BroskiCore.Machine
    let setup: ReplicaMachine

    func play(_ scenario: String) async throws -> (updates: Int, equal: Int) {
        let requests = ChatRequests(machine: machine)
        let session = try await requests.create(.pi, NewSessionOptions(cwd: setup.root, modelId: nil, thinking: nil, modes: nil))
        let view = try machine.attach(session: session)
        defer { view.detach() }
        var follower = Follower(view: view)
        try await follower.follow { $0.session != nil }
        try await command(["script": wire(session), "scenario": .string(scenario)], answered: "scripted")
        let input = ComposerDraft(text: "Play \(scenario)").input(mode: .start)
        _ = try await requests.prompt(session, input)
        try await respond(to: scenario, session: session, follower: &follower, requests: requests)
        try await follower.follow { $0.snapshot.run == nil && $0.snapshot.lastOutcome != nil }
        return (follower.updates, follower.equal)
    }

    private func respond(to scenario: String, session: SessionRef, follower: inout Follower, requests: ChatRequests) async throws {
        switch scenario {
        case "permission":
            try await follower.follow { !$0.snapshot.interactions.isEmpty }
            let ask = follower.state.snapshot.interactions[0]
            try await requests.answer(session, InteractionAnswer(interactionId: ask.id, reply: .toolPermission(
                ToolPermissionReply(optionId: "allow_once", message: nil, editedInput: nil, grantIds: []))))
        case "ask":
            try await follower.follow { !$0.snapshot.interactions.isEmpty }
            let ask = follower.state.snapshot.interactions[0]
            try await requests.answer(session, InteractionAnswer(interactionId: ask.id, reply: .choice(ChoiceReply(value: "retry"))))
        case "hold", "replace":
            try await follower.follow { $0.snapshot.run?.items.contains { if case .block = $0 { true } else { false } } == true }
            try await command(["release": wire(session)], answered: "released")
            if scenario == "replace" {
                try await follower.follow { $0.session != session }
            }
        default:
            break
        }
    }

    private func wire(_ session: SessionRef) -> JSONValue {
        .object(["backend": .string(session.backend.wireName), "sessionId": .string(session.sessionId)])
    }

    /// Appends a command to the machine's file and waits for its answer line.
    private func command(_ json: [String: JSONValue], answered key: String) async throws {
        let before = try lines(containing: key)
        let handle = try FileHandle(forWritingTo: setup.commands)
        try handle.seekToEnd()
        try handle.write(contentsOf: try JSONEncoder().encode(JSONValue.object(json)) + Data("\n".utf8))
        try handle.close()
        while try lines(containing: key) <= before {
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    private func lines(containing key: String) throws -> Int {
        try String(contentsOf: setup.output, encoding: .utf8).split(separator: "\n").count { $0.contains("\"\(key)\"") }
    }
}

/// The chat's state over one view, and how often it equalled the view's snapshot.
private struct Follower {
    let view: SessionView
    private(set) var state = SessionState()
    private(set) var updates = 0
    private(set) var equal = 0

    init(view: SessionView) {
        self.view = view
    }

    /// Pulls until `done` holds of a state equal to the view's snapshot.
    mutating func follow(until done: (SessionState) -> Bool) async throws {
        while true {
            guard let update = await view.nextUpdate() else { throw ReplicaFailure.viewEnded }
            _ = state.apply(update)
            updates += 1
            let matches = state.snapshot == view.snapshot()
            if matches { equal += 1 }
            if matches && done(state) { return }
        }
    }
}

/// Just enough JSON for the machine's commands.
private enum JSONValue: Encodable {
    case string(String)
    case object([String: JSONValue])

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let text): try container.encode(text)
        case .object(let members): try container.encode(members)
        }
    }
}
