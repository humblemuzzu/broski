import Foundation

nonisolated extension String {
    /// The last component of a path, or the path itself for `/`.
    var lastPathComponent: String {
        let name = (self as NSString).lastPathComponent
        return name.isEmpty ? self : name
    }

    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
