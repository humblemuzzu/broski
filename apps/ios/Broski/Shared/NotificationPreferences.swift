import Foundation

/// Which notifications the person wants, kept in the app group's defaults so the notification
/// service extension reads what Settings writes. Every kind is on until turned off, and every
/// session until muted.
nonisolated struct NotificationPreferences {
    static let appGroup = "group.com.muzammil.broski"
    static let needsYou = "notifications.needsYou"
    static let done = "notifications.done"
    static let failures = "notifications.failures"
    /// The muted sessions, each `[machineId, backend, sessionId]`.
    static let muted = "notifications.mutedSessions"

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

    /// `allows(kind:)`, and never for a session the person muted.
    func allows(kind: String, machineId: String?, backend: String?, sessionId: String?) -> Bool {
        guard allows(kind: kind) else { return false }
        guard let machineId, let backend, let sessionId else { return true }
        return !isMuted(machineId: machineId, backend: backend, sessionId: sessionId)
    }

    var mutedSessions: Set<MutedSession> {
        let stored = defaults?.array(forKey: Self.muted) as? [[String]] ?? []
        return Set(stored.compactMap(MutedSession.init(stored:)))
    }

    func isMuted(machineId: String, backend: String, sessionId: String) -> Bool {
        mutedSessions.contains(MutedSession(machineId: machineId, backend: backend, sessionId: sessionId))
    }

    func setMuted(_ muted: Bool, machineId: String, backend: String, sessionId: String) {
        let session = MutedSession(machineId: machineId, backend: backend, sessionId: sessionId)
        var sessions = mutedSessions
        if muted { sessions.insert(session) } else { sessions.remove(session) }
        save(sessions)
    }

    func forgetMachine(_ machineId: String) {
        save(mutedSessions.filter { $0.machineId != machineId })
    }

    func removeSession(machineId: String, backend: String, sessionId: String) {
        setMuted(false, machineId: machineId, backend: backend, sessionId: sessionId)
    }

    func unmuteAll() {
        defaults?.removeObject(forKey: Self.muted)
    }

    private func save(_ sessions: Set<MutedSession>) {
        defaults?.set(sessions.map(\.stored), forKey: Self.muted)
    }

    private func isOn(_ key: String) -> Bool {
        defaults?.object(forKey: key) as? Bool ?? true
    }
}

nonisolated struct MutedSession: Hashable {
    let machineId: String
    let backend: String
    let sessionId: String
}

nonisolated extension MutedSession {
    fileprivate init?(stored: [String]) {
        guard stored.count == 3 else { return nil }
        self.init(machineId: stored[0], backend: stored[1], sessionId: stored[2])
    }

    fileprivate var stored: [String] { [machineId, backend, sessionId] }
}
