import XCTest

/// The chat against the real machine, after the pairing tests: the session `BROSKI_E2E_CHAT_SESSION`
/// names ("Tidy the release notes") is opened from its inbox row, and each test scripts its next run
/// (`{"script":<session>,"scenario":…}` on the machine's command file) before sending a prompt from
/// the composer: the `work` run streams and folds, a permission is denied with instructions and then
/// allowed, a choice is answered, a message is queued behind a held run and the run stopped. Then
/// jump to latest after scrolling up, rename, a new session from the sheet, dark and the largest
/// text size. Every state is a screenshot.
final class SessionEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30
    private let title = "Tidy the release notes"

    override func setUp() {
        continueAfterFailure = false
    }

    /// The fake's `work` run thinks, edits, retries, compacts and then withdraws the message that
    /// held its thought and edit, so what stays is its words: the notice, the compaction and 24
    /// paragraphs, the draft it withdrew gone.
    @MainActor
    func test1SendsFromTheComposerAndTheWorkStreams() throws {
        let app = try openChat()
        try screenshot("chat-history")
        try script("work")
        send("Look over the notes", in: app)

        let last = app.staticTexts["Paragraph 24: what the agent found, streamed in parts."]
        XCTAssertTrue(last.waitForExistence(timeout: timeout), app.debugDescription)
        XCTAssertTrue(last.isHittable, "a follower sees the newest text")
        try screenshot("chat-work")
        XCTAssertFalse(app.staticTexts["A draft the agent withdraws."].exists, "a retracted message leaves")
        let transcript = app.scrollViews.firstMatch
        let compacted = app.staticTexts["Context compacted · 1K → 200 tokens"]
        for _ in 0..<6 where !compacted.exists {
            transcript.swipeDown()
        }
        XCTAssertTrue(compacted.exists, "the compaction stays as a marker between the turns")
        XCTAssertTrue(app.staticTexts["Halfway there."].exists, "the agent's notice stays in the transcript")
        XCTAssertTrue(app.staticTexts["Look over the notes"].exists)
        try screenshot("chat-work-top")
    }

    @MainActor
    func test2JumpsToLatestAfterScrollingUp() throws {
        let app = try openChat()
        let last = app.staticTexts["Paragraph 24: what the agent found, streamed in parts."]
        XCTAssertTrue(last.waitForExistence(timeout: timeout))
        let transcript = app.scrollViews.firstMatch
        transcript.swipeDown(velocity: .fast)
        transcript.swipeDown(velocity: .fast)
        let jump = app.buttons["Jump to latest"]
        XCTAssertTrue(jump.waitForExistence(timeout: timeout), "scrolling up detaches and offers the way back")
        XCTAssertFalse(last.isHittable)
        try screenshot("chat-detached")
        jump.tap()
        XCTAssertTrue(jump.waitForNonExistence(timeout: timeout))
        XCTAssertTrue(last.isHittable, "the jump lands on the newest text")
        try screenshot("chat-jumped")
    }

    @MainActor
    func test3DeniesWithInstructionsThenAllows() throws {
        let app = try openChat()
        try script("permission")
        send("Clean the build", in: app)
        let instead = app.textFields["Tell Pi what to do instead"].firstMatch
        XCTAssertTrue(instead.waitForExistence(timeout: timeout), "the ask is pinned above the composer")
        try screenshot("chat-permission")
        XCTAssertTrue(app.staticTexts["Pi wants to run"].exists)
        XCTAssertTrue(app.staticTexts["Waiting for your approval"].waitForExistence(timeout: timeout))
        instead.tap()
        instead.typeText("Keep the build folder")
        app.buttons["Deny"].tap()
        XCTAssertTrue(instead.waitForNonExistence(timeout: timeout), "the card goes once the bridge resolves the ask")
        XCTAssertTrue(app.staticTexts["Cleaned."].waitForExistence(timeout: timeout))
        try screenshot("chat-denied")

        try script("permission")
        send("Clean it now", in: app)
        let allow = app.buttons["Allow"]
        XCTAssertTrue(allow.waitForExistence(timeout: timeout))
        allow.tap()
        XCTAssertTrue(allow.waitForNonExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts.matching(identifier: "Cleaned.").element(boundBy: 1).waitForExistence(timeout: timeout))
        try screenshot("chat-allowed")

        let fold = app.buttons.matching(identifier: "work.fold").allElementsBoundByIndex.last { $0.isHittable }
        let ran = try XCTUnwrap(fold, "the command folds into one row above the answer")
        XCTAssertTrue(ran.label.hasSuffix("Ran 1 command"), ran.label)
        ran.tap()
        let command = app.buttons["rm -rf build"].firstMatch
        XCTAssertTrue(command.waitForExistence(timeout: timeout), "the fold opens in place to its calls")
        try screenshot("chat-work-open")
        let edge = ran.frame.minX
        command.tap()
        XCTAssertTrue(app.staticTexts["removed"].waitForExistence(timeout: timeout), "the call opens to its output")
        XCTAssertTrue(app.staticTexts["$ rm -rf build"].exists, "and to the command exactly")
        XCTAssertTrue(app.buttons["Ran command"].exists, "the opened row says what it did")
        XCTAssertFalse(app.buttons["rm -rf build"].exists, "and the command is shown once")
        XCTAssertEqual(ran.frame.minX, edge, accuracy: 1, "the transcript keeps its side margins")
        try screenshot("chat-tool-detail")
    }

    @MainActor
    func test4AnswersAChoice() throws {
        let app = try openChat()
        try script("ask")
        send("Pick for me", in: app)
        let retry = app.buttons["Retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Pick one"].exists)
        try screenshot("chat-ask")
        retry.tap()
        XCTAssertTrue(retry.waitForNonExistence(timeout: timeout))
        XCTAssertTrue(app.staticTexts["Thanks."].waitForExistence(timeout: timeout))
        try screenshot("chat-answered")
    }

    @MainActor
    func test5QueuesBehindARunThenStopsIt() throws {
        let app = try openChat()
        try script("hold")
        send("Hold on", in: app)
        XCTAssertTrue(app.staticTexts["Working"].waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons["Stop"].exists, "running with nothing typed, the button stops")
        let words = app.staticTexts["Working."]
        XCTAssertTrue(words.waitForExistence(timeout: timeout), "the held run's own words")
        try screenshot("chat-running")
        XCTAssertEqual(
            words.frame.minX, 20, accuracy: 2,
            "while the run follows its end the agent's words keep the transcript's side margin (transcript \(app.scrollViews.firstMatch.frame), words \(words.frame))")

        let field = composer(in: app)
        field.tap()
        field.typeText("And then this")
        let queue = app.buttons["Queue"]
        XCTAssertTrue(queue.waitForExistence(timeout: timeout))
        queue.tap()
        XCTAssertTrue(app.staticTexts["Queued"].waitForExistence(timeout: timeout))
        try screenshot("chat-queued")
        app.buttons["Cancel queued message"].tap()
        XCTAssertTrue(app.staticTexts["Queued"].waitForNonExistence(timeout: timeout))

        app.buttons["Stop"].tap()
        XCTAssertTrue(app.staticTexts["Working"].waitForNonExistence(timeout: timeout), "the run ends on the machine")
        try screenshot("chat-stopped")
    }

    @MainActor
    func test6LaysOutDarkAndAtTheLargestTextSize() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: timeout))
        tab("Settings", in: app)
        app.buttons["Dark"].tap()
        tab("Inbox", in: app)
        app.staticTexts[title].firstMatch.tap()
        XCTAssertTrue(composer(in: app).waitForExistence(timeout: timeout))
        try screenshot("chat-dark")
        app.buttons.matching(identifier: "work.fold").allElementsBoundByIndex.last { $0.isHittable }?.tap()
        try screenshot("chat-dark-work-open")
        try script("ask")
        send("Pick again", in: app)
        XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: timeout))
        try screenshot("chat-dark-ask")
        app.buttons["Retry"].tap()
        XCTAssertTrue(app.buttons["Retry"].waitForNonExistence(timeout: timeout))
        app.buttons["BackButton"].tap()
        tab("Settings", in: app)
        app.buttons["System"].tap()
        app.terminate()

        let large = try openChat(arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        try screenshot("chat-largest-text")
        let mode = large.buttons["Permissions, Ask first"]
        XCTAssertTrue(mode.waitForExistence(timeout: timeout), "the permission mode stays in the composer")
        XCTAssertLessThanOrEqual(mode.frame.maxX, large.buttons["Send"].frame.minX, "and beside the send button, not under it")
        try script("permission")
        send("Clean once more", in: large)
        XCTAssertTrue(large.buttons["Allow"].waitForExistence(timeout: timeout))
        try screenshot("chat-permission-largest-text")
        large.buttons["Allow"].tap()
        XCTAssertTrue(large.buttons["Allow"].waitForNonExistence(timeout: timeout))
    }

    @MainActor
    func test7RenamesTheSession() throws {
        let app = try openChat()
        app.buttons["chat.title"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: timeout))
        field.clearAndType("Release notes, tidied")
        app.alerts.buttons["Rename"].tap()
        XCTAssertTrue(app.staticTexts["Release notes, tidied"].waitForExistence(timeout: timeout))
        try screenshot("chat-renamed")
    }

    @MainActor
    func test8StartsANewSessionFromTheSheet() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: timeout))
        app.buttons["New Session"].tap()
        XCTAssertTrue(app.staticTexts["What should we build"].waitForExistence(timeout: timeout))
        let field = composer(in: app)
        XCTAssertTrue(field.waitForExistence(timeout: timeout))
        try screenshot("new-session")
        field.tap()
        field.typeText("Start the changelog")
        try screenshot("new-session-typed")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.staticTexts["Done."].waitForExistence(timeout: timeout), "the chat opens and its first run answers")
        XCTAssertTrue(app.staticTexts["Start the changelog"].exists)
        try screenshot("new-session-chat")
    }

    @MainActor
    private func openChat(arguments: [String] = []) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += arguments
        app.launch()
        XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: timeout))
        let row = app.staticTexts[title].firstMatch
        let renamed = app.staticTexts["Release notes, tidied"].firstMatch
        for _ in 0..<12 where !(row.waitForExistence(timeout: 2) || renamed.exists) {
            app.collectionViews.firstMatch.swipeUp()
        }
        (row.exists ? row : renamed).tap()
        XCTAssertTrue(composer(in: app).waitForExistence(timeout: timeout), "the chat opens")
        let stop = app.buttons["Stop"]
        if stop.waitForExistence(timeout: 2) {
            stop.tap()
            XCTAssertTrue(stop.waitForNonExistence(timeout: timeout), "a run an earlier test left is stopped first")
        }
        return app
    }

    @MainActor
    private func composer(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["composer"].firstMatch
    }

    @MainActor
    private func send(_ text: String, in app: XCUIApplication) {
        let field = composer(in: app)
        field.tap()
        field.typeText(text)
        app.buttons["Send"].tap()
    }

    private func script(_ scenario: String) throws {
        let session = try XCTUnwrap(environment["BROSKI_E2E_CHAT_SESSION"])
        try command("{\"script\":\(session),\"scenario\":\"\(scenario)\"}")
    }
}

extension XCUIElement {
    /// Replaces whatever the field holds with `text`.
    @MainActor
    func clearAndType(_ text: String) {
        coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        if let value = value as? String, !value.isEmpty {
            typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        typeText(text)
    }
}
