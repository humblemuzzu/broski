import SwiftUI
import UIKit

/// Settings › Notifications: whether iOS lets Broski notify, which alerts the person wants, and the
/// Live Activity. The choices are kept in the app group the notification service extension reads and
/// handed to every Mac, which then never sends what is off, even with the app closed.
struct NotificationSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @AppStorage(NotificationPreferences.needsYou, store: NotificationPreferences.store)
    private var notifyNeedsYou = true
    @AppStorage(NotificationPreferences.done, store: NotificationPreferences.store)
    private var notifyDone = true
    @AppStorage(NotificationPreferences.failures, store: NotificationPreferences.store)
    private var notifyFailures = true
    @AppStorage(NotificationPreferences.liveActivity, store: NotificationPreferences.store)
    private var liveActivity = true

    var body: some View {
        Form {
            if model.notifications.status == .denied {
                Section {
                    Banner(style: .warning, message: "Notifications are off for Broski in iOS Settings.") {
                        Button("Open Settings") { openSettings(UIApplication.openNotificationSettingsURLString) }
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
                Toggle("Finished", isOn: $notifyDone)
                Toggle("Failed", isOn: $notifyFailures)
            } footer: {
                Text(
                    "Needs you is an approval, a question or a plan. Failed is a run that stopped with an error or at a limit, or a Mac that went offline. A muted session never alerts."
                )
            }
            .disabled(model.notifications.status == .denied)
            Section {
                Toggle("Live Activity", isOn: $liveActivity)
                if !model.notifications.liveActivitiesAllowed {
                    Button("Open Live Activity Settings") { openSettings(UIApplication.openSettingsURLString) }
                }
            } footer: {
                Text(
                    model.notifications.liveActivitiesAllowed
                        ? "Shows the agents that are working on the Lock Screen and in the Dynamic Island."
                        : "Live Activities are off for Broski in iOS Settings.")
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.notifications.refresh() }
        .onChange(of: notifyNeedsYou) { model.syncNotifications() }
        .onChange(of: notifyDone) { model.syncNotifications() }
        .onChange(of: notifyFailures) { model.syncNotifications() }
        .onChange(of: liveActivity) { model.syncNotifications() }
    }

    private func openSettings(_ url: String) {
        if let url = URL(string: url) { openURL(url) }
    }
}
