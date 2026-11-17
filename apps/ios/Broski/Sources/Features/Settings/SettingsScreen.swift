import BroskiCore
import SwiftUI
import UIKit

/// Notifications (which kinds, kept on this phone), appearance, and about.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @AppStorage(Preference.appearance) private var appearance: Appearance = .system
    @AppStorage(NotificationPreferences.needsYou, store: NotificationPreferences.store)
    private var notifyNeedsYou = true
    @AppStorage(NotificationPreferences.done, store: NotificationPreferences.store)
    private var notifyDone = true
    @AppStorage(NotificationPreferences.failures, store: NotificationPreferences.store)
    private var notifyFailures = true

    var body: some View {
        NavigationStack {
            Form {
                notifications
                Section("Appearance") {
                    Picker("Appearance", selection: $appearance) {
                        ForEach(Appearance.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .haptic(.pickerStep, trigger: appearance)
                }
                Section {
                    NavigationLink {
                        FormattingGalleryScreen()
                    } label: {
                        Label("Formatting", systemImage: "textformat")
                    }
                } footer: {
                    Text("Every kind of text an agent writes, as the chat draws it.")
                }
                about
            }
            .navigationTitle("Settings")
        }
    }

    private var notifications: some View {
        Section {
            if model.notifications.status == .denied {
                Banner(style: .warning, message: "Notifications are off for Broski in iOS Settings.") {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                    }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            } else if model.notifications.canAsk {
                Button("Turn On Notifications") {
                    Task { await model.notifications.ask() }
                }
            }
            Group {
                Toggle("Needs you", isOn: $notifyNeedsYou)
                Toggle("Done", isOn: $notifyDone)
                Toggle("Failures", isOn: $notifyFailures)
            }
            .disabled(model.notifications.status == .denied)
        } header: {
            Text("Notifications")
        } footer: {
            Text("Approvals and questions, finished runs, and runs that failed. Kept on this phone.")
        }
    }

    private var about: some View {
        Section {
            LabeledContent("Broski", value: "\(Bundle.main.appVersion) (\(Bundle.main.buildNumber))")
            LabeledContent("Core", value: coreDescription)
            ForEach(model.machines) { machine in
                LabeledContent(machine.name, value: machine.bridgeVersion.map { "Bridge \($0)" } ?? machine.summary.line)
            }
        } header: {
            Text("About")
        } footer: {
            Label(
                "Everything is end-to-end encrypted between this phone and your Mac. The relay can't read it.",
                systemImage: "lock.fill"
            )
            .padding(.top, Spacing.s)
        }
    }

    private var coreDescription: String {
        let core = coreVersion()
        return "\(core.library) · protocol \(core.protocol.major).\(core.protocol.minor)"
    }
}
