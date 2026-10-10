import UserNotifications

/// Replaces the placeholder text the relay sends with what the machine
/// actually said, without ever letting the plaintext leave this process.
final class NotificationService: UNNotificationServiceExtension {
  private struct Pending {
    let content: UNMutableNotificationContent
    let completion: (UNNotificationContent) -> Void
  }

  private var pending: Pending?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent)
      ?? UNMutableNotificationContent()
    pending = Pending(content: content, completion: contentHandler)
    let push = request.content.userInfo
    if let machineID = push["m"] as? String,
      let item = PushKeychain.item(machineID: machineID)
    {
      describe(content, push: push, machineID: machineID, item: item)
    }
    deliver()
  }

  override func serviceExtensionTimeWillExpire() {
    deliver()
  }

  private func deliver() {
    guard let pending else { return }
    self.pending = nil
    pending.completion(pending.content)
  }

  /// Anything that does not decrypt leaves the relay's generic text in place.
  private func describe(
    _ content: UNMutableNotificationContent,
    push: [AnyHashable: Any],
    machineID: String,
    item: PushKeychainItem
  ) {
    guard let value = push["e"] as? String,
      let body = NotificationCrypto.decodeBase64URL(value)
    else { return }
    if push["k"] as? String == "offline" {
      describeOffline(content, body: body, machineName: item.machineName)
      return
    }
    guard let masterKey = NotificationCrypto.decodeBase64URL(item.key),
      let plaintext = NotificationCrypto.open(
        body,
        key: NotificationCrypto.notifyKey(masterKey: masterKey),
        aad: Data(machineID.utf8)
      ),
      let event = try? JSONSerialization.jsonObject(with: plaintext) as? [String: Any]
    else { return }
    if let title = event["title"] as? String { content.title = title }
    if let text = event["body"] as? String { content.body = text }
    if let session = event["session"] as? String, !session.isEmpty {
      content.threadIdentifier = session
    }
    stash(content, event: event)
  }

  /// The Approve/Deny handler runs in the app, where the ciphertext is never
  /// opened, so the request a decision answers rides on the delivered content.
  private func stash(_ content: UNMutableNotificationContent, event: [String: Any]) {
    for key in ["backend", "session", "request"] {
      if let value = event[key] as? String { content.userInfo[key] = value }
    }
  }

  /// The relay's own alert carries no ciphertext, only which machine went away.
  private func describeOffline(
    _ content: UNMutableNotificationContent,
    body: Data,
    machineName: String
  ) {
    guard let status = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    else { return }
    let state = status["state"] as? String == "asleep" ? "asleep" : "offline"
    content.title = "Broski"
    content.body = "\(machineName) is \(state)"
  }
}
