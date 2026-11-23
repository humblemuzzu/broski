import BroskiCore
import Foundation
import Observation

/// Live Activity observation, notification preference sync, and answered-alert dismissal for `AppModel`.
extension AppModel {
    /// The Live Activity follows the inbox and each machine's state for the life of the phone.
    func followLiveRuns() {
        let liveRuns = LiveRuns()
        liveRuns.setForeground(isActive)
        liveRuns.onPushToken = { [weak self] token in
            self?.machines.forEach { $0.registerLiveActivity(token) }
        }
        if let token = liveRuns.currentPushToken {
            machines.forEach { $0.registerLiveActivity(token) }
        }
        liveRuns.setEnabled(notificationPreferences.liveActivity)
        self.liveRuns = liveRuns
        Task { [weak self] in
            guard let self else { return }
            for await (rows, brands, ready, settling, muted) in Observations({
                (
                    self.inbox.rows, self.brands, self.reachableMachineIds, self.settlingMachineIds,
                    self.sessionPreferences.muted
                )
            }) {
                liveRuns.follow(rows, brands: brands, readyMachines: ready, settlingMachines: settling, muted: muted)
            }
        }
    }

    /// Settings › Notifications and a session's mute reach every Mac, which then sends only what the
    /// person wants, and the Live Activity follows its own switch. Called when a choice changes.
    func syncNotifications() {
        machines.forEach { $0.syncNotifications(notificationPreferences) }
        liveRuns?.setEnabled(notificationPreferences.liveActivity)
    }

    /// A mute is a choice made outside Settings: the Macs hear of it too.
    func followNotificationPreferences() {
        Task { [weak self] in
            guard let self else { return }
            for await _ in Observations({ self.sessionPreferences.muted }) {
                syncNotifications()
            }
        }
    }

    /// Approvals and questions left on the lock screen come down once their session stops waiting.
    func followAnsweredAlerts() {
        Task { [weak self] in
            guard let self else { return }
            for await (rows, ready) in Observations({ (self.inbox.rows, self.reachableMachineIds) }) {
                let known = rows.filter { !$0.cached && ready.contains($0.machineId) }
                await push.clearAnswered(
                    waiting: Set(known.filter { $0.state == .needsYou }.map(\.target)),
                    known: Set(known.map(\.target)))
            }
        }
    }
}
