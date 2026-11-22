import BroskiCore
import Foundation
import Testing
import UserNotifications

@testable import Broski

/// Pushes opened as the notification service extension opens them, with the core's pinned push
/// vector (`packages/link/mobile/tests/fixtures/push.txt`, sealed for `push-record.json`'s
/// machine, "studio"), the preferences the extension reads from the app group, and a decision
/// posted to a real HTTP listener.
@Suite(.serialized)
struct PushTests {
    static let machineId = "00112233445566778899aabbccddeeff"

    @Test func anApprovalOpensWithTheMachinesWordsAllowAndDenyAndWhatADecisionNeeds() throws {
        let test = try RecordStore()
        defer { test.remove() }
        let content = try relayPush(kind: "approval", payload: Fixture.text("push.txt"))

        PushContent.describe(content, records: test.records, preferences: test.preferences)

        #expect(content.title == "Approve Bash")
        #expect(content.body == "rm -rf /tmp/x")
        #expect(content.subtitle == "studio")
        #expect(content.categoryIdentifier == PushContent.Category.approval)
        #expect(content.threadIdentifier == "\(Self.machineId)/s-1")
        #expect(content.interruptionLevel != .passive)
        let target = PushTarget(content.userInfo)
        #expect(target.machineId == Self.machineId)
        #expect(target.session == SessionTarget(machineId: Self.machineId, session: SessionRef(backend: "claude-code", sessionId: "s-1")))
        #expect(target.request == "req-1")
    }

    @Test func aKindTurnedOffInSettingsArrivesQuietlyReadThroughTheAppGroup() throws {
        let test = try RecordStore()
        defer { test.remove() }
        #expect(FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NotificationPreferences.appGroup) != nil)
        let settings = try #require(NotificationPreferences.store)
        defer { settings.removeObject(forKey: NotificationPreferences.needsYou) }
        settings.set(false, forKey: NotificationPreferences.needsYou)
        let fresh = NotificationPreferences(defaults: UserDefaults(suiteName: NotificationPreferences.appGroup))
        #expect(!fresh.allows(kind: "approval") && !fresh.allows(kind: "attention"))
        #expect(fresh.allows(kind: "done") && fresh.allows(kind: "offline"))

        let content = try relayPush(kind: "approval", payload: Fixture.text("push.txt"))
        PushContent.describe(content, records: test.records, preferences: fresh)
        #expect(content.interruptionLevel == .passive)
        #expect(content.sound == nil)
        #expect(content.title == "Approve Bash", "a quiet push still says what happened")
    }

    @Test func theRelaysOfflineAlertIsWordedWithTheMachinesName() throws {
        let test = try RecordStore()
        defer { test.remove() }
        let alert = Data(#"{"machine":"00112233445566778899aabbccddeeff","state":"asleep","since":1}"#.utf8)
        let payload = alert.base64EncodedString().replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        let content = try relayPush(kind: "offline", payload: payload)

        PushContent.describe(content, records: test.records, preferences: test.preferences)

        #expect(content.title == "studio is asleep")
        #expect(content.categoryIdentifier == PushContent.Category.offline)
    }

    @Test func aPushThatDoesNotOpenKeepsTheRelaysTextAndOffersNoDecision() throws {
        let test = try RecordStore()
        defer { test.remove() }
        let content = try relayPush(kind: "approval", payload: "AAAA")
        PushContent.describe(content, records: test.records, preferences: test.preferences)
        #expect(content.title == "Broski" && content.body == "New activity")
        #expect(content.categoryIdentifier.isEmpty)

        let unknown = try relayPush(kind: "approval", payload: Fixture.text("push.txt"), machineId: "ffeeddccbbaa99887766554433221100")
        PushContent.describe(unknown, records: test.records, preferences: test.preferences)
        #expect(unknown.title == "Broski")
    }

    @Test(.timeLimit(.minutes(1)))
    func aDecisionIsPostedExactlyAsTheCoreSealedIt() async throws {
        let server = try LocalHTTPServer(status: 202)
        let port = try await server.start()
        defer { server.stop() }
        let record = try fixtureRecord(relay: "ws://127.0.0.1:\(port)/base")
        let letter = try decisionLetter(record: record, decision: .allow, backend: "claude-code", session: "s-1", request: "req-1")
        #expect(letter.url == "http://127.0.0.1:\(port)/v1/letters")

        try await LetterPost().send(letter)

        let request = try #require(server.requests.first)
        #expect(request.method == "POST")
        #expect(request.path == "/v1/letters")
        #expect(request.body == letter.body)
        for header in letter.headers {
            #expect(request.headers[header.name.lowercased()] == header.value)
        }
        #expect(request.headers["x-broski-machine"] == Self.machineId)
        #expect(request.headers["authorization"] == "Bearer token")
    }

    @Test(.timeLimit(.minutes(1)))
    func aDecisionTheRelayRefusesIsAFailure() async throws {
        let server = try LocalHTTPServer(status: 507)
        let port = try await server.start()
        defer { server.stop() }
        let letter = try decisionLetter(
            record: try fixtureRecord(relay: "ws://127.0.0.1:\(port)"), decision: .deny, backend: "pi", session: "s-2",
            request: nil)
        await #expect(throws: LetterPost.Refused.self) { try await LetterPost().send(letter) }
        #expect(server.requests.count == 1)
    }

    /// The APNs body the relay sends (relay/src/push/apns.rs).
    private func relayPush(kind: String, payload: String, machineId: String = machineId) throws -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "Broski"
        content.body = "New activity"
        content.categoryIdentifier = kind
        content.userInfo = ["m": machineId, "k": kind, "e": payload]
        return content
    }

    private func fixtureRecord(relay: String) throws -> MachineRecord {
        var json = try #require(try JSONSerialization.jsonObject(with: Fixture.data("push-record.json")) as? [String: Any])
        json["relay"] = relay
        return try MachineRecord.fromBytes(bytes: try JSONSerialization.data(withJSONObject: json))
    }
}

/// The fixture record in the shared keychain group under a service of its own, and preferences
/// in an app group suite of its own, both removed when done.
private struct RecordStore {
    let records: MachineRecordStore
    let suite: String
    let defaults: UserDefaults

    init() throws {
        let tag = UUID().uuidString
        records = MachineRecordStore(
            keychain: Keychain(service: "com.muzammil.broski.tests.push.\(tag)", accessGroup: MachineRecordStore.sharedAccessGroup))
        try records.save(try Fixture.data("push-record.json"), id: PushTests.machineId)
        suite = "\(NotificationPreferences.appGroup).tests.\(tag)"
        defaults = try #require(UserDefaults(suiteName: suite))
    }

    var preferences: NotificationPreferences { NotificationPreferences(defaults: defaults) }

    func remove() {
        try? records.remove(id: PushTests.machineId)
        defaults.removePersistentDomain(forName: suite)
    }
}
