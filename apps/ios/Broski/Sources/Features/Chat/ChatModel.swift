import BroskiCore
import Foundation
import Observation
import UIKit
import os

/// One open chat: the session view's state as the core hands it over, the finished runs read from
/// the transcript, the rows both make, and what the person has sent that has not landed yet. The
/// view stays attached while the chat is on screen, which is also what lets the bridge take its
/// prompts and stops (contract §12.1).
@Observable
final class ChatModel {
    let machineId: String
    private(set) var session: SessionRef
    private(set) var state = SessionState()
    private(set) var history = TranscriptHistory()
    private(set) var historyRows: [ChatRow] = []
    private(set) var liveRows: [ChatRow] = []
    private(set) var pending: [PendingPrompt] = []
    private(set) var notices: [ChatNotice] = []
    /// The session's row as `session.get` gave it: its title and folder.
    private(set) var summary: SessionSummary?
    /// The title the person gave here, shown for the rest of the visit whatever the row says.
    private(set) var renamedTitle: String?
    private(set) var historyProblem: ChatProblem?
    private(set) var isLoadingOlder = false
    /// False until the newest page and the live state are both in (or a short wait passed), so the
    /// transcript never builds itself in front of the person.
    private(set) var isRevealed = false
    var follow = FollowState()
    var draft: ComposerDraft {
        didSet { drafts[target] = draft }
    }
    /// The interactions whose answers are on their way, and what came of each answered one.
    private(set) var answering: Set<String> = []
    private(set) var answerProblems: [String: ChatProblem] = [:]
    /// Bumped by every send, answer and stop, for the haptics they play.
    private(set) var feedback: ChatFeedback?

    @ObservationIgnored let requests: ChatRequests
    @ObservationIgnored private let attach: (SessionRef) throws -> SessionView
    @ObservationIgnored private let drafts: DraftStore
    @ObservationIgnored private let markdown = MarkdownCache()
    /// The items of a run that ended, and activities outside any run, shown until the transcript's
    /// newest page holds them.
    @ObservationIgnored private var settling: [TranscriptItem] = []
    @ObservationIgnored private var firstPrompt: ComposerDraft?
    /// When each live row that rises in was first built.
    @ObservationIgnored private var births: [String: Date] = [:]
    @ObservationIgnored private var pull: Task<Void, Never>?
    @ObservationIgnored private var images: [String: UIImage] = [:]
    @ObservationIgnored private var newestReads = 0

    static let revealWait: Duration = .milliseconds(1200)

    init(
        target: SessionTarget, requests: ChatRequests, drafts: DraftStore, firstPrompt: ComposerDraft? = nil,
        attach: @escaping (SessionRef) throws -> SessionView
    ) {
        machineId = target.machineId
        session = target.session
        self.requests = requests
        self.drafts = drafts
        self.attach = attach
        self.firstPrompt = firstPrompt
        draft = drafts[target]
    }

    var target: SessionTarget { SessionTarget(machineId: machineId, session: session) }
    var snapshot: SessionSnapshot { state.snapshot }
    var isRunning: Bool { state.isRunning }
    var interactions: [Interaction] { snapshot.interactions }
    var canControl: Bool { state.capabilities?.controllable ?? false }
    var canAnswer: Bool { state.capabilities?.answer ?? false }

    /// Attaches the view and pulls it for as long as the chat lives. The stack keeps a chat alive
    /// while a diff or another session is pushed over it; its end cancels the pull, and the
    /// cancellation detaches the view, which is what ends a Swift pull (mobile-packaging.md §1).
    func start() {
        guard pull == nil else { return }
        let view: SessionView
        do {
            view = try attach(session)
        } catch {
            notices.append(ChatNotice(ChatProblem(error)))
            isRevealed = true
            return
        }
        Task { [weak self] in
            try? await Task.sleep(for: Self.revealWait)
            self?.isRevealed = true
        }
        Task { await loadNewest() }
        pull = Task { [weak self] in
            await withTaskCancellationHandler {
                while let update = await view.nextUpdate() {
                    guard let self else { return }
                    self.apply(update)
                }
            } onCancel: {
                view.detach()
            }
        }
    }

    deinit {
        pull?.cancel()
    }

