import Foundation

nonisolated extension String {
    /// The last component of a path, or the path itself for `/`.
    var lastPathComponent: String {
        let name = (self as NSString).lastPathComponent
        return name.isEmpty ? self : name
    }

    /// The folder a path is in.
    var parentPath: String { (self as NSString).deletingLastPathComponent }

    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
