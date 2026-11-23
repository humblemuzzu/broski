import CoreGraphics
import SwiftUI

struct ScreenCanvasView: View {
    let model: ScreenModel
    @State private var zoom: CGFloat = 1.0
    @State private var baseZoom: CGFloat = 1.0
    @State private var pan = CGSize.zero
    @State private var basePan = CGSize.zero
    @State private var lastDrag: CGPoint?

    var body: some View {
        GeometryReader { geo in
            let fitted = fittedRect(container: geo.size)
            ZStack {
                Color.black
                if let image = model.frameImage {
                    Image(decorative: image, scale: 1.0)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: fitted.width, height: fitted.height)
                        .overlay(alignment: .topLeading) {
                            cursorOverlay(in: fitted.size)
                        }
                        .scaleEffect(zoom)
                        .offset(pan)
                } else {
                    ProgressView("Connecting to Mac screen…")
                        .tint(.white)
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .contentShape(Rectangle())
            .gesture(dragGesture(fitted: fitted, container: geo.size))
            .simultaneousGesture(magnifyGesture)
            .onTapGesture { location in
                if model.pointerMode == .trackpad {
                    model.click(button: 1)
                } else if let remote = toRemotePoint(location, fitted: fitted, container: geo.size) {
                    model.click(button: 1, at: remote)
                }
            }
        }
    }

    @ViewBuilder
    private func cursorOverlay(in displaySize: CGSize) -> some View {
        if model.frameWidth > 0, model.frameHeight > 0 {
            let scaleX = displaySize.width / CGFloat(model.frameWidth)
            let scaleY = displaySize.height / CGFloat(model.frameHeight)
            let x = model.cursorPos.x * scaleX
            let y = model.cursorPos.y * scaleY
            if let cursor = model.cursorImage {
                Image(decorative: cursor, scale: 1.0)
                    .resizable()
                    .frame(
                        width: max(CGFloat(cursor.width) * scaleX, 14),
                        height: max(CGFloat(cursor.height) * scaleY, 14)
                    )
                    .offset(
                        x: x - model.cursorHotspot.x * scaleX,
                        y: y - model.cursorHotspot.y * scaleY
                    )
            } else {
                Circle()
                    .fill(.white)
                    .stroke(.black, lineWidth: 1.5)
                    .frame(width: 12, height: 12)
                    .offset(x: x - 6, y: y - 6)
            }
        }
    }

    private func dragGesture(fitted: CGRect, container: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if model.pointerMode == .trackpad {
                    let prev = lastDrag ?? value.startLocation
                    let dx = (value.location.x - prev.x) * trackpadScale(fitted: fitted)
                    let dy = (value.location.y - prev.y) * trackpadScale(fitted: fitted)
                    lastDrag = value.location
                    model.moveCursor(delta: CGSize(width: dx, height: dy))
                } else if zoom > 1.01 {
                    pan = CGSize(
                        width: basePan.width + value.translation.width,
                        height: basePan.height + value.translation.height
                    )
                } else if let remote = toRemotePoint(value.location, fitted: fitted, container: container) {
                    model.moveCursor(to: remote)
                }
            }
            .onEnded { _ in
                lastDrag = nil
                basePan = pan
            }
    }

    private var magnifyGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                zoom = min(max(baseZoom * value.magnification, 1.0), 5.0)
                if zoom <= 1.01 { pan = .zero; basePan = .zero }
            }
            .onEnded { _ in
                baseZoom = zoom
            }
    }

    private func trackpadScale(fitted: CGRect) -> CGFloat {
        guard fitted.width > 0, model.frameWidth > 0 else { return 1.5 }
        return (CGFloat(model.frameWidth) / fitted.width) * 1.15 / max(zoom, 1.0)
    }

    private func fittedRect(container: CGSize) -> CGRect {
        guard model.frameWidth > 0, model.frameHeight > 0, container.width > 0, container.height > 0 else {
            return CGRect(origin: .zero, size: container)
        }
        let aspect = CGFloat(model.frameWidth) / CGFloat(model.frameHeight)
        let containerAspect = container.width / container.height
        let size: CGSize = if aspect > containerAspect {
            CGSize(width: container.width, height: container.width / aspect)
        } else {
            CGSize(width: container.height * aspect, height: container.height)
        }
        let origin = CGPoint(
            x: (container.width - size.width) / 2,
            y: (container.height - size.height) / 2
        )
        return CGRect(origin: origin, size: size)
    }

    private func toRemotePoint(_ viewPoint: CGPoint, fitted: CGRect, container: CGSize) -> CGPoint? {
        guard model.frameWidth > 0, model.frameHeight > 0, fitted.width > 0, fitted.height > 0 else { return nil }
        let cx = container.width / 2
        let cy = container.height / 2
        let unzoomedX = (viewPoint.x - pan.width - cx) / zoom + cx
        let unzoomedY = (viewPoint.y - pan.height - cy) / zoom + cy
        let relX = (unzoomedX - fitted.minX) / fitted.width
        let relY = (unzoomedY - fitted.minY) / fitted.height
        guard relX >= 0, relX <= 1, relY >= 0, relY <= 1 else { return nil }
        return CGPoint(x: relX * CGFloat(model.frameWidth), y: relY * CGFloat(model.frameHeight))
    }
}
