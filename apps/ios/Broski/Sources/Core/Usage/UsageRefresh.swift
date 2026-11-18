import BackgroundTasks
import os

/// The background refresh that keeps the widgets' plan usage current while Broski is closed. iOS
/// runs it when it judges best, at the earliest half an hour after it is asked.
enum UsageRefresh {
    static let taskId = "com.muzammil.broski.usage-refresh"
    static let interval: TimeInterval = 30 * 60
    /// How long a refresh waits for a Mac to connect before giving up until the next one.
    static let connectTimeout: Duration = .seconds(20)

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = .now.addingTimeInterval(interval)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Logger.core.error("the usage refresh was not scheduled: \(error.localizedDescription, privacy: .public)")
        }
    }
}
