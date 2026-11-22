import BroskiCore
import Foundation

/// A quiet card in the pinned panel: something the agent said that is not a turn, a failure, or a
/// message that did not go out. A plain sentence; the code, if any, tucked beneath.
struct ChatNotice: Identifiable, Equatable {
    enum Tone: Equatable {
        case info
        case warning
        case error
    }

    let id = UUID()
    let tone: Tone
    let message: String
    var detail: String?
    /// The agent's own notice, which its transcript keeps too: an informational one leaves the
    /// panel when the run ends, since the transcript shows it from then on.
    var isTranscribed = false

    init(tone: Tone, message: String, detail: String? = nil) {
        self.tone = tone
        self.message = message
        self.detail = detail
    }

    init(_ notice: NoticeEvent, transcribed: Bool) {
        let tone: Tone =
            switch notice.level {
            case .info: .info
            case .warning: .warning
            case .error: .error
            }
        self.init(tone: tone, message: notice.text)
        isTranscribed = transcribed
    }

    init(_ error: ErrorEvent) {
        self.init(tone: .error, message: error.error.code.sentence, detail: error.error.message.isEmpty ? nil : error.error.message)
    }

    init(_ problem: ChatProblem) {
        self.init(tone: .error, message: problem.message, detail: problem.detail)
    }

    /// How a run ended, when it did not complete: `nil` for a completed or deferred run.
    init?(outcome: RunOutcome) {
        switch outcome {
        case .completed, .deferred, .aborted: return nil
        case .error(let failed):
            self.init(tone: .error, message: failed.error.code.sentence, detail: failed.error.message.isEmpty ? nil : failed.error.message)
        case .limit(let limited):
            self.init(tone: .warning, message: limited.limit.sentence)
        }
    }

    /// A rate limit worth saying: a warning, or a refusal with when it lifts.
    init?(rateLimit: RateLimitUpdate) {
        let resets = rateLimit.resetsAt.map {
            Date(unixMilliseconds: $0).formatted(date: .omitted, time: .shortened)
        }
        switch rateLimit.status {
        case .rejected:
            self.init(tone: .warning, message: resets.map { "Usage limit reached. It resets at \($0)." } ?? "Usage limit reached.")
        case .allowedWarning:
            let used = rateLimit.usedPercent.map { "\(Int($0.rounded()))% of" } ?? "Most of"
            self.init(tone: .info, message: "\(used) the usage limit is used.")
        case .allowed, nil:
            return nil
        }
    }
}

extension [ChatNotice] {
    static let shownLimit = 3

    /// A notice already shown is not shown twice, and the panel keeps the newest three: a repeated
    /// warning (a rate limit on every request) never piles cards over the transcript.
    mutating func show(_ notice: ChatNotice) {
        guard !contains(where: { $0.tone == notice.tone && $0.message == notice.message }) else { return }
        append(notice)
        if count > Self.shownLimit { removeFirst(count - Self.shownLimit) }
    }
}

extension ErrorCode {
    var sentence: String {
        switch self {
        case .auth: "The agent isn't signed in on your Mac."
        case .rateLimit: "The model's rate limit was hit."
        case .quota: "The account's quota is used up."
        case .contextOverflow: "The conversation is too long for the model. Compact it to go on."
        case .modelUnavailable: "The model isn't available right now."
        case .contentFilter: "The model declined to answer this."
        case .network: "The agent lost its connection to the model."
        case .server: "The model's service had a problem."
        case .tool: "A tool failed."
        case .invalidRequest: "The model refused the request."
        case .backendUnavailable: "The agent isn't running on your Mac."
        case .unknown: "Something went wrong."
        }
    }
}

extension RunLimit {
    var sentence: String {
        switch self {
        case .maxTurns: "The run stopped at its turn limit."
        case .budget: "The run stopped at its budget."
        case .outputTokens: "The answer stopped at the model's output limit."
        }
    }
}
