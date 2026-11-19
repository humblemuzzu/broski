import SwiftUI
import UIKit

/// Native UIKit scroll-view zoom canvas: Apple Photos pinch-to-zoom, momentum panning, focal-point
/// double-tap zoom, and a subtle neutral backing strictly behind transparent images.
struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage
    var hasAlpha = false
    var onSingleTap: (() -> Void)?
    var onZoomChanged: ((Bool) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> ZoomContainerView {
        let view = ZoomContainerView()
        view.scrollView.delegate = context.coordinator
        view.configureGestures(target: context.coordinator)
        view.setImage(image, hasAlpha: hasAlpha)
        return view
    }

    func updateUIView(_ uiView: ZoomContainerView, context: Context) {
        context.coordinator.parent = self
        if uiView.currentImage !== image || uiView.showsAlphaBacking != hasAlpha {
            uiView.setImage(image, hasAlpha: hasAlpha)
        }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var parent: ZoomableImageView

        init(parent: ZoomableImageView) {
            self.parent = parent
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            (scrollView.superview as? ZoomContainerView)?.imageContainer
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            (scrollView.superview as? ZoomContainerView)?.centerImage()
            parent.onZoomChanged?(scrollView.zoomScale > 1.02)
        }

        @objc func handleSingleTap() {
            parent.onSingleTap?()
        }

        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let container = gesture.view as? ZoomContainerView else { return }
            let scroll = container.scrollView
            if scroll.zoomScale > 1.05 {
                scroll.setZoomScale(1.0, animated: true)
                return
            }
            let targetScale: CGFloat = 2.5
            let point = gesture.location(in: container.imageContainer)
            let size = CGSize(
                width: scroll.bounds.width / targetScale,
                height: scroll.bounds.height / targetScale)
            let rect = CGRect(
                x: point.x - size.width / 2,
                y: point.y - size.height / 2,
                width: size.width,
                height: size.height)
            scroll.zoom(to: rect, animated: true)
        }
    }
}

final class ZoomContainerView: UIView {
    let scrollView = UIScrollView()
    let imageContainer = UIView()
    private let backingView = CheckerboardBackingView()
    private let imageView = UIImageView()
    private(set) var currentImage: UIImage?
    private(set) var showsAlphaBacking = false
    private var lastBounds: CGSize = .zero

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        scrollView.backgroundColor = .clear
        scrollView.minimumZoomScale = 1.0
        scrollView.maximumZoomScale = 6.0
        scrollView.bouncesZoom = true
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.clipsToBounds = false
        addSubview(scrollView)

        imageContainer.backgroundColor = .clear
        scrollView.addSubview(imageContainer)

        backingView.isHidden = true
        imageContainer.addSubview(backingView)

        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .clear
        imageContainer.addSubview(imageView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configureGestures(target: ZoomableImageView.Coordinator) {
        let doubleTap = UITapGestureRecognizer(target: target, action: #selector(ZoomableImageView.Coordinator.handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        let singleTap = UITapGestureRecognizer(target: target, action: #selector(ZoomableImageView.Coordinator.handleSingleTap))
        singleTap.numberOfTapsRequired = 1
        singleTap.require(toFail: doubleTap)
        addGestureRecognizer(doubleTap)
        addGestureRecognizer(singleTap)
    }

    func setImage(_ image: UIImage, hasAlpha: Bool) {
        currentImage = image
        showsAlphaBacking = hasAlpha
        imageView.image = image
        backingView.isHidden = !hasAlpha
        scrollView.setZoomScale(1.0, animated: false)
        layoutImage()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scrollView.frame = bounds
        if bounds.size != lastBounds {
            lastBounds = bounds.size
            scrollView.setZoomScale(1.0, animated: false)
            layoutImage()
        }
    }

    private func layoutImage() {
        guard let image = currentImage, bounds.width > 0, bounds.height > 0 else { return }
        let width = max(image.size.width, 1)
        let height = max(image.size.height, 1)
        let scale = min(bounds.width / width, bounds.height / height)
        let fitted = CGSize(width: floor(width * scale), height: floor(height * scale))
        imageContainer.frame = CGRect(origin: .zero, size: fitted)
        backingView.frame = imageContainer.bounds
        imageView.frame = imageContainer.bounds
        scrollView.contentSize = fitted
        centerImage()
    }

    func centerImage() {
        let offsetX = max((scrollView.bounds.width - scrollView.contentSize.width) * 0.5, 0)
        let offsetY = max((scrollView.bounds.height - scrollView.contentSize.height) * 0.5, 0)
        imageContainer.center = CGPoint(
            x: scrollView.contentSize.width * 0.5 + offsetX,
            y: scrollView.contentSize.height * 0.5 + offsetY)
    }
}

/// Subtle neutral checkerboard behind transparent PNGs so dark icons/strokes remain visible.
private final class CheckerboardBackingView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(patternImage: Self.tile())
        layer.cornerRadius = 4
        clipsToBounds = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    private static func tile() -> UIImage {
        let side: CGFloat = 16
        return UIGraphicsImageRenderer(size: CGSize(width: side * 2, height: side * 2)).image { ctx in
            UIColor(white: 0.22, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: side * 2, height: side * 2))
            UIColor(white: 0.28, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
            ctx.fill(CGRect(x: side, y: side, width: side, height: side))
        }
    }
}
