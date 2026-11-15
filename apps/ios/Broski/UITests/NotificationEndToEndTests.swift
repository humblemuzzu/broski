import XCTest

/// A push in the simulator: `scripts/e2e-ios-app.sh` has put the push fixture's machine record
/// ("studio") in the app's keychain, and sends the relay's APNs body around the core's pinned push
/// vector with `simctl push` once this test asks for it (a `push-now` file beside the
/// screenshots). The simulator does not run notification service extensions for `simctl push`, so
/// the push arrives with the relay's placeholder, and the payload carries the keys the extension
/// would have added (`machine`, `backend`, `session`, `request`). Deny then runs the app's decision:
/// the core seals the letter, its relay (relay.example) cannot be reached, and the app says so.
final class NotificationEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 60

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testAnApprovalPushOffersAllowAndDenyAndADenyThatCannotBeSentIsSaid() throws {
        let app = XCUIApplication()
        app.launch()
        XCUIDevice.shared.press(.home)
        let directory = try XCTUnwrap(environment["BROSKI_E2E_SCREENSHOTS"])
        try Data().write(to: URL(fileURLWithPath: directory).appending(path: "push-now"))

        let banner = springboard.staticTexts["New activity"]
        XCTAssertTrue(banner.waitForExistence(timeout: timeout), "the push is delivered")
        try screenshot("notification-banner")

        openNotificationCenter()
        let delivered = springboard.staticTexts["New activity"].firstMatch
        XCTAssertTrue(delivered.waitForExistence(timeout: timeout))
        delivered.press(forDuration: 1.2)
        let deny = springboard.buttons["Deny"]
        XCTAssertTrue(deny.waitForExistence(timeout: timeout), "an approval offers Deny")
        XCTAssertTrue(springboard.buttons["Allow"].exists, "and Allow")
        try screenshot("notification-actions")

        deny.tap()
        XCTAssertTrue(
            springboard.staticTexts["Your answer didn't reach studio"].waitForExistence(timeout: timeout),
            "a decision that could not be posted is said")
        try screenshot("notification-decision-failed")
    }
}
