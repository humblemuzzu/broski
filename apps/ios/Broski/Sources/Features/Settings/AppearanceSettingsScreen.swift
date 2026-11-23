import SwiftUI

struct AppearanceSettingsScreen: View {
    @Environment(AppModel.self) private var model
    @AppStorage(Preference.appearance) private var appearance: Appearance = .system
    @AppStorage(Preference.readingSize) private var size = 0
    @AppStorage(Preference.readingDensity) private var densityRaw = ReadingDensity.balanced.rawValue
    @AppStorage(Preference.readingFont) private var fontRaw = ReadingFont.system.rawValue
    @AppStorage(Preference.readingInlineCode) private var inlineCodeRaw = InlineCodeStyle.plain.rawValue
    @AppStorage(Preference.readingDarkCanvas) private var darkCanvasRaw = DarkCanvas.pureBlack.rawValue
    @AppStorage(Preference.readingWrapsCode) private var wrapsCode = false
    @AppStorage(Preference.readingUnderlinesLinks) private var underlinesLinks = false

    private static let sample = """
        ## Fixed the reconnect test

        The route race now cancels the loser **before** it resumes, so the queue replays once. \
        See [the change](https://github.com) in `route_race.rs:42`.

        - **Clean inline code:** `set_model` and `compact` read without heavy boxes
          - Nested points stay airy with clear rhythm
        - **True OLED black:** high-contrast typography on pure black

        ```rust
        if generation < self.generation { return Vec::new(); }
        ```
        """

    private var density: Binding<ReadingDensity> {
        Binding(
            get: { ReadingDensity(rawValue: densityRaw) ?? .balanced },
            set: { densityRaw = $0.rawValue }
        )
    }

    private var font: Binding<ReadingFont> {
        Binding(
            get: { ReadingFont(rawValue: fontRaw) ?? .system },
            set: { fontRaw = $0.rawValue }
        )
    }

    private var inlineCode: Binding<InlineCodeStyle> {
        Binding(
            get: { InlineCodeStyle(rawValue: inlineCodeRaw) ?? .plain },
            set: { inlineCodeRaw = $0.rawValue }
        )
    }

    private var darkCanvas: Binding<DarkCanvas> {
        Binding(
            get: { DarkCanvas(rawValue: darkCanvasRaw) ?? .pureBlack },
            set: { darkCanvasRaw = $0.rawValue }
        )
    }

    private var previewSettings: ReadingSettings {
        ReadingSettings(
            sizeSteps: size,
            density: density.wrappedValue,
            font: font.wrappedValue,
            inlineCode: inlineCode.wrappedValue,
            darkCanvas: darkCanvas.wrappedValue,
            wrapsCode: wrapsCode,
            underlinesLinks: underlinesLinks)
    }

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
                Picker("Dark Background", selection: darkCanvas) {
                    ForEach(DarkCanvas.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                Picker("Keep Screen Awake", selection: keepScreenAwake) {
                    ForEach(KeepScreenAwake.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
            } footer: {
                Text("True Black uses pure #000000 for OLED contrast. Dictating always keeps the screen awake.")
            }

            Section {
                Stepper(value: $size, in: ReadingSettings.sizeRange) {
                    LabeledContent("Text Size", value: sizeLabel)
                }
                Picker("Spacing", selection: density) {
                    ForEach(ReadingDensity.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                Picker("Font", selection: font) {
                    ForEach(ReadingFont.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                Picker("Inline Code", selection: inlineCode) {
                    ForEach(InlineCodeStyle.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                Toggle("Wrap Code Blocks", isOn: $wrapsCode)
                Toggle("Underline Links", isOn: $underlinesLinks)
            } header: {
                Text("Reading & Typography")
            } footer: {
                Text("Adjusts body size, line breathing, typeface, and inline code presentation across every chat and tool report.")
            }

            Section("Live Preview") {
                FormattedText(text: Self.sample, menu: false)
                    .environment(\.reading, previewSettings)
                    .padding(.vertical, Spacing.m)
                    .padding(.horizontal, Spacing.xs)
                    .listRowBackground(Palette.canvas(for: darkCanvas.wrappedValue))
            }
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var keepScreenAwake: Binding<KeepScreenAwake> {
        Binding(get: { model.keepScreenAwake }, set: { model.keepScreenAwake = $0 })
    }

    private var sizeLabel: String {
        let pt = FormatRole.page.baseSize + CGFloat(size)
        let formatted = pt.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(pt)) pt" : String(format: "%.1f pt", pt)
        return size == 0 ? "\(formatted) (Default)" : formatted
    }
}
