import BroskiCore
import Foundation
import Testing

/// Swift calling the real Rust core through the generated bindings and the XCFramework, with no
/// machine to talk to, over the fixtures `packages/link/mobile/tests/facade.rs` describes: a
/// daemon-written QR offer, the stored record and device secret of that pairing (whose one route,
/// 127.0.0.1:9, refuses connections), and the push vectors `push.md` pins.
private let fixtures = repository.appending(path: "packages/link/mobile/tests/fixtures")

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appending(path: name))
}

private func text(_ name: String) throws -> String {
    String(decoding: try fixture(name), as: UTF8.self)
}

/// The phone of the fixtures' pairing, and its machine started from the stored record.
private func storedMachine() throws -> (Phone, Machine) {
    let phone = try Phone(identitySecret: try fixture("device-secret.bin"), config: config)
    let machine = try phone.start(record: try MachineRecord.fromBytes(bytes: try fixture("record.json")))
    return (phone, machine)
}

private let session = SessionRef(backend: "pi", sessionId: "s-1")

@Test func aNewSecretMakesAPhoneAndABrokenOneIsRefused() throws {
    let secret = try newIdentitySecret()
    let phone = try Phone(identitySecret: secret, config: config)
    #expect(phone.deviceId().count == 32)
    #expect(try Phone(identitySecret: secret, config: config).deviceId() == phone.deviceId())
    #expect {
        try Phone(identitySecret: secret.dropFirst(), config: config)
    } throws: { error in
        if case ClientError.Link(failure: .identity, _) = error { true } else { false }
    }
}

@Test func theOfferNamesTheMachineTheStoredRecordWasPairedWith() throws {
    let offer = try parsePairingOffer(uri: try text("offer.txt"))
    let record = try MachineRecord.fromBytes(bytes: try fixture("record.json"))
    #expect(offer.machineId == record.id())
    #expect(offer.name == "Studio Mac")
    let hex = Array(record.id().prefix(16).uppercased())
    let groups = stride(from: 0, to: 16, by: 4).map { String(hex[$0..<$0 + 4]) }
    #expect(offer.verificationCode == groups.joined(separator: " "))
    #expect(offer.expiresAt == 4_102_444_800)
    #expect(record.os() == "macos")
    #expect(record.toBytes() == (try fixture("record.json")))
}

@Test func aPairingWithAnUnreachableMachineSaysWhy() async throws {
    let phone = try Phone(identitySecret: try fixture("device-secret.bin"), config: config)
    await #expect {
        try await phone.pair(offer: try text("offer.txt"))
    } throws: { error in
        if case ClientError.Link(failure: .machineUnreachable, _) = error { true } else { false }
    }
}

@Test(.timeLimit(.minutes(1)))
func aStoredMachineRetriesItsDialHoldsItsViewAndEndsWhenForgotten() async throws {
    let (phone, machine) = try storedMachine()
    #expect(phone.allMachines().map { $0.id() } == [machine.id()])
    try await events(of: machine) { $0.link.state == .waiting(.retry) }
    #expect(machine.status().contract == .waiting)

    let view = try machine.attach(session: session)
    #expect(view.session() == session)
    #expect(view.snapshot() == nil)
    let hello = ClientMessage.hello(
        HelloRequest(
            requestId: "", protocol: ProtocolVersion(major: 1, minor: 0),
            client: ClientInfo(name: "broski-ios", version: "1.0.0")))
    await #expect {
        try await machine.request(message: hello)
    } throws: { error in
        if case ClientError.InvalidRequest = error { true } else { false }
    }

    phone.forget(id: machine.id())
    #expect(phone.machine(id: machine.id()) == nil)
    while await machine.nextEvent() != nil {}
    #expect(machine.status().link.state == .closed)
    #expect(await view.nextUpdate() == .ended(reason: .closed))
    #expect(await view.nextUpdate() == nil)
}

/// UniFFI 0.32.2's Swift bindings do not cancel a Rust call when its task is cancelled
/// (`withUnsafeContinuation`, no cancellation handler): the pull goes on, and what it takes reaches
/// the task, so cancelling loses nothing.
@Test(.timeLimit(.minutes(1)))
func aPullOutlivesItsCancelledTaskAndDeliversWhatComesNext() async throws {
    let (phone, machine) = try storedMachine()
    let view = try machine.attach(session: session)
    let pull = Task { await view.nextUpdate() }
    pull.cancel()
    try await Task.sleep(for: .milliseconds(200))
    phone.forget(id: machine.id())
    #expect(await pull.value == .ended(reason: .closed))
    #expect(await view.nextUpdate() == nil)
}

