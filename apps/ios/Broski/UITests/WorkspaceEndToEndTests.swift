import XCTest

/// A session's files against the real machine, after the pairing tests. The chat's Files button opens
/// the folder the session runs in, the served root (`BROSKI_E2E_ROOT`), where `scripts/e2e-ios-app.sh`
/// makes `project/` a git repository with one commit, `notes.md` modified since, `todo.txt`
/// untracked, and a second branch `feature`.
final class WorkspaceEndToEndTests: XCTestCase {
    private let timeout: TimeInterval = 30

    override func setUp() {
        continueAfterFailure = false
    }

    private var root: String {
        get throws { try XCTUnwrap(environment["BROSKI_E2E_ROOT"], "run through scripts/e2e-ios-app.sh") }
    }

    @MainActor
    func test1BrowsesReadsDiffsStagesAndCommits() throws {
        let app = XCUIApplication()
        app.launch()
        try openProject(in: app, mode: "light")

        app.buttons.matching(label: "File, notes.md").firstMatch.tap()
        XCTAssertTrue(element(in: app, "Line 1: one").waitForExistence(timeout: timeout))
        try screenshot("file-light")
        back(in: app)

        app.buttons.matching(label: "main").firstMatch.tap()
        let modified = app.buttons.matching(label: "Modified, notes.md").firstMatch
        XCTAssertTrue(modified.waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons.matching(label: "Untracked, todo.txt").firstMatch.exists)
        try screenshot("git-light")

        modified.tap()
        XCTAssertTrue(element(in: app, "Added: two").waitForExistence(timeout: timeout))
        try screenshot("diff-light")
        back(in: app)

        modified.swipeLeft()
        app.buttons["Stage"].tap()
        XCTAssertTrue(app.buttons["Unstage All"].waitForExistence(timeout: timeout), "notes.md is staged")
        let message = app.textFields["Commit message"]
        message.tap()
        message.typeText("Update the notes")
        app.buttons["Commit"].tap()
        XCTAssertTrue(app.staticTexts["Update the notes"].waitForExistence(timeout: timeout), "the commit is in the log")
        XCTAssertFalse(app.buttons.matching(label: "Modified, notes.md").firstMatch.exists)
        try screenshot("git-committed")

        app.buttons.matching(label: "main").firstMatch.tap()
        let feature = app.buttons.matching(label: "feature").firstMatch
        XCTAssertTrue(feature.waitForExistence(timeout: timeout))
        try screenshot("branches-light")
        feature.tap()
        app.buttons["Switch Branch"].tap()
        XCTAssertTrue(
            app.buttons.matching(label: "main").firstMatch.waitForExistence(timeout: timeout),
            "main is a branch to switch to, so feature is current")
        try screenshot("branches-switched")
        back(in: app)
        XCTAssertTrue(app.buttons.matching(label: "feature").firstMatch.waitForExistence(timeout: timeout), "the repository is on feature")
    }

    @MainActor
    func test2OpensATerminalInAFolderAndComesBackToItFromThere() throws {
        let output = URL(fileURLWithPath: try root).appending(path: "project/broski.txt")
        try? FileManager.default.removeItem(at: output)
        let app = XCUIApplication()
        app.launch()
        try openProject(in: app, mode: "terminal")
        openTerminalHere(in: app)

        let terminal = terminalView(in: app)
        XCTAssertTrue(terminal.waitForExistence(timeout: timeout))
        XCTAssertTrue(app.buttons["Escape"].exists && app.buttons["Up Arrow"].exists && app.buttons["Control"].exists)
        terminal.tap()
        sleep(2)
        app.typeText("echo broski | tee broski.txt\n")
        XCTAssertTrue(waitForFile(output, containing: "broski\n"), "the shell on the machine ran what was typed")
        sleep(1)
        try screenshot("terminal-light")

        back(in: app)
        let running = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Running'")).firstMatch
        XCTAssertTrue(running.waitForExistence(timeout: timeout), "the folder lists the terminal opened in it")
        try screenshot("folder-terminals")
        running.tap()
        XCTAssertTrue(terminalView(in: app).waitForExistence(timeout: timeout))
        sleep(2)
        try screenshot("terminal-reattached")
    }

