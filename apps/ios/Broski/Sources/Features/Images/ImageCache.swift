import BroskiCore
import Foundation
import ImageIO
import Observation
import SwiftUI
import UIKit

/// What a thumbnail or the full-screen viewer displays: a local photo on this phone, an image stored
/// inside a session (`attachment.read`), or an image file on the Mac (`fs.image`).
nonisolated enum ImageTarget: Hashable, Identifiable, Sendable {
    case local(id: String, name: String?)
    case attachment(ImageRef)
    case file(path: String, name: String?)

    var id: String {
        switch self {
        case .local(let id, _): "local:\(id)"
        case .attachment(let ref): "att:\(ref.id)"
        case .file(let path, _): "file:\(path)"
        }
    }

    var displayName: String {
        switch self {
        case .local(_, let name): name ?? "Image"
        case .attachment(let ref): ref.name ?? "Image"
        case .file(let path, let name): name ?? (path as NSString).lastPathComponent
        }
    }

    var filePath: String? {
        if case .file(let path, _) = self { return path }
        return nil
    }
}

/// Decoded full image held while the viewer is open, including its original encoded bytes for Share/Save.
struct FullImagePayload {
    let image: UIImage
    let data: Data
    let mimeType: String
    let pixelWidth: Int
    let pixelHeight: Int
    let byteCount: Int64
    let hasAlpha: Bool
}

enum ThumbnailState {
    case idle
    case loading
    case loaded(UIImage)
    case failed(String)
}

/// Memory-bounded thumbnail cache + on-demand full-resolution loader for one chat session.
@Observable
final class ChatImageStore {
    /// Incremented whenever any thumbnail finishes loading or fails, so only affected views refresh.
    private(set) var revision = 0

    @ObservationIgnored private let thumbnails = NSCache<NSString, UIImage>()
    @ObservationIgnored private var localFull: [String: FullImagePayload] = [:]
    @ObservationIgnored private var localFullOrder: [String] = []
    @ObservationIgnored private var sentByRequest: [String: [FullImagePayload]] = [:]
    @ObservationIgnored private var failedReasons: [String: String] = [:]
    @ObservationIgnored private var inFlight: Set<String> = []
    private static let maxLocalFull = 24
    @ObservationIgnored private let requests: ChatRequests
    @ObservationIgnored private let workspace: WorkspaceRequests
    @ObservationIgnored private let currentSession: () -> SessionRef

    init(requests: ChatRequests, workspace: WorkspaceRequests, session: @escaping () -> SessionRef) {
        self.requests = requests
        self.workspace = workspace
        self.currentSession = session
        thumbnails.countLimit = 48
        thumbnails.totalCostLimit = 24 * 1_048_576
    }

    func thumbnailState(for target: ImageTarget) -> ThumbnailState {
        let key = target.id
        if let image = thumbnails.object(forKey: key as NSString) { return .loaded(image) }
        if let local = localFull[key] { return .loaded(local.image) }
        if let reason = failedReasons[key] { return .failed(reason) }
        if inFlight.contains(key) { return .loading }
        return .idle
    }

    func cachedThumbnail(for target: ImageTarget) -> UIImage? {
        thumbnails.object(forKey: target.id as NSString) ?? localFull[target.id]?.image
    }

    /// Registers a composer image before sending so pending bubbles and composer previews are instant.
    func registerLocal(_ composerImage: ComposerImage) {
        let key = ImageTarget.local(id: composerImage.id.uuidString, name: composerImage.content.name).id
        storeThumbnail(composerImage.thumbnail, forKey: key)
        if let data = Data(base64Encoded: composerImage.content.data), let full = UIImage(data: data) {
            storeLocalFull(payload(image: full, data: data, mimeType: composerImage.content.mimeType, byteCount: Int64(data.count)), forKey: key)
        }
    }

    private func storeLocalFull(_ payload: FullImagePayload, forKey key: String) {
        localFull[key] = payload
        if let idx = localFullOrder.firstIndex(of: key) { localFullOrder.remove(at: idx) }
        localFullOrder.append(key)
        while localFullOrder.count > Self.maxLocalFull {
            let evicted = localFullOrder.removeFirst()
            localFull.removeValue(forKey: evicted)
        }
    }

