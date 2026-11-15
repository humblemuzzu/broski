import XCTest

/// The chat under load: `scripts/e2e-ios-app.sh` has the machine run the session "Read the whole
/// history" 40 times as a terminal would, each run the fake's `work` (its notice, compaction and 24
/// paragraphs stay in the transcript), past 1,000 items in all. XCTest measures flinging through it
/// (the scroll signpost, and hitches where the runtime records them: a simulator records none), older
/// pages loading as the top comes into view, and the app's CPU while a `work` run streams into it.
final class SessionScrollPerformanceTests: XCTestCase {
    private let timeout: TimeInterval = 30
    private let title = "Read the whole history"

    @MainActor
    func test1FlingingThroughAThousandItemsKeepsItsFrames() throws {
        let app = try openLongChat()
        let transcript = app.scrollViews.firstMatch
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTHitchMetric(application: app), XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            transcript.swipeDown(velocity: .fast)
        }
        try screenshot("chat-long-scrolled")

        // Each page lands, moving the loading row off screen, before the next fling: a drag down at
        // the top of a chat opened with the zoom transition dismisses it, as the system's zoom does.
        let first = app.staticTexts["Hi."]
        let loading = app.activityIndicators.firstMatch
        let offScreen = NSPredicate(format: "exists == false OR hittable == false")
        for _ in 0..<80 where !first.exists {
            let landed = XCTNSPredicateExpectation(predicate: offScreen, object: loading)
            XCTAssertEqual(XCTWaiter.wait(for: [landed], timeout: timeout), .completed, "the older page lands")
            transcript.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(first.exists, "every older page loads as the top comes into view, back to the first answer")
        try screenshot("chat-long-older-pages")
    }

    @MainActor
    func test2AWorkRunStreamsIntoALongChatWithoutHitches() throws {
        let app = try openLongChat()
        let field = app.descendants(matching: .any)["composer"].firstMatch
        let session = try XCTUnwrap(environment["BROSKI_E2E_LONG_SESSION"])
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        measure(metrics: [XCTHitchMetric(application: app), XCTCPUMetric(application: app)], options: options) {
            try? command("{\"script\":\(session),\"scenario\":\"work\"}")
            field.tap()
            field.typeText("Once more")
            startMeasuring()
            app.buttons["Send"].tap()
            // The fake streams a run in a moment; the window takes in the stream, the run's end and
            // the newest page read again after it.
            Thread.sleep(forTimeInterval: 2)
            stopMeasuring()
            XCTAssertTrue(app.buttons["Send"].exists, "the run ended")
        }
        try screenshot("chat-long-streamed")
    }

    @MainActor
    private func openLongChat() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launch()
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: timeout))
        row.tap()
        XCTAssertTrue(app.staticTexts["Paragraph 24: what the agent found, streamed in parts."].waitForExistence(timeout: timeout))
        return app
    }
}
