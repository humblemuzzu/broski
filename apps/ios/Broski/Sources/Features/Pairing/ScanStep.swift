import SwiftUI
import UIKit

/// The scanner, or why it cannot run here; pasting the link works in every case.
struct ScanStep: View {
    let model: PairingModel
    @State private var availability: ScannerAvailability = .checking
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            switch availability {
            case .checking:
                LoadingOrb(side: 64, label: "Checking the camera")
            case .available:
                scanner
            case .unsupported:
                ContentUnavailableView {
                    Label("This device can't scan codes", systemImage: "qrcode.viewfinder")
                } description: {
                    Text("Paste the pairing link broski-link pair printed on your Mac instead.")
                } actions: {
                    pasteButton.primaryActionStyle()
                }
            case .cameraDenied:
                ContentUnavailableView {
                    Label("Broski can't use the camera", systemImage: "camera.fill")
                } description: {
                    Text("Allow camera access for Broski in Settings, or paste the pairing link instead.")
                } actions: {
                    VStack(spacing: Spacing.m) {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }
                        .primaryActionStyle()
                        pasteButton.secondaryActionStyle()
                    }
                }
            }
        }
        .navigationTitle("Scan Pairing Code")
        .navigationBarTitleDisplayMode(.inline)
        .task { availability = await ScannerAvailability.resolve() }
    }

    private var scanner: some View {
        QRScanner { model.scanned($0) }
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                Text("Scan the code broski-link pair shows on your Mac.")
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.s)
                    .background(.regularMaterial, in: .capsule)
                    .padding(Spacing.l)
            }
            .overlay(alignment: .bottom) {
                pasteButton
                    .secondaryActionStyle()
                    .padding(Spacing.xl)
            }
    }

    private var pasteButton: some View {
        Button {
            model.pasted(.read())
        } label: {
            Label("Paste Pairing Link", systemImage: "doc.on.clipboard")
        }
    }
}
