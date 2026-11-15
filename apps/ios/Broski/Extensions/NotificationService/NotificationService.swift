import UserNotifications

/// Opens each Broski push with the machine's record from the shared keychain group, so the
/// plaintext never leaves the phone, and hands the system what the machine said.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        PushContent.describe(content, records: MachineRecordStore(), preferences: NotificationPreferences())
        contentHandler(content)
    }
}
