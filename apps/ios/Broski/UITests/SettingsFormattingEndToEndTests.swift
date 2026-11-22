import XCTest

/// Settings › Formatting on a paired phone (run after `PairingEndToEndTests/test1…` through
/// `scripts/e2e-ios-app.sh`): every sample, scrolled through page by page, in light and dark, at the
/// default text size and at AX3, upright and sideways; the table viewer and an expanded code block.
/// The screenshots are the proof of how agent text looks, judged by looking at them.
/// `BROSKI_GALLERY_QUICK` (as `TEST_RUNNER_BROSKI_GALLERY_QUICK`) shoots light, default size, upright only.
final class SettingsFormattingEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 20
    /// A page past this many is never needed: the longest sample is about seven screens at AX3.
    private let maxPages = 14

    private let samples = [
        "Written for the phone", "A long explainer", "Written for a terminal", "An agent's answer", "Tables", "Lists and tasks", "Quotes and callouts", "Links and paths", "Code",
        "Inline edge cases", "Thinking", "A subagent's report", "Languages and scripts", "Headings",
        "Cut mid-stream", "Big tables", "Agent quirks",
    ]

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
    }

    @MainActor
    func test1EverySampleInEveryAppearanceSizeAndOrientation() throws {
        let quick = environment["BROSKI_GALLERY_QUICK"] != nil
        let appearances = quick ? ["light"] : ["light", "dark"]
        let sizes = quick ? [("default", "UICTContentSizeCategoryL")] : [("default", "UICTContentSizeCategoryL"), ("ax3", "UICTContentSizeCategoryAccessibilityXL")]
        let orientations: [UIDeviceOrientation] = quick ? [.portrait] : [.portrait, .landscapeLeft]
        for appearance in appearances {
            for (size, category) in sizes {
                for orientation in orientations {
                    let app = XCUIApplication()
                    app.launchArguments += ["-appearance", appearance, "-UIPreferredContentSizeCategoryName", category]
                    app.launch()
                    XCUIDevice.shared.orientation = orientation
                    let name = orientation == .portrait ? "portrait" : "landscape"
                    try shootGallery(app, prefix: "\(device)-\(appearance)-\(size)-\(name)")
                    app.terminate()
                }
            }
        }
    }

    private var device: String {
        UIDevice.current.name.lowercased().replacingOccurrences(of: " ", with: "-")
    }

    @MainActor
    private func shootGallery(_ app: XCUIApplication, prefix: String) throws {
        tab("Settings", in: app)
        let developer = app.buttons["Developer"]
        if !developer.waitForExistence(timeout: timeout) { app.swipeUp() }
        developer.tap()
        let formatting = app.buttons["Formatting"]
        XCTAssertTrue(formatting.waitForExistence(timeout: timeout), app.debugDescription)
        formatting.tap()
        for (index, title) in samples.enumerated() {
            let row = app.buttons[title]
            var tries = 0
            while !row.isHittable && tries < 6 {
                app.swipeUp()
                tries += 1
            }
            row.tap()
            let page = app.scrollViews["gallery-sample-scroll"]
            XCTAssertTrue(page.waitForExistence(timeout: timeout))
            let label = String(format: "%02d-%@", index + 1, slug(title))
            try shootPages(page, name: "\(prefix)-\(label)")
            if title == "Tables" { try shootViewer(app, button: "Expand table", name: "\(prefix)-\(label)-viewer") }
            if title == "Code" { try shootViewer(app, button: "Expand", name: "\(prefix)-\(label)-expanded") }
            app.buttons["BackButton"].firstMatch.tap()
        }
        app.buttons["BackButton"].firstMatch.tap()
        app.buttons["BackButton"].firstMatch.tap()
    }

    /// One screenshot per screen, scrolling until the page stops moving.
    @MainActor
    private func shootPages(_ page: XCUIElement, name: String) throws {
        var last = Data()
        for number in 1...maxPages {
            let png = XCUIScreen.main.screenshot().pngRepresentation
            if png == last { return }
            try save(png, name: "\(name)-p\(number)")
            last = png
            page.swipeUp(velocity: .slow)
        }
    }

    @MainActor
    private func shootViewer(_ app: XCUIApplication, button: String, name: String) throws {
        let page = app.scrollViews["gallery-sample-scroll"]
        page.swipeDown(velocity: .fast)
        page.swipeDown(velocity: .fast)
        let open = app.buttons[button].firstMatch
        var tries = 0
        while !open.isHittable && tries < 6 {
            page.swipeUp(velocity: .slow)
            tries += 1
        }
        open.tap()
        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: timeout))
        try save(XCUIScreen.main.screenshot().pngRepresentation, name: name)
        done.tap()
    }

    private func save(_ png: Data, name: String) throws {
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        add(attachment)
        if let directory = environment["BROSKI_E2E_SCREENSHOTS"] {
            let folder = URL(fileURLWithPath: directory).appending(path: "formatting")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try png.write(to: folder.appending(path: "\(name).png"))
        }
    }

    private func slug(_ title: String) -> String {
        title.lowercased().filter { $0.isLetter || $0 == " " }.replacingOccurrences(of: " ", with: "-")
    }
}
