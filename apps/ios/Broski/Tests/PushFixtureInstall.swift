import Foundation
import Testing

@testable import Broski

/// Not a test of its own: `scripts/e2e-ios-app.sh` runs this to put the push fixture's machine
/// record where the app keeps records (the shared group, the app's own service), so the
/// notification service extension opens the fixture push it then sends with `simctl push`.
@Suite
struct PushFixtureInstall {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BROSKI_E2E_INSTALL_PUSH_RECORD"] != nil))
    func installsThePushFixturesRecordForTheSimulatorPush() throws {
        let records = MachineRecordStore()
        try records.save(try Fixture.data("push-record.json"), id: PushTests.machineId)
        #expect(try records.record(id: PushTests.machineId) == (try Fixture.data("push-record.json")))
    }
}
