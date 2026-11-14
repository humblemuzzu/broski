import Flutter
import Foundation
import UIKit
import UserNotifications

/// The app side of push: categories, the APNs device token, and the
/// Approve/Deny decisions taken straight from the lock screen.
final class PushNotifications: NSObject {
  static let shared = PushNotifications()

  static let channelName = "broski/push"

  private enum Category {
    static let approval = "approval"
    static let attention = "attention"
    static let done = "done"
    static let offline = "offline"

    static let all = [approval, attention, done, offline]
  }

  private enum Decision: String {
    case allow
    case deny
  }

  private var channel: FlutterMethodChannel?
  private var token: String?
  private let taps = NotificationTapChannel()

  /// Wires up the Dart side. A push that arrives before the engine is up is
  /// still shown; the channel only serves the token.
  func attach(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: Self.channelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }
    self.channel = channel
    taps.attach(messenger: messenger)
  }

  func received(deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    token = hex
    channel?.invokeMethod("onToken", arguments: hex)
  }

  /// Our own events are already on screen as a live stream, so a foreground
  /// banner for one is noise. Every other notification keeps its banner.
  func presentationOptions(for notification: UNNotification) -> UNNotificationPresentationOptions {
    let category = notification.request.content.categoryIdentifier
    return Category.all.contains(category) ? [] : [.banner, .badge, .sound]
  }

  /// Runs for a lock-screen action as well as for a tap: only Approve and Deny
  /// carry a decision; a tap on the notification itself opens the session it
  /// names, and anything else is done the moment it arrives. False for a
  /// response that is not one of our pushes, which is left to the plugins.
  func decide(
    _ response: UNNotificationResponse,
    completionHandler: @escaping () -> Void
  ) -> Bool {
    let content = response.notification.request.content
    guard content.userInfo["m"] is String else { return false }
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
      taps.tapped(content.userInfo)
    }
    guard let decision = Decision(rawValue: response.actionIdentifier),
      let machineID = content.userInfo["m"] as? String
    else {
      completionHandler()
      return true
    }
    send(
      decision,
      machineID: machineID,
      push: content.userInfo,
      completionHandler: completionHandler
    )
    return true
  }

  /// One sealed letter to the relay, which hands it to the machine whenever it
  /// is awake — no session needed, so the decision holds while the Mac sleeps.
  private func send(
    _ decision: Decision,
    machineID: String,
    push: [AnyHashable: Any],
    completionHandler: @escaping () -> Void
  ) {
    guard let item = PushKeychain.item(machineID: machineID),
      let relay = item.relay,
      let relayToken = item.relayToken,
      let url = lettersURL(from: relay),
      let letter = letter(decision, item: item, machineID: machineID, push: push)
    else {
      completionHandler()
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue(machineID, forHTTPHeaderField: "x-broski-machine")
    request.setValue(item.deviceID, forHTTPHeaderField: "x-broski-device")
    request.setValue("Bearer \(relayToken)", forHTTPHeaderField: "authorization")
    request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
    request.timeoutInterval = 20
    request.httpBody = letter
    URLSession.shared.dataTask(with: request) { _, _, _ in
      completionHandler()
    }.resume()
  }

  /// The decision body: sealed so the relay only moves it, and bound to the
  /// request it answers so a replay cannot approve something else.
  private func letter(
    _ decision: Decision,
    item: PushKeychainItem,
    machineID: String,
    push: [AnyHashable: Any]
  ) -> Data? {
    guard let masterKey = NotificationCrypto.decodeBase64URL(item.key) else {
      return nil
    }
    let body: [String: Any] = [
      "v": 1,
      "id": NotificationCrypto.randomID(),
      "at": Int(Date().timeIntervalSince1970 * 1000),
      "kind": "decision",
      "backend": push["backend"] as? String ?? "",
      "session": push["session"] as? String ?? "",
      "request": push["request"] as? String ?? "",
      "decision": decision.rawValue,
    ]
    guard let json = try? JSONSerialization.data(withJSONObject: body) else { return nil }
    return NotificationCrypto.sealLetter(
      json,
      masterKey: masterKey,
      aad: Data("\(machineID):\(item.deviceID)".utf8)
    )
  }

  /// The relay's letter endpoint. The stored relay is a base, and the device
  /// socket drops its path the same way, so only scheme, host and port are kept.
  private func lettersURL(from relay: String) -> URL? {
    guard let base = URLComponents(string: relay),
      let host = base.host
    else { return nil }
    var letters = URLComponents()
    switch base.scheme {
    case "ws": letters.scheme = "http"
    case "wss": letters.scheme = "https"
    default: return nil
    }
    letters.host = host
    letters.port = base.port
    letters.path = "/v1/letters"
    return letters.url
  }

  /// Approve needs an unlocked device: the action is authentication-required
  /// and never foreground, so it works from the lock screen.
  func registerCategories() {
    let approve = UNNotificationAction(
      identifier: Decision.allow.rawValue,
      title: "Approve",
      options: [.authenticationRequired]
    )
    let deny = UNNotificationAction(
      identifier: Decision.deny.rawValue,
      title: "Deny",
      options: [.authenticationRequired]
    )
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(
        identifier: Category.approval,
        actions: [approve, deny],
        intentIdentifiers: []
      ),
      UNNotificationCategory(
        identifier: Category.attention,
        actions: [],
        intentIdentifiers: []
      ),
      UNNotificationCategory(
        identifier: Category.done,
        actions: [],
        intentIdentifiers: []
      ),
      UNNotificationCategory(
        identifier: Category.offline,
        actions: [],
        intentIdentifiers: []
      ),
    ])
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "getApnsToken":
      result(token)
    case "keychainGroup":
      result(PushKeychain.accessGroup)
    case "register":
      DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
        result(nil)
      }
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

/// Hands the session a tapped push names, and the machine it came from (the
/// relay's `m`), to Dart: now when Dart is listening, otherwise as soon as it
/// asks, which is how a tap that launched the app reaches it.
final class NotificationTapChannel {
  static let channelName = "broski/notification_taps"

  private var channel: FlutterMethodChannel?
  private var listening = false
  private var pending: [String: String]?

  func attach(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: Self.channelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "takeTap" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.listening = true
      result(self?.pending)
      self?.pending = nil
    }
    self.channel = channel
  }

  func tapped(_ userInfo: [AnyHashable: Any]) {
    var tap: [String: String] = [:]
    for key in ["backend", "session", "request"] {
      if let value = userInfo[key] as? String { tap[key] = value }
    }
    if let machine = userInfo["m"] as? String { tap["machine"] = machine }
    guard tap["backend"] != nil, tap["session"] != nil else { return }
    if listening, let channel {
      channel.invokeMethod("onTap", arguments: tap)
    } else {
      pending = tap
    }
  }
}
