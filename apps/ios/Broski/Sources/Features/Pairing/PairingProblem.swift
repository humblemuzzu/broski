import BroskiCore

/// Why a pairing did not happen, in the person's words, and the one thing to do next.
struct PairingProblem: Equatable {
    enum Next: Equatable {
        /// The code itself is spent or wrong: get a new one from the Mac.
        case scanAgain
        /// The same code may still work.
        case tryAgain
        /// Nothing on this screen helps.
        case close
    }

    let message: String
    let detail: String?
    let next: Next

    /// Where the offer came from, which decides whether the words say "code" or "link".
    enum Source {
        case scanned
        case pasted
    }

    static func clipboardEmpty() -> PairingProblem {
        PairingProblem(
            message: "There's nothing to paste. Copy the broski://pair link that broski-link pair printed on your Mac, then try again.",
            detail: nil, next: .scanAgain)
    }

    static func pasteRefused() -> PairingProblem {
        PairingProblem(
            message: "Broski wasn't allowed to paste. Tap Paste Pairing Link and allow it, or turn on Paste from Other Apps for Broski in Settings.",
            detail: nil, next: .scanAgain)
    }

    /// A failure of `parsePairingOffer` or `Phone.pair`, every `LinkFailure` worded on its own.
    init(error: any Error, machineName: String?, source: Source) {
        let name = machineName ?? "your Mac"
        guard let error = error as? ClientError else {
            self.init(message: "Pairing didn't finish. Try again.", detail: String(describing: error), next: .tryAgain)
            return
        }
        switch error {
        case .Link(let failure, let detail):
            self.init(failure: failure, detail: detail, name: name, source: source)
        default:
            self.init(
                message: "Pairing with \(name) didn't finish. Try again.", detail: String(describing: error),
                next: .tryAgain)
        }
    }

    private init(failure: LinkFailure, detail: String, name: String, source: Source) {
        switch failure {
        case .offerExpired:
            self.init(message: "This code expired. Run broski-link pair again.", detail: nil, next: .scanAgain)
        case .offer where source == .pasted:
            self.init(
                message: "This isn't a Broski pairing link. Copy the broski://pair link that broski-link pair printed, then try again.",
                detail: nil, next: .scanAgain)
        case .offer:
            self.init(
                message: "This isn't a Broski pairing code. Run broski-link pair on your Mac and scan the code it shows.",
                detail: nil, next: .scanAgain)
        case .fingerprintMismatch:
            self.init(
                message: "This code isn't from the Mac you scanned. Pair again from the Mac itself.", detail: nil,
                next: .scanAgain)
        case .machineUnreachable:
            self.init(
                message: "Can't reach \(name). Check that it's awake and online, then try again.", detail: detail,
                next: .tryAgain)
        case .pairingTimeout:
            self.init(
                message: "\(name) didn't answer in time. Check that it's awake and online, then try again.",
                detail: detail, next: .tryAgain)
        case .pairingRejected:
            self.init(
                message: "\(name) didn't accept this code. It may have been used already. Run broski-link pair again for a new one.",
                detail: detail, next: .scanAgain)
        case .identity:
            self.init(
                message: "This phone's Broski identity can't be used, so it can't pair.", detail: detail, next: .close)
        case .record, .push, .randomness, .runtime:
            self.init(message: "Pairing with \(name) failed on this phone. Try again.", detail: detail, next: .tryAgain)
        }
    }

    private init(message: String, detail: String?, next: Next) {
        self.message = message
        self.detail = detail
        self.next = next
    }
}
