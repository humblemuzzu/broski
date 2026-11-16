import BroskiCore
import Foundation
import Testing

@testable import Broski

@Suite(.serialized)
struct PairingTests {
    @Test func everyLinkFailureSaysWhatHappenedAndWhatToDo() {
        func problem(_ failure: LinkFailure, _ source: PairingProblem.Source = .scanned) -> PairingProblem {
            PairingProblem(error: ClientError.Link(failure: failure, detail: "why"), machineName: "Studio Mac", source: source)
        }

        #expect(problem(.offerExpired).message == "This code expired. Run broski-link pair again.")
        #expect(problem(.offerExpired).next == .scanAgain)
        #expect(
            problem(.fingerprintMismatch).message
                == "This code isn't from the Mac you scanned. Pair again from the Mac itself.")
        #expect(problem(.fingerprintMismatch).next == .scanAgain)
        #expect(problem(.offer).message.contains("pairing code"))
        #expect(problem(.offer, .pasted).message.contains("pairing link"))
        #expect(problem(.machineUnreachable).message.hasPrefix("Can't reach Studio Mac."))
        #expect(problem(.machineUnreachable).next == .tryAgain)
        #expect(problem(.pairingTimeout).next == .tryAgain)
        #expect(problem(.pairingRejected).next == .scanAgain)
        #expect(problem(.identity).next == .close)
        for failure: LinkFailure in [.record, .push, .randomness, .runtime] {
            #expect(problem(failure).next == .tryAgain)
            #expect(problem(failure).detail == "why")
        }
        #expect(PairingProblem(error: ClientError.Timeout, machineName: nil, source: .scanned).message.contains("your Mac"))
    }

    @Test func aPastedOfferIsPreviewedWithItsMachineAndExpiry() throws {
        let test = TestStorage()
        defer { test.remove() }
        let app = AppModel(storage: test.storage)
        app.start()

        let pairing = PairingModel(start: .paste(.text("  \(try Fixture.text("offer.txt"))\n")), app: app)
        guard case .preview(let offer) = pairing.step else {
            Issue.record("expected a preview, got \(pairing.step)")
            return
        }
        #expect(offer.name == "Studio Mac")
        #expect(offer.expiresAt == Date(timeIntervalSince1970: 4_102_444_800))
        #expect(!offer.alreadyPaired)
        #expect(offer.source == .pasted)
    }

    @Test func aLinkBrokenAcrossLinesOrOpenedByIOSIsStillPreviewed() throws {
        let test = TestStorage()
        defer { test.remove() }
        let app = AppModel(storage: test.storage)
        app.start()
        let offer = try Fixture.text("offer.txt").trimmed
        let middle = offer.index(offer.startIndex, offsetBy: offer.count / 2)
        let wrapped = "\(offer[..<middle])\n  \(offer[middle...])"

        for start in [PairingStart.paste(.text(wrapped)), .link(offer)] {
            guard case .preview(let previewed) = PairingModel(start: start, app: app).step else {
                Issue.record("expected a preview for \(start)")
                continue
            }
            #expect(previewed.uri == offer)
            #expect(previewed.name == "Studio Mac")
        }
    }

    @Test func theCountdownRunsFromTheInstantTheViewChecksAndEndsAtTheExpiry() {
        let expiresAt = Date(timeIntervalSince1970: 1_000)
        let offer = PairingModel.Offer(
            uri: "broski://pair", machineId: "m", name: "Studio Mac", expiresAt: expiresAt, alreadyPaired: false, source: .scanned)

        let justBefore = expiresAt.addingTimeInterval(-0.001)
        #expect(offer.countdown(at: justBefore) == justBefore...expiresAt)
        #expect(offer.countdown(at: expiresAt) == nil)
        #expect(offer.countdown(at: expiresAt.addingTimeInterval(0.4)) == nil)
    }

    @Test func pastingNothingARefusalOrSomethingElseSaysWhichAndExplainsTheLink() {
        let test = TestStorage()
        defer { test.remove() }
        let app = AppModel(storage: test.storage)
        app.start()

        #expect(PairingModel(start: .paste(.empty), app: app).step == .problem(.clipboardEmpty(), nil))
        #expect(PairingModel(start: .paste(.text("  ")), app: app).step == .problem(.clipboardEmpty(), nil))
        #expect(PairingModel(start: .paste(.refused), app: app).step == .problem(.pasteRefused(), nil))
        guard case .problem(let problem, nil) = PairingModel(start: .paste(.text("https://example.com")), app: app).step else {
            Issue.record("expected a problem")
            return
        }
        #expect(problem.message.contains("pairing link"))
    }

    @Test(.timeLimit(.minutes(1)))
    func aPairingWithAMachineThatCannotBeReachedOffersToTryAgain() async throws {
        let test = TestStorage()
        defer { test.remove() }
        let app = AppModel(storage: test.storage)
        app.start()
        let pairing = PairingModel(start: .scan, app: app)
        pairing.scanned(try Fixture.text("offer.txt"))

        await pairing.pair()
        guard case .problem(let problem, let offer) = pairing.step else {
            Issue.record("expected a problem, got \(pairing.step)")
            return
        }
        #expect(problem.message.hasPrefix("Can't reach Studio Mac."))
        #expect(problem.next == .tryAgain)
        #expect(offer?.name == "Studio Mac")
        #expect(app.machines.isEmpty)
        #expect(try test.storage.records.all().isEmpty)
        #expect(pairing.pairedMachine == nil)
    }
}
