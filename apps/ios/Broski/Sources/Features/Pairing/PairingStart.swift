import SwiftUI
import UIKit

/// How a pairing begins: with the scanner, with what the clipboard held when the person tapped
/// Paste pairing link, or with a `broski://pair` link iOS opened the app with.
enum PairingStart: Identifiable, Hashable {
    case scan
    case paste(Clipboard)
    case link(String)

    var id: Self { self }

    static func pasteFromClipboard() -> PairingStart {
        .paste(.read())
    }
}

enum Clipboard: Hashable {
    case text(String)
    case empty
    /// The clipboard holds text, but iOS did not let Broski read it (the person said no).
    case refused

    /// Reads the clipboard once, now, on the person's tap; iOS may ask them to allow the paste.
    /// `hasStrings` reads no content, so it never asks.
    static func read() -> Clipboard {
        let pasteboard = UIPasteboard.general
        guard pasteboard.hasStrings else { return .empty }
        return pasteboard.string.map(Clipboard.text) ?? .refused
    }
}

/// Opens the pairing sheet from anywhere under `RootView`.
struct PairAction {
    let start: @MainActor (PairingStart) -> Void

    func callAsFunction(_ how: PairingStart) {
        start(how)
    }
}

extension EnvironmentValues {
    @Entry var startPairing = PairAction { _ in }
}
