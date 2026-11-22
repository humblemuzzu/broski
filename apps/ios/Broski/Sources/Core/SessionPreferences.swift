import BroskiCore
import Observation
import os

/// What the person set on single sessions, kept on this phone: the pinned ones (in the keychain
/// with the inbox's state) and the muted ones (in the app group, which the notification service
/// extension reads). Both go when their machine is forgotten or the session is deleted.
@Observable
final class SessionPreferences {
    private(set) var pinned: Set<SessionTarget> = []
    private(set) var muted: Set<SessionTarget> = []

    @ObservationIgnored private var storage: PhoneStorage?
    @ObservationIgnored private let notifications: NotificationPreferences

    init(notifications: NotificationPreferences = NotificationPreferences()) {
        self.notifications = notifications
        muted = Self.targets(notifications.mutedSessions)
    }

    func load(from storage: PhoneStorage) {
        self.storage = storage
        do throws(Keychain.Failure) {
            pinned = try storage.pinnedSessions()
        } catch {
            Logger.core.error("the pinned sessions were not read: \(error.status)")
        }
    }

    func setPinned(_ pin: Bool, _ target: SessionTarget) {
        if pin { pinned.insert(target) } else { pinned.remove(target) }
        savePinned()
    }

    func setMuted(_ mute: Bool, _ target: SessionTarget) {
        notifications.setMuted(
            mute, machineId: target.machineId, backend: target.session.backend, sessionId: target.session.sessionId)
        muted = Self.targets(notifications.mutedSessions)
    }

    func forgetMachine(_ machineId: String) {
        pinned = pinned.filter { $0.machineId != machineId }
        savePinned()
        notifications.forgetMachine(machineId)
        muted = Self.targets(notifications.mutedSessions)
    }

    func removeSession(_ target: SessionTarget) {
        setPinned(false, target)
        notifications.removeSession(
            machineId: target.machineId, backend: target.session.backend, sessionId: target.session.sessionId)
        muted = Self.targets(notifications.mutedSessions)
    }

    /// Start Over: the keychain's pins are already gone with everything else, the mutes go here.
    func forgetAll() {
        pinned = []
        notifications.unmuteAll()
        muted = []
    }

    private func savePinned() {
        do throws(Keychain.Failure) {
            try storage?.savePinnedSessions(pinned)
        } catch {
            Logger.core.error("the pinned sessions were not saved: \(error.status)")
        }
    }

    private static func targets(_ sessions: Set<MutedSession>) -> Set<SessionTarget> {
        Set(sessions.compactMap { SessionTarget(machineId: $0.machineId, backend: $0.backend, sessionId: $0.sessionId) })
    }
}
