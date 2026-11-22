import SwiftUI

/// Settings › Appearance: light or dark, keeping the screen awake, and how agents' text reads on
/// top of the system's text size, with a sample that shows each change as it is made.
struct AppearanceSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Preference.appearance) private var appearance: Appearance = .system
    @AppStorage(Preference.readingSize) private var size = 0
    @AppStorage(Preference.readingCompact) private var compact = false
    @AppStorage(Preference.readingWrapsCode) private var wrapsCode = false
    @AppStorage(Preference.readingUnderlinesLinks) private var underlinesLinks = false

    private static let sample = """
        ## Fixed the reconnect test

        The route race now cancels the loser **before** it resumes, so the queue is replayed once. \
        See [the change](https://github.com) in `route_race.rs`.

        - Added a paused-clock test
        - Ran it 50 times in a row

        ```rust
        if generation < self.generation { return Vec::new(); }
        ```
        """

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(Appearance.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .haptic(.pickerStep, trigger: appearance)
                Picker("Keep Screen Awake", selection: keepScreenAwake) {
                    ForEach(KeepScreenAwake.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
            } footer: {
                Text("Dictating always keeps the screen awake.")
            }
            Section {
                Stepper(value: $size, in: ReadingSettings.sizeRange) {
                    LabeledContent("Text Size", value: sizeWords)
                }
                Toggle("Compact Spacing", isOn: $compact)
                Toggle("Wrap Code", isOn: $wrapsCode)
                Toggle("Underline Links", isOn: $underlinesLinks)
            } header: {
                Text("Reading")
            } footer: {
                Text("Text size adds to the size set for the whole phone.")
            }
            Section("Preview") {
                FormattedText(text: Self.sample, menu: false)
                    .padding(.vertical, Spacing.s)
            }
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var keepScreenAwake: Binding<KeepScreenAwake> {
        Binding(get: { model.keepScreenAwake }, set: { model.keepScreenAwake = $0 })
    }

    private var sizeWords: String {
        switch size {
        case 0: "Default"
        case ..<0: "\(size)"
        default: "+\(size)"
        }
    }
}
