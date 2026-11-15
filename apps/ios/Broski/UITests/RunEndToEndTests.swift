import XCTest

/// A run on the real machine, after the pairing tests: the session `BROSKI_E2E_HOLD_SESSION` names
/// streams and then holds (`scripts/e2e-ios-app.sh` scripted it), the app starts that run through
/// its core, the Live Activity follows it, and Stop on the activity ends it.
final class RunEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30
    private let title = "Hold for the live activity"

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTheLiveActivityFollowsARunAndStopEndsIt() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BROSKI_E2E_PROMPT"] = try XCTUnwrap(environment["BROSKI_E2E_HOLD_SESSION"])
        app.launch()
        XCTAssertTrue(app.staticTexts["Working"].waitForExistence(timeout: timeout), "the held run is live")
        XCTAssertTrue(app.staticTexts[title].exists)
        try screenshot("inbox-working")

        XCUIDevice.shared.press(.home)
        openNotificationCenter()
        let activity = springboard.staticTexts[title]
        XCTAssertTrue(activity.waitForExistence(timeout: timeout), "the Live Activity shows the run")
        let allow = springboard.buttons["Allow"]
        if allow.exists { allow.tap() }
        XCTAssertTrue(springboard.staticTexts["Working"].waitForExistence(timeout: timeout))
        try screenshot("live-activity")

        let stop = springboard.buttons["Stop"]
        XCTAssertTrue(stop.exists)
        stop.tap()
        XCTAssertTrue(
            springboard.staticTexts["Working"].waitForNonExistence(timeout: timeout), "the activity no longer says working")
        XCTAssertTrue(springboard.staticTexts["Done"].waitForExistence(timeout: timeout), "it ends as done")
        try screenshot("live-activity-done")

        app.activate()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Working"].waitForNonExistence(timeout: timeout), "the run ended on the machine")
        try screenshot("inbox-stopped")
    }
}
