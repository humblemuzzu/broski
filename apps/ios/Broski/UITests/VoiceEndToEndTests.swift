import XCTest

/// Dictation against the real machine, after the pairing tests: Settings › Voice keeps the
/// person's words and, when the script hands one in (`BROSKI_E2E_XAI_KEY`), saves an xAI key that
/// xAI checked. Then the mic in a chat records while the script speaks through the Mac's speakers
/// (it says the line when the test leaves `speak-now` in the screenshots folder) and the words land
/// in the composer: through Grok with a key, through this iPhone's recognizer without one.
final class VoiceEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30
    private let session = "Rename the settings screen"

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func test1KeepsWordsAndAKeyInVoiceSettings() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["inbox.search"].waitForExistence(timeout: timeout))
        tab("Settings", in: app)
        app.buttons["Voice"].tap()
        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: timeout))

        let word = app.textFields["Add a word or name"]
        for _ in 0..<4 where !word.exists {
            app.swipeUp()
        }
        word.tap()
        word.typeText("Zanzibar")
        app.buttons["Add"].tap()
        XCTAssertTrue(app.staticTexts["Zanzibar"].waitForExistence(timeout: timeout))

        if let key = environment["BROSKI_E2E_XAI_KEY"], !key.isEmpty {
            let field = app.secureTextFields["Paste your xAI API key"]
            for _ in 0..<4 where !field.isHittable {
                app.swipeDown()
            }
            field.tap()
            field.typeText(key)
            app.buttons["Save Key"].tap()
            XCTAssertTrue(app.staticTexts["xAI Key"].waitForExistence(timeout: timeout), app.debugDescription)
            XCTAssertTrue(app.staticTexts["xAI took the key. Dictation now uses Grok."].exists)
        }
        try screenshot("voice-settings")
    }

    @MainActor
    func test2DictatesIntoTheComposer() throws {
        // A simulator has no on-device speech models, so without a key there is nothing to transcribe with.
        try XCTSkipIf((environment["BROSKI_E2E_XAI_KEY"] ?? "").isEmpty, "needs BROSKI_E2E_XAI_KEY")
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["inbox.search"].waitForExistence(timeout: timeout))
        showIdle(in: app)
        app.staticTexts[session].firstMatch.tap()
        let composer = app.descendants(matching: .any)["composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: timeout), "the chat opens")
        let mic = app.buttons["Dictate"]
        XCTAssertTrue(mic.waitForExistence(timeout: timeout))
        mic.tap()
        let allow = springboard.buttons["Allow"]
        if allow.waitForExistence(timeout: 5) {
            allow.tap()
            XCTAssertTrue(app.staticTexts["Microphone on. Tap the mic to dictate."].waitForExistence(timeout: timeout))
        } else {
            app.buttons["Cancel dictation"].tap()
        }
        try screenshot("dictation-ready")

        try speakNow()
        mic.tap()
        let insert = app.buttons["Insert dictation"]
        XCTAssertTrue(insert.waitForExistence(timeout: timeout), "a tap records until ✓")
        Thread.sleep(forTimeInterval: 2)
        try screenshot("dictation-recording")
        Thread.sleep(forTimeInterval: 6)
        insert.tap()
        try screenshot("dictation-transcribing")

        // The words land when the Mac's speakers reach its microphone; where they cannot, the
        // recording still makes the round trip and comes back empty.
        let heardNothing = app.staticTexts["Didn't catch any words."]
        var text: String { composer.exists ? composer.value as? String ?? "" : "" }
        let deadline = Date.now.addingTimeInterval(60)
        while Date.now < deadline, !heardNothing.exists, !text.localizedCaseInsensitiveContains("settings") {
            Thread.sleep(forTimeInterval: 0.5)
        }
        try screenshot("dictated")
        XCTAssertTrue(heardNothing.exists || text.localizedCaseInsensitiveContains("settings"), "the recording came back: \(text)")
        XCTAssertTrue(heardNothing.waitForNonExistence(timeout: timeout))

        // Held, the mic records until the finger lifts, then the recording goes as a tap's does.
        let before = text
        try speakNow()
        mic.press(forDuration: 6)
        XCTAssertFalse(app.buttons["Insert dictation"].exists, "letting go ends a held recording")
        let back = Date.now.addingTimeInterval(60)
        while Date.now < back, !heardNothing.exists, text == before {
            Thread.sleep(forTimeInterval: 0.5)
        }
        try screenshot("dictated-held")
        XCTAssertTrue(heardNothing.exists || text != before, "the held recording came back: \(text)")
    }

    /// Tells the script to speak, through a file it watches for.
    private func speakNow() throws {
        let directory = try XCTUnwrap(environment["BROSKI_E2E_SCREENSHOTS"])
        try Data().write(to: URL(fileURLWithPath: directory).appending(path: "speak-now"))
    }
}
