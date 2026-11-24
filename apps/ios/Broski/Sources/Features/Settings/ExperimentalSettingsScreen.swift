import SwiftUI

/// Settings › Experimental: opt-in features that stay off on both phone and Mac until turned on.
struct ExperimentalSettingsScreen: View {
    @Environment(AppModel.self) private var model

    private var remoteScreen: Binding<Bool> {
        Binding(
            get: { model.remoteScreenEnabled },
            set: { model.setRemoteScreenEnabled($0) }
        )
    }

    var body: some View {
        Form {
            Section {
                Toggle("Remote Mac Screen", isOn: remoteScreen)
            } header: {
                Text("Remote Screen")
            } footer: {
                Text("View and control your Mac's screen and answer macOS password or permission prompts over your encrypted Broski link. Off by default on both your phone and Mac. Requires macOS Screen Sharing enabled in System Settings → General → Sharing and your Mac login.")
            }
        }
        .navigationTitle("Experimental")
        .navigationBarTitleDisplayMode(.inline)
    }
}
