import XCTest

/// A run on the real machine, after the pairing tests: the session titled "Hold for the live
/// activity" streams and then holds (`scripts/e2e-ios-app.sh` scripted it), the person starts that
/// run from the chat's composer, the Live Activity follows it, and Stop on the activity ends it.
final class RunEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30
    private let title = "Hold for the live activity"

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testTheLiveActivityFollowsARunAndStopEndsIt() throws {
        let app = XCUIApplication()
        app.launch()
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: timeout))
        row.tap()
        let field = app.descendants(matching: .any)["composer"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: timeout))
        field.tap()
        field.typeText("Run until released")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["Working."].waitForExistence(timeout: timeout), "the held run streams into the chat")
        XCTAssertTrue(app.staticTexts["Working"].exists, "the status lane says the run is live")
        try screenshot("chat-held-run")

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
        XCTAssertTrue(app.staticTexts["Working"].waitForNonExistence(timeout: timeout), "the run ended on the machine")
        try screenshot("chat-stopped-from-activity")
        app.buttons["BackButton"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: timeout))
        XCTAssertFalse(app.staticTexts["Working"].exists, "the row left Working")
        try screenshot("inbox-stopped")
    }
}
