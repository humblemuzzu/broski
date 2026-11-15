import BroskiCore
import Foundation
import Observation
import UIKit

/// One file read from a machine, as the viewer shows it: text, an image, or what it is when it is
/// neither.
@Observable
final class FileModel {
    enum Phase {
        case loading
        case loaded(FileContent)
        case failed(WorkspaceProblem)
    }

    let path: String
    private(set) var phase: Phase = .loading

    @ObservationIgnored private let requests: WorkspaceRequests

    init(path: String, requests: WorkspaceRequests) {
        self.path = path
        self.requests = requests
    }

    var name: String { (path as NSString).lastPathComponent }

    func load() async {
        do throws(WorkspaceProblem) {
            phase = .loaded(FileContent(try await requests.read(path: path)))
        } catch {
            phase = .failed(error)
        }
    }
}

/// What `fs.read` gave, by what the viewer can do with it. The bridge sends UTF-8 without a NUL as
/// text and everything else as base64 (contract §20.1).
enum FileContent {
    case text(TextFile)
    case image(UIImage, size: Int64)
    /// Not text, and not an image the phone can draw (or more of one than a read carries).
    case binary(size: Int64)

    init(_ read: FileRead) {
        switch read.encoding {
        case .utf8:
            self = .text(TextFile(read.content, size: read.size, shown: read.length, truncated: read.truncated))
        case .base64:
            if !read.truncated, let data = Data(base64Encoded: read.content), let image = UIImage(data: data) {
                self = .image(image, size: read.size)
            } else {
                self = .binary(size: read.size)
            }
        }
    }
}

/// A text file split into lines once, for the viewer's numbered rows.
struct TextFile {
    let text: String
    let lines: [Substring]
    /// The whole file's bytes, and how many of them the read carried.
    let size: Int64
    let shown: Int64
    let truncated: Bool

    init(_ text: String, size: Int64, shown: Int64, truncated: Bool) {
        self.text = text
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.count > 1, lines.last?.isEmpty == true { lines.removeLast() }
        self.lines = lines
        self.size = size
        self.shown = shown
        self.truncated = truncated
    }
}