    @MainActor
    func test3LaysOutInDarkAndAtTheLargestTextSize() throws {
        let app = XCUIApplication()
        app.launch()
        setAppearance("Dark", in: app)
        try openProject(in: app, mode: "dark")
        app.buttons.matching(label: "File, notes.md").firstMatch.tap()
        XCTAssertTrue(element(in: app, "Line 1: one").waitForExistence(timeout: timeout))
        try screenshot("file-dark")
        back(in: app)
        app.buttons.matching(label: "feature").firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(label: "Untracked, todo.txt").firstMatch.waitForExistence(timeout: timeout))
        try screenshot("git-dark")
        back(in: app)
        openTerminalHere(in: app)
        XCTAssertTrue(terminalView(in: app).waitForExistence(timeout: timeout))
        sleep(2)
        try screenshot("terminal-dark")
        app.terminate()
        app.launch()
        setAppearance("System", in: app)
        app.terminate()

        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        try openProject(in: app, mode: "largest-text")
        app.buttons.matching(label: "feature").firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(label: "Untracked, todo.txt").firstMatch.waitForExistence(timeout: timeout))
        try screenshot("git-largest-text")
    }

    /// A session seeded in the served root, fresh so it is near the top of the inbox whatever ran
    /// before → its chat → Files, its folder → project, a screenshot of each.
    @MainActor
    private func openProject(in app: XCUIApplication, mode: String) throws {
        tab("Inbox", in: app)
        let session = "Files in \(mode)"
        try command(#"{"seed":"\#(session)"}"#)
        let row = app.staticTexts[session].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: timeout))
        row.tap()
        let more = app.buttons["More"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: timeout))
        more.tap()
        let files = app.buttons["Files"]
        XCTAssertTrue(files.waitForExistence(timeout: timeout), "a session's overflow opens its folder")
        files.tap()
        let project = app.buttons.matching(label: "Folder, project").firstMatch
        XCTAssertTrue(reveal(project, in: app), "the folder opens")
        try screenshot("files-\(mode)")
        project.tap()
        XCTAssertTrue(reveal(app.buttons.matching(label: "File, notes.md").firstMatch, in: app))
        try screenshot("folder-\(mode)")
        reveal(app.buttons.matching(label: "feature").firstMatch, in: app, down: true)
    }

    /// Scrolls until `element` is on screen: the terminals the earlier tests opened under a folder
    /// are listed above its files, and at the largest text size they fill the screen.
    @MainActor
    @discardableResult
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, down: Bool = false) -> Bool {
        for _ in 0..<6 where !element.exists {
            if down { app.swipeDown() } else { app.swipeUp() }
        }
        return element.waitForExistence(timeout: timeout)
    }

    @MainActor
    private func openTerminalHere(in app: XCUIApplication) {
        app.buttons["More"].firstMatch.tap()
        let here = app.buttons["Open Terminal Here"]
        XCTAssertTrue(here.waitForExistence(timeout: timeout))
        here.tap()
    }

    @MainActor
    private func back(in app: XCUIApplication) {
        app.buttons["BackButton"].firstMatch.tap()
    }

    @MainActor
    private func terminalView(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "terminal").firstMatch
    }

    @MainActor
    private func element(in app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func waitForFile(_ url: URL, containing text: String) -> Bool {
        for _ in 0..<Int(timeout) {
            if let data = try? Data(contentsOf: url), String(decoding: data, as: UTF8.self) == text { return true }
            sleep(1)
        }
        return false
    }
}

extension XCUIElementQuery {
    /// Elements whose label starts with `label`: a row's label goes on with its details.
    func matching(label: String) -> XCUIElementQuery {
        matching(NSPredicate(format: "label BEGINSWITH %@", label))
    }
}