/// The loop a SwiftUI `.task` runs: cancelling it detaches the view, which ends the pull in progress.
@Test(.timeLimit(.minutes(1)))
func cancellingAViewsLoopDetachesTheViewAndEndsItsPull() async throws {
    let (_, machine) = try storedMachine()
    let view = try machine.attach(session: session)
    let loop = Task {
        await withTaskCancellationHandler {
            var updates: [SessionUpdate] = []
            while let update = await view.nextUpdate() {
                updates.append(update)
            }
            return updates
        } onCancel: {
            view.detach()
        }
    }
    try await Task.sleep(for: .milliseconds(200))
    loop.cancel()
    #expect(await loop.value.isEmpty, "never attached, so nothing to apply")
    #expect(view.session() == nil, "the view is gone")
}

@Test func whatWasSeenGoesBackInAsTheAppStoredIt() throws {
    let inbox = try Phone(identitySecret: try newIdentitySecret(), config: config).inbox()
    #expect(inbox.rows().isEmpty)
    let machineId = "00112233445566778899aabbccddeeff"
    let stored = SeenState(
        markers: [
            SeenMarker(
                machineId: machineId,
                session: SessionRef(backend: "claude-code", sessionId: "s-9"),
                seenAt: 1_725_000_000_000)
        ],
        readMachines: [machineId, "ffeeddccbbaa99887766554433221100"],
        unread: [UnreadSession(machineId: machineId, session: SessionRef(backend: "pi", sessionId: "s-10"))])
    inbox.restoreSeen(state: stored)
    #expect(inbox.seen() == stored)
}

/// The fixtures' cache holds `s-old`, idle since 2024: marked unread it is done, through a restart,
/// until it is seen.
@Test func anOldSessionMarkedUnreadIsDoneAfterARestartUntilItIsSeen() throws {
    let old = SessionRef(backend: "pi", sessionId: "s-old")
    func started(_ seen: SeenState?) throws -> (Phone, Inbox, Machine) {
        let phone = try Phone(identitySecret: try fixture("device-secret.bin"), config: config)
        let inbox = phone.inbox()
        if let seen { inbox.restoreSeen(state: seen) }
        try inbox.restoreCache(cache: try fixture("inbox-cache.json"))
        let machine = try phone.start(record: try MachineRecord.fromBytes(bytes: try fixture("record.json")))
        return (phone, inbox, machine)
    }
    func shown(_ inbox: Inbox) -> [String: InboxState] {
        Dictionary(uniqueKeysWithValues: inbox.rows().map { ($0.session.sessionId, $0.state) })
    }
    let (first, inbox, machine) = try started(nil)
    #expect(shown(inbox) == ["s-ask": .needsYou, "s-old": .idle])
    inbox.markUnread(machineId: machine.id(), session: old)
    #expect(shown(inbox) == ["s-ask": .needsYou, "s-old": .done])
    let stored = inbox.seen()
    #expect(stored.unread == [UnreadSession(machineId: machine.id(), session: old)])
    first.forget(id: machine.id())

    let (phone, restarted, again) = try started(stored)
    #expect(shown(restarted) == ["s-ask": .needsYou, "s-old": .done])
    restarted.markSeen(machineId: again.id(), session: old)
    #expect(shown(restarted) == ["s-ask": .needsYou, "s-old": .idle])
    #expect(restarted.seen().unread.isEmpty)
    phone.forget(id: again.id())
}

@Test func thePinnedPushOpensAndADecisionSealsForTheRelay() throws {
    let record = try MachineRecord.fromBytes(bytes: try fixture("push-record.json"))
    let push = try openNotification(record: record, data: try text("push.txt"))
    #expect(push.kind == "approval")
    #expect(push.title == "Approve Bash")
    #expect(push.request == "req-1")
    #expect {
        try openNotification(record: record, data: "AAAA")
    } throws: { error in
        if case ClientError.Link(failure: .push, _) = error { true } else { false }
    }

    let letter = try decisionLetter(
        record: record, decision: .deny, backend: "pi", session: "s-2", request: nil)
    #expect(letter.url == "https://relay.example/v1/letters")
    let headers = Dictionary(uniqueKeysWithValues: letter.headers.map { ($0.name, $0.value) })
    #expect(headers["x-broski-machine"] == "00112233445566778899aabbccddeeff")
    #expect(headers["authorization"] == "Bearer token")
    #expect(letter.body.count > 12 + 16)
}
