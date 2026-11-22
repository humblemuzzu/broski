import Foundation

/// How a Mac's name reads on the phone. A pairing made before the daemon named Macs by their
/// Computer Name carries the network host name ("Studio-MacBook-Pro-5.local"), which reads as
/// "Studio MacBook Pro 5"; a name the person chose is shown as it is.
nonisolated enum MachineName {
    static func display(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasSuffix(".local") else { return trimmed }
        let host = trimmed.dropLast(".local".count)
        let words = host.split(separator: "-").joined(separator: " ")
        return words.isEmpty ? trimmed : words
    }
}