    func apply(_ update: SessionUpdate) {
        let before = state.snapshot.lastOutcome
        let previous = session
        for moment in state.apply(update) {
            handle(moment)
        }
        if case .changes = update, state.snapshot.lastOutcome != before, let outcome = state.snapshot.lastOutcome,
            let notice = ChatNotice(outcome: outcome)
        {
            notices.append(notice)
        }
        if let replaced = state.session, replaced != previous {
            session = replaced
            history = TranscriptHistory()
            historyRows = []
            Task { await loadNewest() }
        }
        retireDelivered(state.snapshot.run?.items.deliveredRequests ?? [])
        if case .changes = update { rebuildLive() } else { rebuildLive(arriving: false) }
        revealIfReady()
        sendFirstPromptIfReady()
    }

    private func handle(_ moment: SessionMoment) {
        switch moment {
        case .notice(let notice): notices.append(ChatNotice(notice, transcribed: true))
        case .activity(let item): settling.append(.activity(item))
        case .error(let error): notices.append(ChatNotice(error))
        case .rateLimit(let update): if let notice = ChatNotice(rateLimit: update) { notices.append(notice) }
        case .inputReturned(let texts): draft.prepend(returned: texts)
        case .runEnded(let items):
            notices.removeAll { $0.tone == .info && $0.isTranscribed }
            settling += items
            Task { await loadNewest() }
        }
    }

    func dismiss(_ notice: ChatNotice) {
        notices.removeAll { $0.id == notice.id }
    }

    func report(_ problem: ChatProblem) {
        notices.append(ChatNotice(problem))
        play(.failed)
    }

    func play(_ moment: HapticMoment) {
        feedback = ChatFeedback(moment)
    }

    func adopt(_ summary: SessionSummary) {
        guard summary.session == session else { return }
        self.summary = summary
    }

    func rename(to title: String) async {
        let title = title.trimmed
        guard !title.isEmpty else { return }
        do throws(ChatProblem) {
            try await requests.rename(session, to: title)
            renamedTitle = title
        } catch {
            report(error)
        }
    }

    /// An image a message names, read back from the Mac once and kept while the chat is open.
    func image(_ ref: ImageRef) async -> UIImage? {
        if let known = images[ref.id] { return known }
        guard let read = try? await requests.attachment(session, id: ref.id),
            let data = Data(base64Encoded: read.data), let image = UIImage(data: data)
        else { return nil }
        images[ref.id] = image
        return image
    }

    // MARK: Transcript

    /// Reads the newest page; an answer to an earlier read that comes after a later one's is dropped,
    /// since it may not hold the run that just ended.
    func loadNewest() async {
        let session = session
        newestReads += 1
        let read = newestReads
        do throws(ChatProblem) {
            let page = try await requests.transcript(session, cursor: nil, limit: TranscriptHistory.pageSize)
            guard session == self.session, read == newestReads else { return }
            history.setNewest(page)
            settling = []
            historyProblem = nil
        } catch {
            Logger.core.error("the transcript was not read: \(error.message, privacy: .public)")
            guard read == newestReads else { return }
            historyProblem = error
        }
        retireDelivered(history.deliveredRequests)
        rebuildHistory()
        revealIfReady()
    }

    func loadOlder() async {
        guard let cursor = history.olderCursor, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do throws(ChatProblem) {
            history.addOlder(try await requests.transcript(session, cursor: cursor, limit: TranscriptHistory.pageSize))
            rebuildHistory()
        } catch {
            historyProblem = error
        }
    }

    private func rebuildHistory() {
        var timeline = ChatTimeline(parse: markdown.blocks)
        timeline.add(history.items)
        timeline.close(live: false)
        historyRows = timeline.rows
        rebuildLive()
    }

    /// - Parameter arriving: whether rows new to the live part arrive now (and rise in), or were
    ///   there already when the view started over.
    private func rebuildLive(arriving: Bool = true) {
        let previous = historyRows.last
        var timeline = ChatTimeline(after: previous, parse: markdown.blocks)
        timeline.add(settling)
        if let run = snapshot.run {
            timeline.addLive(items: run.items, blocks: snapshot.blocks, tools: snapshot.tools)
        }
        timeline.close(live: isRunning)
        for prompt in pending { timeline.append(pending: prompt) }
        let rows = timeline.finished(continuing: previous)
        follow.appended(messages: rows.count(where: \.startsMessage) - liveRows.count(where: \.startsMessage))
        let now = Date.now
        let ids = Set(rows.map(\.id))
        births = births.filter { ids.contains($0.key) }
        for row in rows where row.risesIn && births[row.id] == nil { births[row.id] = arriving ? now : .distantPast }
        liveRows = rows
    }

