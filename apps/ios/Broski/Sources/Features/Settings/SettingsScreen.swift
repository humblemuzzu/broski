import BroskiCore
import SwiftUI

/// Settings: the paired Macs on top, then what the phone does (notifications, appearance, voice),
/// then about and the developer's tools, with the version beneath.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.startPairing) private var startPairing
    @AppStorage(Preference.appearance) private var appearance: Appearance = .system
    @State private var hasVoiceKey = false

    var body: some View {
        NavigationStack {
            List {
                machines
                Section {
                    NavigationLink {
                        NotificationSettingsScreen()
                    } label: {
                        SettingsRow(title: "Notifications", symbol: "bell.badge.fill", tint: .red, value: notificationsValue)
                    }
                    NavigationLink {
                        AppearanceSettingsScreen()
                    } label: {
                        SettingsRow(title: "Appearance", symbol: "circle.lefthalf.filled", tint: .blue, value: appearance.label)
                    }
                    NavigationLink {
                        VoiceSettingsScreen()
                    } label: {
                        SettingsRow(title: "Voice", symbol: "waveform", tint: .orange, value: hasVoiceKey ? "Grok" : "On device")
                    }
                }
                Section {
                    NavigationLink {
                        AboutScreen()
                    } label: {
                        SettingsRow(title: "About", symbol: "info", tint: .gray)
                    }
                    NavigationLink {
                        DeveloperScreen()
                    } label: {
                        SettingsRow(title: "Developer", symbol: "hammer.fill", tint: .gray)
                    }
                } footer: {
                    Text("Broski \(Bundle.main.appVersion) (\(Bundle.main.buildNumber))")
                        .frame(maxWidth: .infinity)
                        .padding(.top, Spacing.l)
                }
            }
            .listStyle(.insetGrouped)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("Settings")
                        .font(.title3.weight(.bold))
                        .fixedSize()
                        .accessibilityAddTraits(.isHeader)
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .onAppear { hasVoiceKey = VoiceKeyStore().key() != nil }
            .routeDestinations()
        }
    }

    /// Each Mac as its live link, opening Machines; then pairing another.
    private var machines: some View {
        Section {
            ForEach(model.machines) { machine in
                NavigationLink(value: Route.machines) {
                    LinkCard(machine: machine)
                }
                .navigationLinkIndicatorVisibility(.hidden)
                .accessibilityIdentifier("Machines")
            }
            Menu {
                Button("Scan Pairing Code", systemImage: "qrcode.viewfinder") { startPairing(.scan) }
                Button("Paste Pairing Link", systemImage: "doc.on.clipboard") { startPairing(.pasteFromClipboard()) }
            } label: {
                Label(model.machines.isEmpty ? "Pair a Mac" : "Pair Another Mac", systemImage: "plus")
            }
        }
    }

    private var notificationsValue: String {
        switch model.notifications.status {
        case .denied, .notDetermined: "Off"
        default: "On"
        }
    }
}

extension MachineSummary.Health {
    var dot: Color {
        switch self {
        case .ready: Palette.done
        case .settling: .secondary
        case .attention: Palette.caution
        case .revoked: Palette.failed
        }
    }
}

extension Appearance {
    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}
