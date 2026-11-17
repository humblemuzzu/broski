import SwiftUI

/// Settings › Reading: how agents' text reads, on top of the system's text size, with a sample
/// that shows each change as it is made.
struct ReadingSettingsScreen: View {
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
                Stepper(value: $size, in: ReadingSettings.sizeRange) {
                    LabeledContent("Text size", value: sizeWords)
                }
                Toggle("Compact spacing", isOn: $compact)
                Toggle("Wrap code", isOn: $wrapsCode)
                Toggle("Underline links", isOn: $underlinesLinks)
            } footer: {
                Text("Text size adds to the size you chose for the whole phone in Settings › Display & Brightness.")
            }
            Section("Preview") {
                FormattedText(text: Self.sample, menu: false)
                    .padding(.vertical, Spacing.s)
            }
        }
        .navigationTitle("Reading")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var sizeWords: String {
        switch size {
        case 0: "As the system"
        case ..<0: "\(size)"
        default: "+\(size)"
        }
    }
}
