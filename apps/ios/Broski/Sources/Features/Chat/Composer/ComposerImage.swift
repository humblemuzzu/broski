import BroskiCore
import UIKit

/// An image the person attached: the JPEG the prompt carries and a small thumbnail for the strip.
nonisolated struct ComposerImage: Identifiable, Equatable, Sendable {
    let id: UUID
    let thumbnail: UIImage
    let content: ImageContent

    static func == (lhs: ComposerImage, rhs: ComposerImage) -> Bool { lhs.id == rhs.id }

    /// The base64 characters it adds to the prompt.
    var cost: Int { content.data.utf8.count }
}

/// Fits a picked image into what a prompt may carry: the images of one prompt hold at most 4 MiB of
/// base64 together (contract §10, `MAX_IMAGE_CHARS`). A photo is drawn at most 2048 px on its
/// longest side as a JPEG; when that does not fit what is left, it steps down in size and quality,
/// and gives up below 512 px.
nonisolated enum ImageFitter {
    static let promptBudget = 4 * 1_048_576
    static let sides: [CGFloat] = [2048, 1536, 1024, 768, 512]
    static let qualities: [CGFloat] = [0.8, 0.6, 0.45]
    static let thumbnailSide: CGFloat = 160

    static func fit(_ image: UIImage, within budget: Int, name: String? = nil) -> ComposerImage? {
        let longest = max(image.size.width, image.size.height) * image.scale
        guard longest > 0 else { return nil }
        let steps = sides.filter { $0 < longest }
        for side in (longest <= sides[0] ? [longest] : []) + steps {
            let drawn = draw(image, longest: side)
            for quality in qualities {
                guard let data = drawn.jpegData(compressionQuality: quality) else { continue }
                if base64Length(data.count) <= budget {
                    let content = ImageContent(mimeType: "image/jpeg", data: data.base64EncodedString(), name: name)
                    return ComposerImage(id: UUID(), thumbnail: draw(image, longest: thumbnailSide), content: content)
                }
            }
        }
        return nil
    }

    static func base64Length(_ bytes: Int) -> Int { (bytes + 2) / 3 * 4 }

    /// The image at `longest` pixels on its longer side, at scale 1, never larger than it is.
    static func draw(_ image: UIImage, longest: CGFloat) -> UIImage {
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let factor = min(1, longest / max(pixels.width, pixels.height))
        let size = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