    /// A live row built within the last three seconds, which rises in when it appears.
    func isFresh(_ row: ChatRow) -> Bool {
        births[row.id].map { Date.now.timeIntervalSince($0) < 3 } ?? false
    }

    private func revealIfReady() {
        guard !isRevealed, state.session != nil, history.isLoaded || historyProblem != nil else { return }
        isRevealed = true
    }

    // MARK: Sending

    /// Sends what the draft holds the way `action` says; the person's bubble shows at once, dimmed
    /// until the agent shows it delivered. A refused prompt goes back into the field.
    func send(_ action: SendAction) async {
        guard let mode = action.mode, draft.hasContent else { return }
        let sent = draft
        draft = ComposerDraft()
        await deliver(sent, mode: mode)
    }

    private func deliver(_ sent: ComposerDraft, mode: PromptMode) async {
        let input = sent.input(mode: mode)
        pending.append(PendingPrompt(id: input.clientRequestId, draft: sent))
        rebuildLive()
        feedback = ChatFeedback(.sent)
        do throws(ChatProblem) {
            let accepted = try await requests.prompt(session, input)
            if accepted.disposition == .queued || accepted.disposition == .handled {
                retire(input.clientRequestId)
            }
        } catch {
            retire(input.clientRequestId)
            draft = sent.merged(before: draft)
            notices.append(ChatNotice(error))
            feedback = ChatFeedback(.failed)
            Logger.core.error("a prompt was refused: \(error.message, privacy: .public)")
        }
    }

    /// A new session's first prompt goes once the view is attached, which the bridge requires.
    private func sendFirstPromptIfReady() {
        guard let firstPrompt, state.session != nil else { return }
        self.firstPrompt = nil
        Task { await deliver(firstPrompt, mode: .start) }
    }

    private func retireDelivered(_ delivered: Set<String>) {
        guard !delivered.isEmpty else { return }
        pending.removeAll { delivered.contains($0.id) }
    }

    private func retire(_ id: String) {
        pending.removeAll { $0.id == id }
        rebuildLive()
    }

    func stop() async {
        feedback = ChatFeedback(.stopped)
        do throws(ChatProblem) {
            try await requests.abort(session)
        } catch {
            notices.append(ChatNotice(error))
        }
    }

    func cancelQueued(_ item: QueueItem) async {
        do throws(ChatProblem) {
            try await requests.cancelQueued(session, id: item.id)
            feedback = ChatFeedback(.destructive)
        } catch {
            notices.append(ChatNotice(error))
        }
    }

    // MARK: Answers

    /// Sends exactly the reply the person chose. The card stays until the bridge withdraws the ask
    /// (`InteractionRemoved`); a refusal as stale says another answer got there first.
    func answer(_ interaction: Interaction, _ reply: InteractionReply) async {
        guard answering.insert(interaction.id).inserted else { return }
        defer { answering.remove(interaction.id) }
        answerProblems[interaction.id] = nil
        do throws(ChatProblem) {
            try await requests.answer(session, InteractionAnswer(interactionId: interaction.id, reply: reply))
            feedback = ChatFeedback(interaction.isRefusal(reply) ? .destructive : .confirmed)
        } catch {
            answerProblems[interaction.id] = error
            feedback = ChatFeedback(error.isStale ? .destructive : .failed)
        }
    }
}

/// A moment the chat plays a haptic for; a new value each time, so the same moment twice plays twice.
struct ChatFeedback: Equatable {
    let id = UUID()
    let moment: HapticMoment

    init(_ moment: HapticMoment) {
        self.moment = moment
    }
}

extension Interaction {
    /// A denial or a dismissal, which plays the warning haptic rather than the success one.
    func isRefusal(_ reply: InteractionReply) -> Bool {
        switch (reply, request) {
        case (.cancel, _): true
        case (.confirm(let reply), _): !reply.confirmed
        case (.planApproval(let reply), _): reply.decision == .reject
        case (.toolPermission(let reply), .toolPermission(let request)):
            request.options.first { $0.id == reply.optionId }?.effect == .deny
        default: false
        }
    }
}

extension ComposerDraft {
    /// A refused draft back in the field, in front of anything typed since.
    func merged(before typed: ComposerDraft) -> ComposerDraft {
        var merged = self
        if !typed.text.isEmpty { merged.text = text.isEmpty ? typed.text : text + "\n\n" + typed.text }
        merged.images += typed.images
        merged.command = command ?? typed.command
        return merged
    }
}
