import SwiftUI
import UIKit

/// Every paired Mac with its link, bridge and agents; pair another, restart a bridge that is down,
/// forget a Mac.
struct MachinesScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.startPairing) private var startPairing
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            if model.discovery.denied {
                Section {
                    Banner(
                        style: .warning,
                        message: "Allow Local Network for Broski in Settings to connect to your Mac directly on this Wi-Fi. Until then the relay carries the connection."
                    ) {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            ForEach(model.machines) { machine in
                MachineSection(machine: machine)
            }
            if !model.unreadablePairings.isEmpty {
                Section {
                    ForEach(model.unreadablePairings, id: \.self) { id in
                        UnreadablePairingRow(id: id)
                    }
                } header: {
                    Text("Can't be read")
                } footer: {
                    Text("This phone can't read these pairings anymore. Forget them, then pair those Macs again.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.machines.isEmpty && model.unreadablePairings.isEmpty {
                ContentUnavailableView {
                    Label("No Macs paired", systemImage: "laptopcomputer")
                } description: {
                    Text("Run broski-link pair on your Mac, then scan its code.")
                }
            }
        }
        .navigationTitle("Machines")
        .haptic(.destructive, trigger: model.machines.count + model.unreadablePairings.count, when: { $1 < $0 })
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Scan Pairing Code", systemImage: "qrcode.viewfinder") { startPairing(.scan) }
                    Button("Paste Pairing Link", systemImage: "doc.on.clipboard") {
                        startPairing(.pasteFromClipboard())
                    }
                } label: {
                    Label("Pair Another Mac", systemImage: "plus")
                }
            }
        }
    }
}

private struct UnreadablePairingRow: View {
    let id: String
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack {
            Text(id.prefix(8))
                .font(.code)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Forget", role: .destructive) {
                model.forgetUnreadablePairing(id: id)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Unreadable pairing \(id.prefix(8))")
    }
}
