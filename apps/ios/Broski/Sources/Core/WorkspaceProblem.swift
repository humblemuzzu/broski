import BroskiCore

/// What a workspace request could not do: a sentence for the screen, and the Mac's own words
/// (git's, for a refused checkout or commit) as the quieter detail.
struct WorkspaceProblem: Error, Equatable {
    let message: String
    let detail: String?
    /// The bridge's code when it refused the request; `nil` when no answer came.
    let code: RejectionCode?

    /// The words of contract §20.4, one sentence per rejection code.
    init(_ rejection: Rejection) {
        let detail = rejection.message.isEmpty ? nil : rejection.message
        let message: String
        switch rejection.code {
        case .forbidden:
            message = "That's outside the folders this Mac shares with Broski."
        case .notFound:
            message = "That isn't on your Mac anymore."
        case .closed:
            message = "This terminal has ended."
        case .busy:
            message = "Twenty terminals are running on your Mac. Close one first."
        case .unsupported:
            message = "Your Mac can't do this."
        case .backendError:
            message = "Something went wrong on your Mac."
        case .invalidInput, .stale, .auth, .noModel, .notSteerable:
            message = "Your Mac didn't do that."
        }
        self.init(message: message, detail: detail, code: rejection.code)
    }

    /// A request that never got an answer from the workspace: the link, the bridge or the core.
    init(_ error: any Error) {
        switch error as? ClientError {
        case .Timeout:
            self.init(message: "Your Mac didn't answer in time. Try again.", detail: nil)
        case .LinkReset:
            self.init(message: "The connection to your Mac started over. Try again.", detail: nil)
        case .Overloaded:
            self.init(message: "Too many requests are waiting. Try again in a moment.", detail: nil)
        case .Incompatible(let detail):
            self.init(message: "Broski and this bridge need the same version.", detail: detail)
        case .Refused(_, let detail), .Rejected(_, let detail), .InvalidRequest(let detail):
            self.init(message: "Your Mac's bridge turned this request away.", detail: detail)
        case .NotSent, .Revoked, .Closed, .Link, .UnexpectedAnswer, nil:
            self.init(message: "Can't reach your Mac right now.", detail: nil)
        }
    }

    init(message: String, detail: String?, code: RejectionCode? = nil) {
        self.message = message
        self.detail = detail
        self.code = code
    }
}
