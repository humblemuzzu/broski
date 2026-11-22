import BroskiCore
import SwiftUI

/// Settings › About: the version, where the source lives, its licence, and how the link is kept
/// private.
struct AboutScreen: View {
    private static let source = URL(string: "https://github.com/humblemuzzu/broski")!

    var body: some View {
        Form {
            Section {
                VStack(spacing: Spacing.m) {
                    BroskiMark(side: 72)
                    VStack(spacing: Spacing.xxs) {
                        Text("Broski").font(.title2.weight(.semibold))
                        Text("Version \(Bundle.main.appVersion) (\(Bundle.main.buildNumber))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.m)
                .listRowBackground(Color.clear)
            }
            Section {
                Link(destination: Self.source) {
                    LabeledContent("Source Code") {
                        Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(.primary)
                LabeledContent("License", value: "MIT")
            } footer: {
                Label(
                    "Everything between this phone and your Mac is end-to-end encrypted. The relay can't read it.",
                    systemImage: "lock.fill"
                )
                .padding(.top, Spacing.xs)
            }
        }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Settings › Developer: every kind of text an agent writes as the chat draws it, and the versions
/// the phone and each Mac speak.
struct DeveloperScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            Section {
                NavigationLink("Formatting") { FormattingGalleryScreen() }
            } footer: {
                Text("Every kind of text an agent writes, drawn the way the chat draws it.")
            }
            Section("Versions") {
                LabeledContent("Core", value: coreDescription)
                ForEach(model.machines) { machine in
                    LabeledContent(machine.name, value: machine.bridgeVersion.map { "Bridge \($0)" } ?? machine.summary.line)
                }
            }
        }
        .navigationTitle("Developer")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var coreDescription: String {
        let core = coreVersion()
        return "\(core.library) · protocol \(core.protocol.major).\(core.protocol.minor)"
    }
}
