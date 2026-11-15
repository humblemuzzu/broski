import AVFoundation
import SwiftUI
import Vision
import VisionKit

/// The camera, looking for a `broski://pair` QR code: VisionKit's data scanner with guidance and
/// highlighting, QR only. Reports the first code's text, whatever it holds: a code that is not an
/// offer is the "wrong code" the pairing flow explains.
struct QRScanner: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
            recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
            isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.found = found
        if !scanner.isScanning {
            try? scanner.startScanning()
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(found: found)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var found: (String) -> Void

        init(found: @escaping (String) -> Void) {
            self.found = found
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            for item in addedItems {
                if case .barcode(let code) = item, let text = code.payloadStringValue {
                    found(text)
                    return
                }
            }
        }
    }
}

/// Whether the scanner can run here, after asking for the camera if iOS has not asked yet.
enum ScannerAvailability: Equatable {
    case checking
    case available
    /// No camera that can scan (the simulator, or hardware without one).
    case unsupported
    case cameraDenied

    static func resolve() async -> ScannerAvailability {
        guard DataScannerViewController.isSupported else { return .unsupported }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            return granted && DataScannerViewController.isAvailable ? .available : .cameraDenied
        case .authorized:
            return DataScannerViewController.isAvailable ? .available : .cameraDenied
        default:
            return .cameraDenied
        }
    }
}
