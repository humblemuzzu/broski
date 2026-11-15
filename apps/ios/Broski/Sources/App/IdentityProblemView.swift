import SwiftUI

/// The phone could not open from its stored identity. Says why, offers to try again, and offers
/// to start over only where the identity itself is lost or damaged: starting over orphans every
/// pairing, so it is never done without the person's confirmation.
struct IdentityProblemView: View {
    let problem: IdentityProblem
    @Environment(AppModel.self) private var model
    @State private var confirmingStartOver = false

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "person.badge.key.fill")
        } description: {
            VStack(spacing: Spacing.s) {
                Text(message)
                if let detail {
                    Text(detail)
                        .font(.codeSmall)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        } actions: {
            VStack(spacing: Spacing.m) {
                if canTryAgain {
                    Button("Try Again") { model.start() }
                        .primaryActionStyle()
                }
                if canStartOver {
                    Button("Start Over…", role: .destructive) { confirmingStartOver = true }
                        .secondaryActionStyle()
                }
            }
        }
        .confirmationDialog("Start over?", isPresented: $confirmingStartOver, titleVisibility: .visible) {
            Button("Start Over", role: .destructive) { model.startOver() }
        } message: {
            Text("This phone forgets every Mac it was paired with and gets a new identity. You'll pair each Mac again.")
        }
    }

    private var title: String {
        switch problem {
        case .keychain: "Broski can't reach its keychain"
        case .missing: "This phone's Broski identity is gone"
        case .rejected: "This phone's Broski identity is damaged"
        case .core: "Broski couldn't start"
        }
    }

    private var message: String {
        switch problem {
        case .keychain:
            "iOS didn't hand over the identity Broski keeps in the keychain. If the phone just restarted, unlock it and try again."
        case .missing:
            "This phone still has pairings, but not the identity they belong to, so none of them can connect. Start over to make a new identity, then pair your Macs again."
        case .rejected:
            "The identity stored on this phone can't be read, so its pairings can't connect. Start over to make a new identity, then pair your Macs again."
        case .core:
            "Try again. If it keeps happening, start over and pair your Macs again."
        }
    }

    private var detail: String? {
        switch problem {
        case .keychain(let status): "OSStatus \(status)"
        case .missing: nil
        case .rejected(let detail), .core(let detail): detail
        }
    }

    private var canTryAgain: Bool {
        switch problem {
        case .keychain, .core: true
        case .missing, .rejected: false
        }
    }

    private var canStartOver: Bool {
        switch problem {
        case .keychain: false
        case .missing, .rejected, .core: true
        }
    }
}
