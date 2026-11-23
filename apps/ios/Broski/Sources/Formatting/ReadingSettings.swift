import SwiftUI

struct ReadingSettings: Equatable {
    /// Steps added to the base size (-2...+4, 1 pt per step).
    var sizeSteps = 0
    var density: ReadingDensity = .balanced
    var font: ReadingFont = .system
    var inlineCode: InlineCodeStyle = .plain
    var darkCanvas: DarkCanvas = .pureBlack
    var wrapsCode = false
    var underlinesLinks = false

    static let sizeRange = -2...4

    var compact: Bool { density == .compact }

    var bodyPointOffset: CGFloat { CGFloat(sizeSteps) }
}

extension EnvironmentValues {
    @Entry var reading = ReadingSettings()
}

extension View {
    func readingSettings() -> some View {
        modifier(ReadingSettingsReader())
    }

    func readingTextSize() -> some View {
        self
    }
}

private struct ReadingSettingsReader: ViewModifier {
    @AppStorage(Preference.readingSize) private var size = 0
    @AppStorage(Preference.readingCompact) private var legacyCompact = false
    @AppStorage(Preference.readingDensity) private var densityRaw = ""
    @AppStorage(Preference.readingFont) private var fontRaw = ReadingFont.system.rawValue
    @AppStorage(Preference.readingInlineCode) private var inlineCodeRaw = InlineCodeStyle.plain.rawValue
    @AppStorage(Preference.readingDarkCanvas) private var darkCanvasRaw = DarkCanvas.pureBlack.rawValue
    @AppStorage(Preference.readingWrapsCode) private var wrapsCode = false
    @AppStorage(Preference.readingUnderlinesLinks) private var underlinesLinks = false

    func body(content: Content) -> some View {
        let density = ReadingDensity(rawValue: densityRaw) ?? (legacyCompact ? .compact : .balanced)
        let settings = ReadingSettings(
            sizeSteps: min(max(size, ReadingSettings.sizeRange.lowerBound), ReadingSettings.sizeRange.upperBound),
            density: density,
            font: ReadingFont(rawValue: fontRaw) ?? .system,
            inlineCode: InlineCodeStyle(rawValue: inlineCodeRaw) ?? .plain,
            darkCanvas: DarkCanvas(rawValue: darkCanvasRaw) ?? .pureBlack,
            wrapsCode: wrapsCode,
            underlinesLinks: underlinesLinks)
        content.environment(\.reading, settings)
    }
}
