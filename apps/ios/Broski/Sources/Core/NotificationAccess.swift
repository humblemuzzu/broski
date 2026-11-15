import Observation
import UIKit
import UserNotifications

/// Whether iOS lets Broski notify. Asking happens once, after the first pairing; whenever iOS
/// allows it, the app registers with APNs (at every launch and return, as Apple asks, which also
/// hands over a changed token).
@Observable
final class NotificationAccess {
    private(set) var status: UNAuthorizationStatus?

    var canAsk: Bool { status == .notDetermined }
    var isAllowed: Bool { status == .authorized || status == .provisional || status == .ephemeral }

    func refresh() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if isAllowed { UIApplication.shared.registerForRemoteNotifications() }
    }

    func ask() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refresh()
    }
}
