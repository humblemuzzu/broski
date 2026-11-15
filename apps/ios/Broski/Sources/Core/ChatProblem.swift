import BroskiCore

/// What a chat request could not do: a plain sentence, and the Mac's own words beneath it.
struct ChatProblem: Error, Equatable {
    let message: String
    let detail: String?
    /// The bridge's code when it refused the request; `nil` when no answer came.
    let code: RejectionCode?

    init(_ rejection: Rejection) {
        let message: String
        switch rejection.code {
        case .busy: message = "The agent is busy with a run. Send it as a queued message, or stop the run."
        case .notSteerable: message = "This run can't take a message part way through."
        case .noModel: message = "Choose a model first."
        case .auth: message = "The agent isn't signed in on your Mac."
        case .unsupported: message = "The agent can't do this."
        case .notFound: message = "This session isn't on your Mac anymore."
        case .forbidden: message = "That's outside the folders this Mac shares with Broski."
        case .stale: message = "Already answered elsewhere."
        case .closed: message = "This session has closed."
        case .backendError: message = "Something went wrong on your Mac."
        case .invalidInput: message = "Your Mac didn't take that."
        }
        self.init(message: message, detail: rejection.message.isEmpty ? nil : rejection.message, code: rejection.code)
    }

    /// A request that got no answer: the link, the bridge or the core. Worded as the workspace
    /// words it, since the cause is the same.
    init(_ error: any Error) {
        let problem = WorkspaceProblem(error)
        self.init(message: problem.message, detail: problem.detail)
    }

    init(message: String, detail: String? = nil, code: RejectionCode? = nil) {
        self.message = message
        self.detail = detail
        self.code = code
    }

    var isStale: Bool { code == .stale }
}
