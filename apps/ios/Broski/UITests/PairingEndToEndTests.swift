import XCTest

/// The app against a real machine: `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
/// `test-machine` (the real daemon and the real bridge on its fake backend), which has two
/// sessions in its history, puts the machine's pairing link on the simulator's pasteboard
/// (`simctl pbcopy`) and lets the app paste it without asking, and passes in:
/// - `BROSKI_E2E_COMMANDS`: a file the machine reads commands from (`{"seed":"<title>"}` adds a
///   session), which the simulator, sharing the host's file system, can append to;
/// - `BROSKI_E2E_SCREENSHOTS`: a directory for the screenshots of each screen;
/// - `BROSKI_E2E_ASK_SESSION`: the session (`{"backend":…,"sessionId":…}`) whose run the machine
///   starts on `{"run":<session>,"scenario":"permission"}`, as a terminal would, asking before it
///   runs a command.
///
/// The tests run in order: the first pairs from a pasted link and pulls the inbox to refresh, the
/// next look at the paired app, the last approves a permission from its inbox row.
final class PairingEndToEndTests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
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

    /// No phone prompts the run: the row learns the ask by itself, offers the backend's allow and
    /// deny, and the person's Approve lets the run finish.
    @MainActor
    func test4ApprovesAToolPermissionFromItsRow() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Clean the build folder"].waitForExistence(timeout: timeout))
        let session = try XCTUnwrap(environment["BROSKI_E2E_ASK_SESSION"])
        try command("{\"run\":\(session),\"scenario\":\"permission\"}")

        let row = app.cells.containing(.staticText, identifier: "Clean the build folder").firstMatch
        let ask = app.staticTexts["Pi wants to run bash"]
        XCTAssertTrue(ask.waitForExistence(timeout: timeout), "the row says what the agent wants")
        XCTAssertTrue(app.staticTexts["Needs you"].exists)
        try screenshot("inbox-needs-you")

        row.swipeLeft()
        let approve = app.buttons["Approve"]
        XCTAssertTrue(approve.waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons["Deny"].exists)
        try screenshot("inbox-row-actions")
        approve.tap()

        XCTAssertTrue(ask.waitForNonExistence(timeout: timeout), "the row leaves Needs you")
        XCTAssertFalse(app.staticTexts["Already answered elsewhere."].exists)
        try screenshot("inbox-approved")
    }

    /// A tab of the tab bar, which a wide layout shows as a sidebar of buttons.
    @MainActor
    private func tab(_ name: String, in app: XCUIApplication) {
        let inBar = app.tabBars.buttons[name]
        (inBar.exists ? inBar : app.buttons[name].firstMatch).tap()
    }

    @MainActor
    private func allowSystemPrompt(_ button: String) {
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons[button]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }

    private func seed(_ title: String) throws {
        try command("{\"seed\":\"\(title)\"}")
    }

    /// One line for the machine's stdin.
    private func command(_ line: String) throws {
        let path = try XCTUnwrap(environment["BROSKI_E2E_COMMANDS"])
        let handle = try XCTUnwrap(FileHandle(forWritingAtPath: path))
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\(line)\n".utf8))
    }

    @MainActor
    private func screenshot(_ name: String) throws {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let directory = environment["BROSKI_E2E_SCREENSHOTS"] {
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "\(name).png"))
        }
    }
}
