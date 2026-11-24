import BroskiCore
import Foundation
import Observation

/// One pairing, from a scanned or pasted offer to a paired machine and the notification ask.
@Observable
final class PairingModel {
    struct Offer: Equatable {
        let uri: String
        let machineId: String
        let name: String
        /// The code `broski-link pair` prints under its QR; a link can carry any name but not this.
        let verificationCode: String
        let expiresAt: Date
        let alreadyPaired: Bool
        let source: PairingProblem.Source

        /// The span a countdown from `date` shows, or `nil` once the code has expired. It is built
        /// from the instant the view decided on, so its bounds can never cross.
        func countdown(at date: Date) -> ClosedRange<Date>? {
            date < expiresAt ? date...expiresAt : nil
        }
    }

    enum Step: Equatable {
        case scanning
        case preview(Offer)
        case pairing(Offer)
        case problem(PairingProblem, Offer?)
        case askNotifications(name: String)
        case finished
    }

    private(set) var step: Step
    /// Set once a pairing succeeds; the sheet plays the success haptic on it.
    private(set) var pairedMachine: String?

    @ObservationIgnored private let app: AppModel

    init(start: PairingStart, app: AppModel) {
        self.app = app
        switch start {
        case .scan:
            step = .scanning
        case .paste(let clipboard):
            step = .scanning
            pasted(clipboard)
        case .link(let uri):
            step = .scanning
            read(uri, source: .pasted)
        }
    }

    /// The scanner found a QR code; anything after the first offer is ignored.
    func scanned(_ payload: String) {
        guard step == .scanning else { return }
        read(payload, source: .scanned)
    }

    func pasted(_ clipboard: Clipboard) {
        switch clipboard {
        case .text(let text): read(text, source: .pasted)
        case .empty: step = .problem(.clipboardEmpty(), nil)
        case .refused: step = .problem(.pasteRefused(), nil)
        }
    }

    func scanAgain() {
        step = .scanning
    }

    func pair() async {
        let offer: Offer
        switch step {
        case .preview(let previewed), .problem(_, .some(let previewed)):
            offer = previewed
        default:
            return
        }
        step = .pairing(offer)
        do {
            let machine = try await app.pair(offer: offer.uri)
            pairedMachine = machine.name
            await app.notifications.refresh()
            step = app.notifications.canAsk ? .askNotifications(name: machine.name) : .finished
        } catch {
            step = .problem(PairingProblem(error: error, machineName: offer.name, source: offer.source), offer)
        }
    }

    func askNotifications() async {
        await app.notifications.ask()
        step = .finished
    }

    func skipNotifications() {
        step = .finished
    }

    private func read(_ text: String, source: PairingProblem.Source) {
        // An offer never holds whitespace (its name and relay are percent-encoded), but a link
        // copied from a narrow terminal or chat arrives broken across lines.
        let text = text.filter { !$0.isWhitespace }
        guard !text.isEmpty else {
            step = .problem(.clipboardEmpty(), nil)
            return
        }
        do {
            let parsed = try parsePairingOffer(uri: text)
            step = .preview(
                Offer(
                    uri: text, machineId: parsed.machineId, name: parsed.name,
                    verificationCode: parsed.verificationCode,
                    expiresAt: Date(timeIntervalSince1970: TimeInterval(parsed.expiresAt)),
                    alreadyPaired: app.machine(id: parsed.machineId) != nil, source: source))
        } catch {
            step = .problem(PairingProblem(error: error, machineName: nil, source: source), nil)
        }
    }
}
