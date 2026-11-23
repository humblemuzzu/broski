import BroskiCore
import CoreGraphics
import Foundation
import Observation
import UIKit

enum PointerMode: String, CaseIterable {
    case trackpad
    case directTouch
}

struct ModifierKeys: OptionSet {
    let rawValue: UInt8
    static let command = ModifierKeys(rawValue: 1 << 0)
    static let option = ModifierKeys(rawValue: 1 << 1)
    static let control = ModifierKeys(rawValue: 1 << 2)
    static let shift = ModifierKeys(rawValue: 1 << 3)
}

@Observable
final class ScreenModel {
    enum Phase: Equatable {
        case connecting
        case authRequired([AuthScheme], errorMessage: String?)
        case live
        case disabled(String)
        case closed(String)
    }

    let machineId: String
    private(set) var phase: Phase = .connecting
    private(set) var desktopName = ""
    private(set) var frameWidth = 0
    private(set) var frameHeight = 0
    private(set) var frameImage: CGImage?
    private(set) var cursorImage: CGImage?
    private(set) var cursorHotspot = CGPoint.zero
    private(set) var cursorPos = CGPoint.zero

    var pointerMode: PointerMode = .trackpad
    var activeModifiers: ModifierKeys = []

    @ObservationIgnored private var view: ScreenView?
    @ObservationIgnored private var pump: Task<Void, Never>?
    @ObservationIgnored private var rgbaBuffer = Data()
    @ObservationIgnored private var lastSchemes: [AuthScheme] = [.appleCredentials, .vncPassword]
    @ObservationIgnored private weak var machine: MachineModel?

    init(machineId: String) {
        self.machineId = machineId
    }

    func connect(using machine: MachineModel, credentials: ScreenCredentials? = nil) {
        disconnect()
        self.machine = machine
        activeModifiers = []
        phase = .connecting
        do {
            let screenView = try machine.machine.openScreen(credentials: credentials)
            view = screenView
            pump = Task { [weak self] in
                while let update = await screenView.nextUpdate() {
                    self?.apply(update)
                }
                if let self, case .live = self.phase {
                    self.phase = .closed("Disconnected")
                }
            }
        } catch {
            phase = .closed(String(describing: error))
        }
    }

    func markMachineUnavailable() {
        disconnect()
        phase = .closed("This Mac is no longer paired.")
    }

    func submitCredentials(username: String, password: String) {
        let creds = ScreenCredentials(username: username, password: password)
        if let view, case .authRequired = phase {
            do {
                try view.provideCredentials(credentials: creds)
                phase = .connecting
                return
            } catch {}
        }
        if let machine {
            connect(using: machine, credentials: creds)
        }
    }

    func retry() {
        guard let machine else { return }
        connect(using: machine)
    }

    func disconnect() {
        releaseAllModifiers()
        pump?.cancel()
        pump = nil
        view?.detach()
        view = nil
    }

    func moveCursor(to point: CGPoint) {
        guard frameWidth > 0, frameHeight > 0 else { return }
        let x = min(max(point.x, 0), CGFloat(frameWidth - 1))
        let y = min(max(point.y, 0), CGFloat(frameHeight - 1))
        cursorPos = CGPoint(x: x, y: y)
        view?.pointer(x: UInt16(x), y: UInt16(y), buttons: 0)
    }

    func moveCursor(delta: CGSize) {
        moveCursor(to: CGPoint(x: cursorPos.x + delta.width, y: cursorPos.y + delta.height))
    }

    func click(button: UInt8, at point: CGPoint? = nil) {
        if let point { moveCursor(to: point) }
        let x = UInt16(max(0, min(cursorPos.x, CGFloat(max(frameWidth - 1, 0)))))
        let y = UInt16(max(0, min(cursorPos.y, CGFloat(max(frameHeight - 1, 0)))))
        view?.pointer(x: x, y: y, buttons: button)
        view?.pointer(x: x, y: y, buttons: 0)
    }

    func scroll(deltaX: Int8, deltaY: Int8) {
        let x = UInt16(max(0, min(cursorPos.x, CGFloat(max(frameWidth - 1, 0)))))
        let y = UInt16(max(0, min(cursorPos.y, CGFloat(max(frameHeight - 1, 0)))))
        view?.scroll(x: x, y: y, deltaX: deltaX, deltaY: deltaY)
    }

    func toggleModifier(_ mod: ModifierKeys) {
        let keysym = keysymFor(mod)
        if activeModifiers.contains(mod) {
            activeModifiers.remove(mod)
            view?.key(keysym: keysym, down: false)
        } else {
            activeModifiers.insert(mod)
            view?.key(keysym: keysym, down: true)
        }
    }

