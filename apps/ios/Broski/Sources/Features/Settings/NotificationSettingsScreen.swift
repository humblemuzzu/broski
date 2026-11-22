import SwiftUI
import UIKit

/// Settings › Notifications: whether iOS lets Broski notify, and which kinds the person wants,
/// kept on this phone in the app group the notification service extension reads.
struct NotificationSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @AppStorage(NotificationPreferences.needsYou, store: NotificationPreferences.store)
    private var notifyNeedsYou = true
    @AppStorage(NotificationPreferences.done, store: NotificationPreferences.store)
    private var notifyDone = true
    @AppStorage(NotificationPreferences.failures, store: NotificationPreferences.store)
    private var notifyFailures = true

    var body: some View {
        Form {
            if model.notifications.status == .denied {
                Section {
                    Banner(style: .warning, message: "Notifications are off for Broski in iOS Settings.") {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            } else if model.notifications.canAsk {
                Section {
                    Button("Turn On Notifications") {
                        Task { await model.notifications.ask() }
                    }
                }
            }
            Section {
                Toggle("Needs you", isOn: $notifyNeedsYou)
                Toggle("Done", isOn: $notifyDone)
                Toggle("Failures", isOn: $notifyFailures)
            } footer: {
                Text("Approvals and questions, finished runs, and a Mac that went offline. Muted sessions never alert.")
            }
            .disabled(model.notifications.status == .denied)
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }
}
