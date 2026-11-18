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

    /// Whether this path is `folder` or lies under it; `/work` is not under `/w`.
    func isWithin(_ folder: String) -> Bool {
        self == folder || hasPrefix(folder.hasSuffix("/") ? folder : folder + "/")
    }

    /// This path with `home` written `~`, as a terminal shows it.
    func abbreviatingHome(_ home: String?) -> String {
        guard let home, home != "/", isWithin(home) else { return self }
        return "~" + dropFirst(home.count)
    }

    /// The folders this path lies in, nearest first, up to `/`.
    var ancestorPaths: [String] {
        var paths: [String] = []
        var path = self
        while path != "/", !path.isEmpty {
            path = path.parentPath
            paths.append(path.isEmpty ? "/" : path)
        }
        return paths
    }
}
