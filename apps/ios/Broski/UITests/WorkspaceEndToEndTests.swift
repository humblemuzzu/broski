import XCTest

/// The Workspace tab against the real machine, after the pairing tests: `scripts/e2e-ios-app.sh`
/// makes `project/` in the served root (`BROSKI_E2E_ROOT`) a git repository with one commit,
/// `notes.md` modified since, `todo.txt` untracked, and a second branch `feature`.
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
    func test2OpensATerminalRunsACommandAndComesBackToIt() throws {
        let output = URL(fileURLWithPath: try root).appending(path: "broski.txt")
        try? FileManager.default.removeItem(at: output)
        let app = XCUIApplication()
        app.launch()
        tab("Workspace", in: app)
        let new = app.buttons["New Terminal"]
        XCTAssertTrue(new.waitForExistence(timeout: timeout))
        new.tap()

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
        XCTAssertTrue(running.waitForExistence(timeout: timeout))
        try screenshot("workspace-terminals")
        running.tap()
        XCTAssertTrue(terminalView(in: app).waitForExistence(timeout: timeout))
        sleep(2)
        try screenshot("terminal-reattached")
    }

    @MainActor
    func test3LaysOutInDarkAndAtTheLargestTextSize() throws {
        let app = XCUIApplication()
        app.launch()
        tab("Settings", in: app)
        app.buttons["Dark"].tap()
        try openProject(in: app, mode: "dark")
        app.buttons.matching(label: "File, notes.md").firstMatch.tap()
        XCTAssertTrue(element(in: app, "Line 1: one").waitForExistence(timeout: timeout))
        try screenshot("file-dark")
        back(in: app)
        app.buttons.matching(label: "feature").firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(label: "Untracked, todo.txt").firstMatch.waitForExistence(timeout: timeout))
        try screenshot("git-dark")
        back(in: app)
        back(in: app)
        back(in: app)
        app.buttons["New Terminal"].tap()
        XCTAssertTrue(terminalView(in: app).waitForExistence(timeout: timeout))
        sleep(2)
        try screenshot("terminal-dark")
        back(in: app)
        tab("Settings", in: app)
        app.buttons["System"].tap()
        app.terminate()

        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        try openProject(in: app, mode: "largest-text")
        app.buttons.matching(label: "feature").firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(label: "Untracked, todo.txt").firstMatch.waitForExistence(timeout: timeout))
        try screenshot("git-largest-text")
    }

    /// Workspace → the served root → project, a screenshot of each.
    @MainActor
    private func openProject(in app: XCUIApplication, mode: String) throws {
        tab("Workspace", in: app)
        let rootName = URL(fileURLWithPath: try root).lastPathComponent
        let home = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Folder, ' AND label ENDSWITH %@", rootName))
            .firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: timeout))
        try screenshot("workspace-\(mode)")
        home.tap()
        let project = app.buttons.matching(label: "Folder, project").firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: timeout))
        try screenshot("files-\(mode)")
        project.tap()
        XCTAssertTrue(app.buttons.matching(label: "File, notes.md").firstMatch.waitForExistence(timeout: timeout))
        try screenshot("folder-\(mode)")
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