    /// Remembers the images attached to an outgoing prompt so confirmed `ImageRef`s inherit them with zero flicker.
    func rememberOutgoing(requestId: String, images: [ComposerImage]) {
        guard !images.isEmpty else { return }
        var payloads: [FullImagePayload] = []
        for image in images {
            registerLocal(image)
            if let data = Data(base64Encoded: image.content.data), let full = UIImage(data: data) {
                payloads.append(payload(image: full, data: data, mimeType: image.content.mimeType, byteCount: Int64(data.count)))
            }
        }
        if !payloads.isEmpty { sentByRequest[requestId] = payloads }
        if sentByRequest.count > 16 {
            for key in sentByRequest.keys.prefix(sentByRequest.count - 16) { sentByRequest.removeValue(forKey: key) }
        }
    }

    /// Binds locally sent images to the confirmed `ImageRef` ids returned by the bridge.
    func bindConfirmed(requestId: String, attachments: [AttachmentRef]) {
        guard let payloads = sentByRequest[requestId] else { return }
        let refs = attachments.compactMap { if case .imageRef(let ref) = $0 { ref } else { nil } }
        guard !refs.isEmpty else { return }
        for (index, ref) in refs.enumerated() where index < payloads.count {
            let item = payloads[index]
            let key = ImageTarget.attachment(ref).id
            storeThumbnail(item.image, forKey: key)
            storeLocalFull(item, forKey: key)
            failedReasons.removeValue(forKey: key)
        }
        revision += 1
    }

    func loadThumbnail(for target: ImageTarget, force: Bool = false) async {
        let key = target.id
        if case .local = target { return }
        if !force {
            if thumbnails.object(forKey: key as NSString) != nil || inFlight.contains(key) || failedReasons[key] != nil {
                return
            }
        }
        failedReasons.removeValue(forKey: key)
        inFlight.insert(key)
        revision += 1
        defer {
            inFlight.remove(key)
            revision += 1
        }
        do {
            let decoded: UIImage?
            switch target {
            case .local:
                return
            case .attachment(let ref):
                let read = try await requests.attachment(currentSession(), id: ref.id, variant: .thumbnail)
                decoded = await Self.decodeThumbnail(base64: read.image.data, maxPixelSize: 512)
            case .file(let path, _):
                let read = try await workspace.image(path: path, variant: .thumbnail)
                decoded = await Self.decodeThumbnail(base64: read.data, maxPixelSize: 512)
            }
            if let decoded {
                storeThumbnail(decoded, forKey: key)
            } else {
                failedReasons[key] = "Couldn't decode image."
            }
        } catch let error as ChatProblem {
            failedReasons[key] = error.message
        } catch let error as WorkspaceProblem {
            failedReasons[key] = error.message
        } catch {
            failedReasons[key] = "Couldn't load image."
        }
    }

    /// Retries thumbnails that failed while offline once the Mac reconnects.
    func retryFailed() {
        guard !failedReasons.isEmpty else { return }
        failedReasons.removeAll()
        revision += 1
    }

    func loadFull(for target: ImageTarget) async throws(ImageLoadError) -> FullImagePayload {
        if let local = localFull[target.id] { return local }
        switch target {
        case .local:
            throw ImageLoadError(message: "This image is no longer in memory.")
        case .attachment(let ref):
            let read: AttachmentRead
            do {
                read = try await requests.attachment(currentSession(), id: ref.id, variant: .full)
            } catch {
                throw ImageLoadError(message: error.message)
            }
            return try await decodeFull(
                base64: read.image.data,
                mimeType: read.image.mimeType,
                width: read.width.map(Int.init),
                height: read.height.map(Int.init),
                byteCount: read.originalBytes)
        case .file(let path, _):
            return try await Self.fetchWorkspaceImage(path: path, workspace: workspace)
        }
    }

