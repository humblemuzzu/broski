import BroskiCore
import Foundation

/// Why a recording did not become text: a plain sentence, xAI's or the system's own words beneath
/// it, and what the person can do about it.
struct DictationProblem: Error, Equatable {
    enum Fix: Equatable {
        /// Nothing to do but discard.
        case none
        /// The same recording can go again.
        case retry
        /// The key needs changing, in Voice settings.
        case voiceSettings
        /// The microphone is off for Broski, in iOS Settings.
        case systemSettings
    }

    let message: String
    var detail: String?
    var fix: Fix

    static let microphoneDenied = DictationProblem(
        message: "Broski can't use the microphone. Turn it on in Settings to dictate.", fix: .systemSettings)

    init(message: String, detail: String? = nil, fix: Fix) {
        self.message = message
        self.detail = detail
        self.fix = fix
    }

    init(_ error: DictationError) {
        let retry: Fix = dictationErrorRetryable(error: error) ? .retry : .none
        switch error {
        case .InvalidKey(let detail):
            self.init(message: "xAI didn't accept your API key.", detail: detail, fix: .voiceSettings)
        case .OutOfCredits(let detail):
            self.init(message: "Your xAI account is out of credits. Add some at console.x.ai.", detail: detail, fix: .retry)
        case .Forbidden(let detail):
            self.init(message: "This xAI key isn't allowed to transcribe.", detail: detail, fix: .voiceSettings)
        case .RateLimited(let detail):
            self.init(message: "xAI is busy right now. Try again in a moment.", detail: detail, fix: retry)
        case .TooLarge:
            self.init(message: "That recording is too long to send.", fix: .none)
        case .Rejected(let detail):
            self.init(message: "xAI couldn't transcribe this recording.", detail: detail, fix: .none)
        case .Unavailable(let status, let detail):
            self.init(message: "xAI's transcription isn't answering. Try again.", detail: "\(status) \(detail)".trimmed, fix: retry)
        case .Unexpected(let status, let detail):
            self.init(message: "xAI answered in a way Broski didn't expect.", detail: "\(status) \(detail)".trimmed, fix: retry)
        }
    }

    /// A request that got no answer: no connection, or one too slow.
    init(transport error: URLError) {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff,
            .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            self.init(message: "No connection to xAI. Your recording is kept; try again when you're online.", fix: .retry)
        case .timedOut:
            self.init(message: "xAI took too long to answer. Your recording is kept.", fix: .retry)
        default:
            self.init(message: "The recording didn't reach xAI.", detail: error.localizedDescription, fix: .retry)
        }
    }

    /// Whether the failure was the connection, which this phone's own recognizer can stand in for.
    static func isOffline(_ error: URLError) -> Bool {
        [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff,
         .cannotFindHost, .dnsLookupFailed].contains(error.code)
    }
}
