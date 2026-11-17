import SwiftUI

/// Settings › Reading, as the formatter's views read them: text size on top of the system's,
/// compact spacing, code that wraps, underlined links.
struct ReadingSettings: Equatable {
    /// Dynamic Type steps added to the system's size, from -2 to +3.
    var sizeSteps = 0
    var compact = false
    var wrapsCode = false
    var underlinesLinks = false

    static let sizeRange = -2...3
}

extension EnvironmentValues {
    @Entry var reading = ReadingSettings()
}

extension View {
    /// Hands the reader's settings, kept in `UserDefaults`, to every formatter view below.
    func readingSettings() -> some View {
        modifier(ReadingSettingsReader())
    }

    /// Agent text at the reader's chosen size: the system's Dynamic Type size moved by their steps.
    func readingTextSize() -> some View {
        modifier(ReadingTextSize())
    }
}

private struct ReadingSettingsReader: ViewModifier {
    @AppStorage(Preference.readingSize) private var size = 0
    @AppStorage(Preference.readingCompact) private var compact = false
    @AppStorage(Preference.readingWrapsCode) private var wrapsCode = false
    @AppStorage(Preference.readingUnderlinesLinks) private var underlinesLinks = false

    func body(content: Content) -> some View {
        content.environment(
            \.reading,
            ReadingSettings(sizeSteps: size, compact: compact, wrapsCode: wrapsCode, underlinesLinks: underlinesLinks))
    }
}

private struct ReadingTextSize: ViewModifier {
    @Environment(\.reading) private var reading
    @Environment(\.dynamicTypeSize) private var system

    func body(content: Content) -> some View {
        let sizes = DynamicTypeSize.allCases
        let index = sizes.firstIndex(of: system) ?? sizes.firstIndex(of: .large) ?? 0
        let moved = min(max(index + reading.sizeSteps, 0), sizes.count - 1)
        content.dynamicTypeSize(sizes[moved])
    }
}
