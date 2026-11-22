import BroskiCore
import Foundation
import Testing

@testable import Broski

/// The keychain as the app uses it, in the app's own group and in the group shared with the
/// notification service extension, through the real core where the values come from it.
@Suite(.serialized)
struct PersistenceTests {
    @Test func anIdentitySecretComesBackAndOpensTheSamePhone() throws {
        let test = TestStorage()
        defer { test.remove() }
        #expect(try test.storage.identitySecret() == nil)

        let secret = try newIdentitySecret()
        try test.storage.saveIdentitySecret(secret)
        let stored = try #require(try test.storage.identitySecret())
        #expect(stored == secret)
        #expect(try Phone(identitySecret: stored, config: config).deviceId() == Phone(identitySecret: secret, config: config).deviceId())
    }

    @Test func recordsLiveInTheSharedGroupOnePerMachineAndGoWhenForgotten() throws {
        let test = TestStorage()
        defer { test.remove() }
        let records = test.storage.records
        let group = try #require(MachineRecordStore.sharedAccessGroup)
        #expect(group.hasSuffix(".com.muzammil.broski.push"))

        let record = try Fixture.data("record.json")
        let id = try MachineRecord.fromBytes(bytes: record).id()
        try records.save(record, id: id)
        try records.save(Data("other".utf8), id: "ffeeddccbbaa99887766554433221100")
        #expect(try records.all().map(\.id) == [id, "ffeeddccbbaa99887766554433221100"].sorted())

        let restored = try MachineRecord.fromBytes(bytes: try #require(try records.record(id: id)))
        #expect(restored.name() == "Studio Mac")
        #expect(restored.toBytes() == record)

        try records.save(Data("replaced".utf8), id: "ffeeddccbbaa99887766554433221100")
        #expect(try records.record(id: "ffeeddccbbaa99887766554433221100") == Data("replaced".utf8))
        try records.remove(id: id)
        #expect(try records.record(id: id) == nil)
        #expect(try records.all().map(\.id) == ["ffeeddccbbaa99887766554433221100"])
    }

    @Test func theSeenStateGoesBackIntoANewPhonesInboxAsTheCoreGaveIt() throws {
        let test = TestStorage()
        defer { test.remove() }
        let machineId = "00112233445566778899aabbccddeeff"
        let seen = SeenState(
            markers: [
                SeenMarker(
                    machineId: machineId, session: SessionRef(backend: "claude-code", sessionId: "s-9"),
                    seenAt: 1_725_000_000_000),
                SeenMarker(machineId: machineId, session: SessionRef(backend: "pi", sessionId: "s-10"), seenAt: 1_725_000_000_500),
                SeenMarker(machineId: machineId, session: SessionRef(backend: "my-agent", sessionId: "s-11"), seenAt: 1_725_000_000_900),
            ],
            readMachines: [machineId])
        #expect(try test.storage.seenState() == nil)
        try test.storage.saveSeenState(seen)

        let restored = try #require(try test.storage.seenState())
        #expect(restored == seen)
        let inbox = try Phone(identitySecret: try newIdentitySecret(), config: config).inbox()
        inbox.restoreSeen(state: restored)
        #expect(Set(inbox.seen().markers) == Set(seen.markers), "the core keeps markers in an order of its own")
        #expect(inbox.seen().readMachines == seen.readMachines)
    }

    /// The seen state as an earlier build wrote it reads back unchanged; a marker whose backend is
    /// no valid id is dropped, the rest kept.
    @Test func aStoredSeenStateFromAnEarlierBuildStillReads() throws {
        let test = TestStorage()
        defer { test.remove() }
        let machineId = "00112233445566778899aabbccddeeff"
        let stored = """
            {"markers":[\
            {"machineId":"\(machineId)","backend":"claude-code","sessionId":"s-1","seenAt":1},\
            {"machineId":"\(machineId)","backend":"pi","sessionId":"s-2","seenAt":2},\
            {"machineId":"\(machineId)","backend":"Not A Slug","sessionId":"s-3","seenAt":3}],\
            "readMachines":["\(machineId)"]}
            """
        try test.storage.app.set(Data(stored.utf8), for: "inbox-seen")

        let restored = try #require(try test.storage.seenState())
        #expect(restored.markers.map(\.session) == [
            SessionRef(backend: "claude-code", sessionId: "s-1"), SessionRef(backend: "pi", sessionId: "s-2"),
        ])
        #expect(restored.readMachines == [machineId])
    }

    /// A cold start with the machine unreachable (the fixture's one route refuses) shows the inbox
    /// the core last handed over, dimmed and with nothing to answer.
    @Test func aLaunchShowsTheCachedInboxBeforeItsMachineAnswers() throws {
        let test = TestStorage()
        defer { test.remove() }
        try test.storage.saveIdentitySecret(try Fixture.data("device-secret.bin"))
        let record = try Fixture.data("record.json")
        try test.storage.records.save(record, id: try MachineRecord.fromBytes(bytes: record).id())
        let cache = try Fixture.data("inbox-cache.json")
        try test.storage.saveInboxCache(cache)
        #expect(try test.storage.inboxCache() == cache)

        let app = AppModel(storage: test.storage)
        app.start()
        let rows = app.inbox.rows
        #expect(rows.map(\.session.sessionId) == ["s-ask", "s-old"])
        #expect(rows.allSatisfy { $0.cached && $0.pending == nil })
        #expect(rows.first?.askLine(agent: app.brand(of: rows[0].session, on: rows[0].machineId).name) == "Claude Code wants to run npm test")
        #expect(app.machine(id: rows[0].machineId)?.summary.isReady == false)
    }

    @Test func aCacheTheCoreRefusesDoesNotStopTheLaunch() throws {
        let test = TestStorage()
        defer { test.remove() }
        try test.storage.saveIdentitySecret(try newIdentitySecret())
        try test.storage.saveInboxCache(Data("not a cache".utf8))

        let app = AppModel(storage: test.storage)
        app.start()
        #expect(app.launch == .ready)
        #expect(app.inbox.rows.isEmpty)
    }

    @Test func startingOverRemovesTheIdentityTheSeenStateAndEveryPairing() throws {
        let test = TestStorage()
        defer { test.remove() }
        try test.storage.saveIdentitySecret(try newIdentitySecret())
        try test.storage.saveInboxCache(try Fixture.data("inbox-cache.json"))
        try test.storage.saveSeenState(SeenState(markers: [], readMachines: ["00112233445566778899aabbccddeeff"]))
        try test.storage.records.save(try Fixture.data("record.json"), id: "00112233445566778899aabbccddeeff")

        try test.storage.removeEverything()
        #expect(try test.storage.identitySecret() == nil)
        #expect(try test.storage.inboxCache() == nil)
        #expect(try test.storage.seenState() == nil)
        #expect(try test.storage.records.all().isEmpty)
    }

    @Test func aLaunchMakesAnIdentityOnceAndNeverReplacesOneThatExists() throws {
        let test = TestStorage()
        defer { test.remove() }
        let first = AppModel(storage: test.storage)
        first.start()
        #expect(first.launch == .ready)
        let secret = try #require(try test.storage.identitySecret())

        let second = AppModel(storage: test.storage)
        second.start()
        #expect(second.launch == .ready)
        #expect(try test.storage.identitySecret() == secret)
    }

    @Test func aLaunchWithPairingsButNoIdentityStopsAndMakesNone() throws {
        let test = TestStorage()
        defer { test.remove() }
        try test.storage.records.save(try Fixture.data("record.json"), id: "00112233445566778899aabbccddeeff")

        let model = AppModel(storage: test.storage)
        model.start()
        #expect(model.launch == .unavailable(.missing))
        #expect(try test.storage.identitySecret() == nil)
    }

    @Test func aRecordChangeTheCoreHandsOverAfterAForgetDoesNotStoreThePairingAgain() throws {
        let test = TestStorage()
        defer { test.remove() }
        try test.storage.saveIdentitySecret(try Fixture.data("device-secret.bin"))
        let record = try Fixture.data("record.json")
        let id = try MachineRecord.fromBytes(bytes: record).id()
        try test.storage.records.save(record, id: id)
        let app = AppModel(storage: test.storage)
        app.start()
        let machine = try #require(app.machine(id: id))

        app.forget(machine)
        machine.persistRecord()

        #expect(try test.storage.records.all().isEmpty)
        #expect(app.machines.isEmpty)
    }

    @Test func aStoredIdentityTheCoreRefusesIsReportedAndKept() throws {
        let test = TestStorage()
        defer { test.remove() }
        let broken = Data([1, 2, 3])
        try test.storage.saveIdentitySecret(broken)

        let model = AppModel(storage: test.storage)
        model.start()
        guard case .unavailable(.rejected) = model.launch else {
            Issue.record("expected the identity to be refused, got \(model.launch)")
            return
        }
        #expect(try test.storage.identitySecret() == broken)
    }
}

let config = PhoneConfig(deviceName: "Test iPhone", platform: .ios, clientName: "Broski tests", clientVersion: "0.0.0")
