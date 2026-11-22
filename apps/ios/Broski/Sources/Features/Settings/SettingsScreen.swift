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
            .navigationTitle("Settings")
            .onAppear { hasVoiceKey = VoiceKeyStore().key() != nil }
        }
    }

    /// Each Mac with how it is connected, opening Machines; then pairing another.
    private var machines: some View {
        Section {
            ForEach(model.machines) { machine in
                NavigationLink {
                    MachinesScreen()
                } label: {
                    MachineCardRow(machine: machine)
                }
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

/// A paired Mac at the top of Settings: its name, and how it is connected beside a dot of its
/// health.
private struct MachineCardRow: View {
    let machine: MachineModel
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 44

    private var summary: MachineSummary { machine.summary }

    var body: some View {
        HStack(spacing: Spacing.m) {
            Image(systemName: "laptopcomputer")
                .font(.system(size: side * 0.42, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: side, height: side)
                .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: side * 0.26, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(machine.name)
                    .font(.headline)
                    .lineLimit(1)
                HStack(spacing: Spacing.xs + Spacing.xxs) {
                    Circle().fill(summary.health.dot).frame(width: 7, height: 7)
                    Text(summary.line)
                        .lineLimit(1)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
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
