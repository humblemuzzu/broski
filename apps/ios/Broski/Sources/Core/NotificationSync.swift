import BroskiCore

extension NotificationPreferences {
    /// What one Mac is told: the person's three choices, and the sessions muted on that Mac.
    func notifyPrefs(forMachine machineId: String) -> NotifyPrefs {
        NotifyPrefs(
            needsYou: needsYou, done: done, failures: failures,
            muted: mutedSessions.filter { $0.machineId == machineId }
                .map { BroskiCore.MutedSession(backend: $0.backend, session: $0.sessionId) })
    }
}
