import Foundation

/// Which notifications the person wants, kept in the app group's defaults so the notification
/// service extension reads what Settings writes. Every kind is on until turned off.
nonisolated struct NotificationPreferences {
    static let appGroup = "group.com.muzammil.broski"
    static let needsYou = "notifications.needsYou"
    static let done = "notifications.done"
    static let failures = "notifications.failures"

    /// The app group's defaults; `nil` only in a build without the app group entitlement.
    nonisolated(unsafe) static let store = UserDefaults(suiteName: appGroup)

    let defaults: UserDefaults?

    init(defaults: UserDefaults? = NotificationPreferences.store) {
        self.defaults = defaults
    }

    /// Whether a push of `kind` (push.md: `approval`, `attention`, `done`; the relay's own
    /// `offline`) should alert. No push says a run failed, so Failures governs the relay's alert
    /// that a machine went offline or to sleep, the one failure a push reports.
    func allows(kind: String) -> Bool {
        switch kind {
        case "approval", "attention": isOn(Self.needsYou)
        case "done": isOn(Self.done)
        case "offline": isOn(Self.failures)
        default: true
        }
    }

    private func isOn(_ key: String) -> Bool {
        defaults?.object(forKey: key) as? Bool ?? true
    }
}