    static func fetchWorkspaceImage(path: String, workspace: WorkspaceRequests) async throws(ImageLoadError) -> FullImagePayload {
        let read: FileImageRead
        do {
            read = try await workspace.image(path: path, variant: .full)
        } catch {
            let message = error.code == .notFound ? "This image isn't on your Mac anymore." : error.message
            throw ImageLoadError(message: message)
        }
        return try await Self.decodeFullImage(
            base64: read.data,
            mimeType: read.mimeType,
            width: read.width.map(Int.init),
            height: read.height.map(Int.init),
            byteCount: read.size)
    }

    private func decodeFull(
        base64: String, mimeType: String, width: Int?, height: Int?, byteCount: Int64?
    ) async throws(ImageLoadError) -> FullImagePayload {
        try await Self.decodeFullImage(base64: base64, mimeType: mimeType, width: width, height: height, byteCount: byteCount)
    }

    private func storeThumbnail(_ image: UIImage, forKey key: String) {
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        thumbnails.setObject(image, forKey: key as NSString, cost: max(cost, 1))
    }

    private func payload(image: UIImage, data: Data, mimeType: String, byteCount: Int64) -> FullImagePayload {
        FullImagePayload(
            image: image,
            data: data,
            mimeType: mimeType,
            pixelWidth: Int(image.size.width * image.scale),
            pixelHeight: Int(image.size.height * image.scale),
            byteCount: byteCount,
            hasAlpha: Self.hasAlpha(image))
    }

    nonisolated static func decodeThumbnail(base64: String, maxPixelSize: Int) async -> UIImage? {
        await Task.detached(priority: .utility) {
            guard let data = Data(base64Encoded: base64) else { return nil }
            return downsample(data: data, maxPixelSize: maxPixelSize) ?? UIImage(data: data)
        }.value
    }

    nonisolated static func decodeFullImage(
        base64: String, mimeType: String, width: Int?, height: Int?, byteCount: Int64?
    ) async throws(ImageLoadError) -> FullImagePayload {
        let decoded = await Task.detached(priority: .userInitiated) { () -> FullImagePayload? in
            guard let data = Data(base64Encoded: base64) else { return nil }
            let image: UIImage? =
                mimeType == "image/gif"
                ? (animatedGif(data: data) ?? UIImage(data: data))
                : (downsample(data: data, maxPixelSize: 3072) ?? UIImage(data: data))
            guard let image else { return nil }
            let pxW = width ?? Int(image.size.width * image.scale)
            let pxH = height ?? Int(image.size.height * image.scale)
            return FullImagePayload(
                image: image,
                data: data,
                mimeType: mimeType,
                pixelWidth: max(pxW, 1),
                pixelHeight: max(pxH, 1),
                byteCount: byteCount ?? Int64(data.count),
                hasAlpha: hasAlpha(image))
        }.value
        guard let decoded else { throw ImageLoadError(message: "Broski couldn't decode this image.") }
        return decoded
    }

    nonisolated private static func downsample(data: Data, maxPixelSize: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }

    nonisolated private static func animatedGif(data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 1 else { return nil }
        let limit = min(count, 60)
        var frames: [UIImage] = []
        var duration: Double = 0
        for index in 0..<limit {
            guard let cg = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
            frames.append(UIImage(cgImage: cg))
            duration += gifFrameDelay(source: source, index: index)
        }
        guard !frames.isEmpty else { return nil }
        return UIImage.animatedImage(with: frames, duration: max(duration, 0.1))
    }

    nonisolated private static func gifFrameDelay(source: CGImageSource, index: Int) -> Double {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
            let gif = props[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        else { return 0.1 }
        let raw = (gif[kCGImagePropertyGIFUnclampedDelayTime] as? Double)
            ?? (gif[kCGImagePropertyGIFDelayTime] as? Double)
            ?? 0.1
        return raw < 0.02 ? 0.1 : raw
    }

    nonisolated static func hasAlpha(_ image: UIImage) -> Bool {
        guard let info = image.cgImage?.alphaInfo else { return false }
        switch info {
        case .first, .last, .premultipliedFirst, .premultipliedLast, .alphaOnly: return true
        default: return false
        }
    }
}

struct ImageLoadError: Error {
    let message: String
}

/// Environment entry giving any row in a chat access to the chat's image cache and full-screen viewer.
extension EnvironmentValues {
    @Entry var chatImages: ChatImageStore?
}
