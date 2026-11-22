#if PUSH_ONLY
import BroskiPush
#else
import BroskiCore
#endif
import Foundation
import UserNotifications

/// What a relay push shows once opened on the phone (push.md). The relay sends a placeholder
/// alert with `m` (the machine id), `k` (the kind) and `e`: the machine's sealed payload, or for
/// the relay's own `offline` alert a plain JSON of the machine's state. Compiled into the app and
/// its notification service extension.
nonisolated enum PushContent {
    enum Category {
        /// A permission ask with a request to answer: Allow and Deny.
        static let approval = "approval"
        static let attention = "attention"
        static let done = "done"
        static let offline = "offline"
    }

    /// Replaces the relay's placeholder in `content` with what the machine said, threads it by
    /// session, and copies what a tap or a decision needs into `userInfo` (`machine`, `backend`,
    /// `session`, `request`). A kind the person turned off, or a push for a session they muted,
    /// arrives quietly: dropping a push needs the filtering entitlement Apple grants on request. A
    /// push that does not open keeps the relay's generic text.
    static func describe(
        _ content: UNMutableNotificationContent, records: MachineRecordStore, preferences: NotificationPreferences
    ) {
        let push = content.userInfo
        guard let machineId = push["m"] as? String, let kind = push["k"] as? String,
            let payload = push["e"] as? String
        else { return }
        if !preferences.allows(kind: kind) { quiet(content) }
        // The relay names the category after the kind; Allow and Deny only go on a push that
        // opened with a request to answer.
        content.categoryIdentifier = ""
        guard let bytes = try? records.record(id: machineId), let record = try? MachineRecord.fromBytes(bytes: bytes)
        else { return }
        content.userInfo["machine"] = machineId
        if kind == "offline" {
            describeOffline(content, payload: payload, machineId: machineId, name: record.name())
        } else if let notification = try? openNotification(record: record, data: payload) {
            describe(content, notification, machineId: machineId)
            let allowed = preferences.allows(
                kind: kind, machineId: machineId, backend: notification.backend, sessionId: notification.session)
            if !allowed { quiet(content) }
        }
    }

    private static func quiet(_ content: UNMutableNotificationContent) {
        content.interruptionLevel = .passive
        content.sound = nil
    }

    private static func describe(
        _ content: UNMutableNotificationContent, _ notification: PushNotification, machineId: String
    ) {
        content.title = notification.title
        content.body = notification.body
        content.subtitle = notification.machine
        content.threadIdentifier = "\(machineId)/\(notification.session)"
        switch notification.kind {
        case "approval" where notification.request != nil: content.categoryIdentifier = Category.approval
        case "approval", "attention": content.categoryIdentifier = Category.attention
        default: content.categoryIdentifier = notification.kind
        }
        content.userInfo["backend"] = notification.backend
        content.userInfo["session"] = notification.session
        if let request = notification.request { content.userInfo["request"] = request }
    }

    /// The relay's alert carries no secret, only `{"machine","state","since"}`.
    private static func describeOffline(
        _ content: UNMutableNotificationContent, payload: String, machineId: String, name: String
    ) {
        guard let data = Data(base64URLEncoded: payload),
            let alert = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        content.title = alert["state"] as? String == "asleep" ? "\(name) is asleep" : "\(name) is offline"
        content.body = "Broski reconnects when it's back."
        content.threadIdentifier = machineId
        content.categoryIdentifier = Category.offline
    }
}

extension Data {
    /// Base64url without padding, as the relay writes it.
    nonisolated init?(base64URLEncoded text: String) {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }
}
