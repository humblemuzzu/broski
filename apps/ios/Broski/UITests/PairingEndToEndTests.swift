import XCTest

/// The app against a real machine: `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
/// `test-machine` (the real daemon and the real bridge on its fake backend), which has two
/// sessions in its history, puts the machine's pairing link on the simulator's pasteboard
/// (`simctl pbcopy`) and lets the app paste it without asking, and passes in:
/// - `BROSKI_E2E_COMMANDS`: a file the machine reads commands from (`{"seed":"<title>"}` adds a
///   session), which the simulator, sharing the host's file system, can append to;
/// - `BROSKI_E2E_SCREENSHOTS`: a directory for the screenshots of each screen.
///
/// The tests run in order: the first pairs from a pasted link and pulls the inbox to refresh, the
/// next look at the paired app.
final class PairingEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func test1PairsFromAPastedLinkAndListsTheMachinesSessions() throws {
        XCTAssertNotNil(environment["BROSKI_E2E_COMMANDS"], "run through scripts/e2e-ios-app.sh")
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Control Claude Code and Pi on your Mac from here."].waitForExistence(timeout: timeout))
        try screenshot("welcome")

        app.buttons["Paste Pairing Link"].tap()

        let pair = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pair with '")).firstMatch
        let found = pair.waitForExistence(timeout: timeout)
        if !found { try screenshot("pairing-not-offered") }
        XCTAssertTrue(found, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Code expires in"].exists)
        try screenshot("offer-preview")
        pair.tap()

        let turnOn = app.buttons["Turn On Notifications"]
        XCTAssertTrue(turnOn.waitForExistence(timeout: timeout))
        try screenshot("notifications-ask")
        turnOn.tap()
        allowSystemPrompt("Allow")

        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Rename the settings screen"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Fix the flaky login test"].exists)

        try seed("Add dark mode to the dashboard")
        XCTAssertTrue(app.staticTexts["Add dark mode to the dashboard"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Done"].exists, "a session after the history read is done")
        XCTAssertTrue(app.staticTexts["Idle"].exists, "the history read at pairing is seen")
        try screenshot("inbox-light")

        let list = app.collectionViews.firstMatch
        list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).press(
            forDuration: 0, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)),
            withVelocity: .slow, thenHoldForDuration: 0)
        XCTAssertTrue(app.activityIndicators.firstMatch.waitForNonExistence(timeout: timeout), "the pull ends")
        XCTAssertTrue(app.staticTexts["Add dark mode to the dashboard"].exists, "the list is whole after the pull")
        XCTAssertTrue(app.staticTexts["Rename the settings screen"].exists)
        try screenshot("inbox-refreshed")
    }

    @MainActor
    func test2ShowsTheMachineSettingsAndDarkInbox() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: timeout))

        app.buttons["Machines"].tap()
        XCTAssertTrue(app.navigationBars["Machines"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Connected on this network"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Bridge"].exists)
        try screenshot("machines")
        app.buttons["BackButton"].tap()

        tab("Settings", in: app)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: timeout))
        try screenshot("settings-light")
        app.buttons["Dark"].tap()
        try screenshot("settings-dark")

        tab("Inbox", in: app)
        XCTAssertTrue(app.staticTexts["Add dark mode to the dashboard"].waitForExistence(timeout: timeout))
        try screenshot("inbox-dark")

        tab("Settings", in: app)
        app.buttons["System"].tap()
    }

    @MainActor
    func test3LaysOutAtTheLargestTextSize() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Add dark mode to the dashboard"].waitForExistence(timeout: timeout))
        try screenshot("inbox-largest-text")

        app.buttons["Machines"].tap()
        XCTAssertTrue(app.navigationBars["Machines"].waitForExistence(timeout: timeout))
        try screenshot("machines-largest-text")
        app.buttons["BackButton"].tap()

        tab("Settings", in: app)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: timeout))
        try screenshot("settings-largest-text")
    }

    @MainActor
    private func allowSystemPrompt(_ button: String) {
        let allow = springboard.buttons[button]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }

    private func seed(_ title: String) throws {
        try command("{\"seed\":\"\(title)\"}")
    }
}