    func releaseAllModifiers() {
        for mod in [ModifierKeys.command, .option, .control, .shift] where activeModifiers.contains(mod) {
            view?.key(keysym: keysymFor(mod), down: false)
        }
        activeModifiers = []
    }

    func tapKey(_ keysym: UInt32) {
        view?.key(keysym: keysym, down: true)
        view?.key(keysym: keysym, down: false)
        releaseAllModifiers()
    }

    func typeText(_ text: String) {
        guard !text.isEmpty else { return }
        view?.typeText(text: text)
    }

    func sendShortcut(_ shortcut: ScreenShortcut) {
        view?.shortcut(shortcut: shortcut)
    }

    func pastePhoneClipboard() {
        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        view?.setClipboard(text: text)
        view?.shortcut(shortcut: .paste)
    }

    func refresh() {
        view?.refresh()
    }

    private func apply(_ update: ScreenUpdate) {
        switch update {
        case .authRequired(let schemes):
            lastSchemes = schemes
            phase = .authRequired(schemes, errorMessage: nil)
        case .ready(let width, let height, let name, _):
            desktopName = name
            resizeBuffer(width: Int(width), height: Int(height))
            cursorPos = CGPoint(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
            phase = .live
        case .frame(let width, let height, let x, let y, let rectWidth, let rectHeight, let rgba):
            applyFrame(
                width: Int(width), height: Int(height),
                x: Int(x), y: Int(y),
                rectW: Int(rectWidth), rectH: Int(rectHeight),
                rgba: rgba
            )
            phase = .live
        case .resized(let width, let height):
            resizeBuffer(width: Int(width), height: Int(height))
        case .cursor(let width, let height, let hotX, let hotY, let rgba):
            cursorHotspot = CGPoint(x: CGFloat(hotX), y: CGFloat(hotY))
            cursorImage = makeImage(rgba: rgba, width: Int(width), height: Int(height), opaque: false)
        case .pointerPos(let x, let y):
            cursorPos = CGPoint(x: CGFloat(x), y: CGFloat(y))
        case .clipboard(let text):
            UIPasteboard.general.string = text
        case .closed(let reason, let detail):
            view = nil
            switch reason {
            case .screenSharingDisabled:
                phase = .disabled(detail.isEmpty ? "Turn on Screen Sharing on your Mac." : detail)
            case .authFailed:
                let message = detail.isEmpty ? "Wrong username or password. Try again." : detail
                phase = .authRequired(lastSchemes, errorMessage: message)
            case .normal:
                phase = .closed("Session ended")
            default:
                phase = .closed(detail.isEmpty ? "Disconnected" : detail)
            }
        }
    }

    private func resizeBuffer(width: Int, height: Int) {
        guard width > 0, height > 0 else { return }
        frameWidth = width
        frameHeight = height
        rgbaBuffer = Data(count: width * height * 4)
    }

    private func applyFrame(width: Int, height: Int, x: Int, y: Int, rectW: Int, rectH: Int, rgba: Data) {
        if width != frameWidth || height != frameHeight {
            resizeBuffer(width: width, height: height)
        }
        guard width > 0, height > 0, rectW > 0, rectH > 0,
              x >= 0, y >= 0, x + rectW <= width, y + rectH <= height else { return }
        if x == 0, y == 0, rectW == width, rectH == height, rgba.count == width * height * 4 {
            rgbaBuffer = rgba
        } else {
            let rowBytes = rectW * 4
            let stride = width * 4
            guard rgba.count >= rowBytes * rectH, rgbaBuffer.count == stride * height else { return }
            rgbaBuffer.withUnsafeMutableBytes { dst in
                rgba.withUnsafeBytes { src in
                    guard let dstBase = dst.baseAddress, let srcBase = src.baseAddress else { return }
                    for row in 0..<rectH {
                        let dstOff = (y + row) * stride + x * 4
                        let srcOff = row * rowBytes
                        memcpy(dstBase.advanced(by: dstOff), srcBase.advanced(by: srcOff), rowBytes)
                    }
                }
            }
        }
        frameImage = makeImage(rgba: rgbaBuffer, width: width, height: height, opaque: true)
    }

    private func makeImage(rgba: Data, width: Int, height: Int, opaque: Bool) -> CGImage? {
        guard width > 0, height > 0, rgba.count >= width * height * 4 else { return nil }
        guard let provider = CGDataProvider(data: rgba as CFData) else { return nil }
        let alpha: CGImageAlphaInfo = opaque ? .noneSkipLast : .premultipliedLast
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: alpha.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
    }

    private func keysymFor(_ mod: ModifierKeys) -> UInt32 {
        switch mod {
        case .command: 0xffeb
        case .option: 0xffe9
        case .control: 0xffe3
        case .shift: 0xffe1
        default: 0
        }
    }
}
