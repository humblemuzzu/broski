import BroskiCore
import Foundation
import Testing

/// Swift calling the real Rust core through the generated bindings and the XCFramework, over the
/// fixtures `packages/link/mobile/tests/facade.rs` describes: a daemon-written QR offer, the stored
/// record and device secret of that pairing (whose one route, 127.0.0.1:9, refuses connections),
/// and the push vectors `push.md` pins.
private let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appending(path: "packages/link/mobile/tests/fixtures")

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appending(path: name))
}

private func text(_ name: String) throws -> String {
    String(decoding: try fixture(name), as: UTF8.self)
}

private let options = SessionOptions(deviceName: "Test iPhone", platform: .ios)

@Test func anIdentityRestoresFromItsSecretAndABrokenSecretIsRefused() throws {
    let identity = try DeviceIdentity.generate()
    let secret = identity.secret()
    #expect(secret.count == 3617)
    #expect(identity.id().count == 32)
    #expect(try DeviceIdentity.fromSecret(secret: secret).id() == identity.id())
    #expect {
        try DeviceIdentity.fromSecret(secret: secret.dropFirst())
    } throws: { error in
        if case CoreError.Identity = error { true } else { false }
    }
}

@Test func theOfferPinsTheMachineTheStoredRecordWasPairedWith() throws {
    let offer = try PairingOffer.parse(uri: try text("offer.txt"))
    let record = try MachineRecord.fromBytes(bytes: try fixture("record.json"))
    #expect(offer.machineId() == record.id())
    #expect(offer.name() == "Studio Mac")
    #expect(offer.expiresAt() == 4_102_444_800)
    #expect(record.os() == "macos")
    #expect(record.toBytes() == (try fixture("record.json")))
}

@Test func aPairingWithAnUnreachableMachineFailsAndSpendsTheOffer() async throws {
    let runtime = try LinkRuntime()
    let identity = try DeviceIdentity.fromSecret(secret: try fixture("device-secret.bin"))
    let offer = try PairingOffer.parse(uri: try text("offer.txt"))
    await #expect {
        try await pair(runtime: runtime, identity: identity, offer: offer, options: options)
    } throws: { error in
        if case CoreError.MachineUnreachable = error { true } else { false }
    }
    await #expect {
        try await pair(runtime: runtime, identity: identity, offer: offer, options: options)
    } throws: { error in
        if case CoreError.OfferUsed = error { true } else { false }
    }
}

@Test(.timeLimit(.minutes(1)))
func aStoredSessionReportsItsFailedDialThenItsClose() async throws {
    let runtime = try LinkRuntime()
    let identity = try DeviceIdentity.fromSecret(secret: try fixture("device-secret.bin"))
    let record = try MachineRecord.fromBytes(bytes: try fixture("record.json"))
    let session = try LinkSession.start(
        runtime: runtime, identity: identity, record: record, options: options)
    #expect(session.machineId() == record.id())

    var retrying = false
    while !retrying, let event = await session.nextEvent() {
        if case .status(let status) = event, status.state == .waiting(.retry) {
            retrying = true
        }
    }
    #expect(retrying)

    session.end()
    var last: LinkState?
    while let event = await session.nextEvent() {
        if case .status(let status) = event {
            last = status.state
        }
    }
    #expect(last == .closed)
    #expect(session.status().state == .closed)
}

@Test func aContractMessageCrossesTheFrameBothWays() throws {
    let hello = ClientMessage.hello(
        HelloRequest(
            requestId: "r-1",
            protocol: ProtocolVersion(major: 1, minor: 0),
            client: ClientInfo(name: "broski-ios", version: "1.0.0")))
    let sent = try JSONSerialization.jsonObject(with: encodeFrame(message: hello)) as? [String: Any]
    let message = sent?["message"] as? [String: Any]
    #expect(sent?["type"] as? String == "contract")
    #expect(message?["type"] as? String == "hello")
    #expect(message?["requestId"] as? String == "r-1")

    let reply = #"{"type":"contract","message":{"type":"hello.result","requestId":"r-1","protocol":{"major":1,"minor":0},"bridgeVersion":"2.0.0"}}"#
    guard case .helloResult(let result) = try decodeFrame(frame: Data(reply.utf8)) else {
        Issue.record("not a hello result")
        return
    }
    #expect(result.bridgeVersion == "2.0.0")
    #expect(result.protocol == ProtocolVersion(major: 1, minor: 0))
    #expect {
        try decodeFrame(frame: Data(#"{"type":"contract"}"#.utf8))
    } throws: { error in
        if case CoreError.Frame = error { true } else { false }
    }
}

@Test func thePinnedPushOpensAndADecisionSealsForTheRelay() throws {
    let record = try MachineRecord.fromBytes(bytes: try fixture("push-record.json"))
    let push = try openNotification(record: record, data: try text("push.txt"))
    #expect(push.kind == "approval")
    #expect(push.title == "Approve Bash")
    #expect(push.request == "req-1")

    let letter = try decisionLetter(
        record: record, decision: .deny, backend: "pi", session: "s-2", request: nil)
    #expect(letter.url == "https://relay.example/v1/letters")
    let headers = Dictionary(uniqueKeysWithValues: letter.headers.map { ($0.name, $0.value) })
    #expect(headers["x-broski-machine"] == "00112233445566778899aabbccddeeff")
    #expect(headers["authorization"] == "Bearer token")
    #expect(letter.body.count > 12 + 16)
}
