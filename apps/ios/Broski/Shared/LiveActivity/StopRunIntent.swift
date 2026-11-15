import AppIntents
import Foundation

/// Stop on the Live Activity. A `LiveActivityIntent` runs in the app's process, which hangs its
/// stop on `RunStopper`; the widget extension only draws the button.
struct StopRunIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop Run"
    static let description = IntentDescription("Stops the agent's run on your Mac.")
    static let isDiscoverable = false

    @Parameter(title: "Mac") var machineId: String
    @Parameter(title: "Agent") var backend: String
    @Parameter(title: "Session") var sessionId: String

    init() {}

    init(machineId: String, backend: String, sessionId: String) {
        self.machineId = machineId
        self.backend = backend
        self.sessionId = sessionId
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        await RunStopper.stop?(machineId, backend, sessionId)
        return .result()
    }
}

/// Where the app process puts what Stop does: abort the session's run through the core.
@MainActor
enum RunStopper {
    static var stop: ((_ machineId: String, _ backend: String, _ sessionId: String) async -> Void)?
}
