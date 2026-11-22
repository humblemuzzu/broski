import BroskiCore
import Foundation
import UIKit
import UserNotifications
import os

/// The app's side of push: the categories (Allow and Deny on an approval), the APNs token every
/// machine registers, a tap that opens the session, a lock-screen decision sealed by the core and
/// posted to the relay, and which pushes show while the app is in front.
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    enum Action {
        static let allow = "allow"
        static let deny = "deny"
    }

    /// The APNs device token, hex, once iOS hands it over.
    private(set) var token: String?
    /// Every token iOS hands over, the first and each change; every machine registers it.
    var tokenChanged: (String) -> Void = { _ in }
    /// A tapped push's session.
    var opened: (SessionTarget) -> Void = { _ in }
    /// The session on screen, whose pushes do not banner.
    var visibleSession: () -> SessionTarget? = { nil }

    private let records: MachineRecordStore
    private let letters: LetterPost

    init(records: MachineRecordStore, letters: LetterPost = LetterPost()) {
        self.records = records
        self.letters = letters
    }

    /// Takes the notification center's delegate and sets the categories; called at launch, before
    /// the app finishes launching, so a tap that launched it still arrives.
    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let allow = UNNotificationAction(identifier: Action.allow, title: "Allow", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: Action.deny, title: "Deny", options: [.destructive])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: PushContent.Category.approval, actions: [allow, deny], intentIdentifiers: []),
            UNNotificationCategory(identifier: PushContent.Category.attention, actions: [], intentIdentifiers: []),
            UNNotificationCategory(identifier: PushContent.Category.done, actions: [], intentIdentifiers: []),
            UNNotificationCategory(identifier: PushContent.Category.offline, actions: [], intentIdentifiers: []),
        ])
    }

    func received(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard hex != token else { return }
        token = hex
        tokenChanged(hex)
    }

    // On the main actor, so the completion handler UIKit wraps around these runs on the main
    // thread: a nonisolated one finished on a background thread, which UIKit aborts on.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let push = PushTarget(notification.request.content.userInfo)
        return presentation(push, passive: notification.request.content.interruptionLevel == .passive)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await respond(response.actionIdentifier, to: PushTarget(response.notification.request.content.userInfo))
    }

    private func presentation(_ push: PushTarget, passive: Bool) -> UNNotificationPresentationOptions {
        if let session = push.session, session == visibleSession() { return [] }
        return passive ? [.list] : [.banner, .list, .sound]
    }

    private func respond(_ action: String, to push: PushTarget) async {
        switch action {
        case Action.allow: await decide(.allow, on: push)
        case Action.deny: await decide(.deny, on: push)
        case UNNotificationDefaultActionIdentifier: push.session.map(opened)
        default: break
        }
    }

    /// Seals the decision for the push's machine and posts it as the core says, under a background
    /// task so a decision from the lock screen finishes after the app is suspended again.
    private func decide(_ decision: PushDecision, on push: PushTarget) async {
        let application = UIApplication.shared
        let task = application.beginBackgroundTask(withName: "Broski decision")
        defer { application.endBackgroundTask(task) }
        guard let machineId = push.machineId, let backend = push.backend, let session = push.sessionId,
            let bytes = try? records.record(id: machineId), let record = try? MachineRecord.fromBytes(bytes: bytes)
        else {
            Logger.core.error("a decision named no machine this phone keeps")
            return
        }
        do {
            let letter = try decisionLetter(
                record: record, decision: decision, backend: backend, session: session, request: push.request)
            try await letters.send(letter)
            Logger.core.info("a decision reached the relay")
        } catch {
            Logger.core.error("a decision was not sent: \(String(describing: error), privacy: .public)")
            await DecisionFailure.post(machineName: record.name(), push: push)
        }
    }
}

/// What a tap or a decision needs from a push, as the notification service extension left it in
/// `userInfo` (the relay's `m` names the machine when nothing opened).
nonisolated struct PushTarget: Sendable {
    let machineId: String?
    let backend: String?
    let sessionId: String?
    let request: String?

    init(_ userInfo: [AnyHashable: Any]) {
        machineId = userInfo["machine"] as? String ?? userInfo["m"] as? String
        backend = userInfo["backend"] as? String
        sessionId = userInfo["session"] as? String
        request = userInfo["request"] as? String
    }

    var userInfo: [String: String] {
        ["machine": machineId, "backend": backend, "session": sessionId, "request": request].compactMapValues(\.self)
    }

    @MainActor var session: SessionTarget? {
        guard let machineId, let backend, let sessionId else { return nil }
        return SessionTarget(machineId: machineId, backend: backend, sessionId: sessionId)
    }
}

/// A decision that did not reach the relay is said at once, so the person answers in the app.
private enum DecisionFailure {
    static func post(machineName: String, push: PushTarget) async {
        let content = UNMutableNotificationContent()
        content.title = "Your answer didn't reach \(machineName)"
        content.body = "Open Broski to answer there."
        content.userInfo = push.userInfo
        content.threadIdentifier = [push.machineId, push.sessionId].compactMap(\.self).joined(separator: "/")
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// The relay's letter endpoint, reached exactly as `decisionLetter` says: its URL, its headers,
/// its body, untouched.
struct LetterPost {
    struct Refused: Error {
        let status: Int
    }

    var session = URLSession.shared

    func send(_ letter: LetterRequest) async throws {
        guard let url = URL(string: letter.url) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        for header in letter.headers {
            request.setValue(header.value, forHTTPHeaderField: header.name)
        }
        let (_, response) = try await session.upload(for: request, from: letter.body)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Refused(status: status) }
    }
}
