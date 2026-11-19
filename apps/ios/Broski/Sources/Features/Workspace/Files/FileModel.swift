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
        phase = .loading
        if isImagePath(path: path) {
            do throws(WorkspaceProblem) {
                let imageRead = try await requests.image(path: path, variant: .full)
                let decoded = try? await ChatImageStore.decodeFullImage(
                    base64: imageRead.data,
                    mimeType: imageRead.mimeType,
                    width: imageRead.width.map(Int.init),
                    height: imageRead.height.map(Int.init),
                    byteCount: imageRead.size)
                if let decoded {
                    phase = .loaded(.image(decoded))
                } else {
                    phase = .loaded(.binary(size: imageRead.size))
                }
                return
            } catch {
                // Fall back to `fs.read` if the file was invalid_input (e.g. a non-image file with a misleading extension).
                if error.code != .invalidInput {
                    phase = .failed(error)
                    return
                }
            }
        }
        do throws(WorkspaceProblem) {
            phase = .loaded(FileContent(try await requests.read(path: path)))
        } catch {
            phase = .failed(error)
        }
    }
}

/// What `fs.read` or `fs.image` gave, by what the viewer can do with it.
enum FileContent {
    case text(TextFile)
    case image(FullImagePayload)
    /// Not text, and not an image the phone can draw (or more of one than a read carries).
    case binary(size: Int64)

    init(_ read: FileRead) {
        switch read.encoding {
        case .utf8:
            self = .text(TextFile(read.content, size: read.size, shown: read.length, truncated: read.truncated))
        case .base64:
            if !read.truncated, let data = Data(base64Encoded: read.content), let image = UIImage(data: data) {
                let payload = FullImagePayload(
                    image: image,
                    data: data,
                    mimeType: "image/png",
                    pixelWidth: Int(image.size.width * image.scale),
                    pixelHeight: Int(image.size.height * image.scale),
                    byteCount: read.size,
                    hasAlpha: ChatImageStore.hasAlpha(image))
                self = .image(payload)
            } else {
                self = .binary(size: read.size)
            }
        }
    }
}

/// A text file as read, and how much of it the read carried.
struct TextFile {
    let text: String
    /// The whole file's bytes, and how many of them the read carried.
    let size: Int64
    let shown: Int64
    let truncated: Bool

    init(_ text: String, size: Int64, shown: Int64, truncated: Bool) {
        self.text = text
        self.size = size
        self.shown = shown
        self.truncated = truncated
    }
}
