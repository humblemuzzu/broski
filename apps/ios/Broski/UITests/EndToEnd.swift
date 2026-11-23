import XCTest

/// What every end-to-end test shares: the script's environment, screenshots, the tab bar, the
/// machine's command file.
extension XCTestCase {
    var environment: [String: String] { ProcessInfo.processInfo.environment }

    /// Saved as an attachment and, under `BROSKI_E2E_SCREENSHOTS`, as `<name>.png`.
    @MainActor
    func screenshot(_ name: String) throws {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let directory = environment["BROSKI_E2E_SCREENSHOTS"] {
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "\(name).png"))
        }
    }

    /// A tab of the tab bar, which a wide layout shows as a sidebar of buttons.
    @MainActor
    func tab(_ name: String, in app: XCUIApplication) {
        let inBar = app.tabBars.buttons[name]
        (inBar.exists ? inBar : app.buttons[name].firstMatch).tap()
    }

    /// The inbox's idle sessions, which fold under their header while anything else is listed.
    @MainActor
    func showIdle(in app: XCUIApplication) {
        let idle = app.buttons["inbox.idle"]
        if idle.waitForExistence(timeout: 3), idle.value as? String == "Folded" { idle.tap() }
    }

    /// Settings › Appearance's theme (`System`, `Light`, `Dark`), back on Settings after.
    @MainActor
    func setAppearance(_ name: String, in app: XCUIApplication) {
        tab("Settings", in: app)
        app.buttons["Appearance"].tap()
        app.buttons[name].tap()
        app.buttons["BackButton"].firstMatch.tap()
    }

    /// Appends one command to the file the test machine reads (`{"seed":…}`, `{"release":…}`).
    func command(_ json: String) throws {
        let path = try XCTUnwrap(environment["BROSKI_E2E_COMMANDS"])
        let handle = try XCTUnwrap(FileHandle(forWritingAtPath: path))
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\(json)\n".utf8))
    }

    var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    /// Pulls Notification Center down over whatever is on screen.
    @MainActor
    func openNotificationCenter() {
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.001))
        top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.8)))
    }
}
