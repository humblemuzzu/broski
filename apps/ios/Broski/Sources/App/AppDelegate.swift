import UIKit
import os

/// What only a `UIApplicationDelegate` hears: the APNs device token.
final class AppDelegate: NSObject, UIApplicationDelegate {
    weak var push: PushNotifications?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push?.received(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        Logger.core.error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
    }
}
