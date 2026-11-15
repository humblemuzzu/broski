import XCTest

/// The app against a real machine: `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
/// `test-machine` (the real daemon and the real bridge on its fake backend), which has two
/// sessions in its history, puts the machine's pairing link on the simulator's pasteboard
/// (`simctl pbcopy`) and lets the app paste it without asking, and passes in:
/// - `BROSKI_E2E_COMMANDS`: a file the machine reads commands from (`{"seed":"<title>"}` adds a
///   session), which the simulator, sharing the host's file system, can append to;
/// - `BROSKI_E2E_SCREENSHOTS`: a directory for the screenshots of each screen.
///
/// The tests run in order: the first pairs from a pasted link, the next look at the paired app.
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
        let path = try XCTUnwrap(environment["BROSKI_E2E_COMMANDS"])
        let handle = try XCTUnwrap(FileHandle(forWritingAtPath: path))
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{\"seed\":\"\(title)\"}\n".utf8))
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
