import Observation
import UserNotifications

/// Whether iOS lets Broski notify. Asking happens once, after the first pairing; registering with
/// APNs and handling pushes is the notifications feature's.
@Observable
final class NotificationAccess {
    private(set) var status: UNAuthorizationStatus?

    var canAsk: Bool { status == .notDetermined }
    var isAllowed: Bool { status == .authorized || status == .provisional || status == .ephemeral }

    func refresh() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func ask() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refresh()
    }
}
