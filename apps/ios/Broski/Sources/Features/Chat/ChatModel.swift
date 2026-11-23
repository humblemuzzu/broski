import BroskiCore
import Foundation
import Observation
import UIKit
import os

/// One open chat: the session view's state as the core hands it over, the finished runs read from
/// the transcript, the rows both make, and what the person has sent that has not landed yet.
@Observable
final class ChatModel {
    let machineId: String
    private(set) var session: SessionRef
    private(set) var state = SessionState()
    var history = TranscriptHistory()
    var historyRows: [ChatRow] = []
    var liveRows: [ChatRow] = []
    var pending: [PendingPrompt] = []
    private(set) var notices: [ChatNotice] = []
    private(set) var summary: SessionSummary?
    private(set) var renamedTitle: String?
    var historyProblem: ChatProblem?
    var isLoadingOlder = false
    var isRevealed = false
    private(set) var follow = FollowState()
    private(set) var jumpRequest: TranscriptJump?
    var draft: ComposerDraft {
        didSet { drafts[target] = draft }
    }
    private(set) var answering: Set<String> = []
    private(set) var answerProblems: [String: ChatProblem] = [:]
    private(set) var feedback: ChatFeedback?
    /// A model, level or mode the person picked that the session has not reported yet.
    var pendingChoice: ComposerChoices?

    @ObservationIgnored let requests: ChatRequests
    @ObservationIgnored let imageStore: ChatImageStore
    @ObservationIgnored private let attach: (SessionRef) throws -> SessionView
    @ObservationIgnored private let drafts: DraftStore
    @ObservationIgnored var settling: [TranscriptItem] = [] {
        didSet { settlingRevision &+= 1 }
    }
    @ObservationIgnored var settlingRevision = 0
    @ObservationIgnored var historyRevision = 0
    @ObservationIgnored var livePrefixCache: (key: LivePrefixKey, timeline: ChatTimeline)?
    @ObservationIgnored private var firstPrompt: ComposerDraft?
    @ObservationIgnored var freshRowIDs: Set<String> = []
    @ObservationIgnored var pull: Task<Void, Never>?
    @ObservationIgnored var newestReads = 0
    @ObservationIgnored var newestRetry: Task<Void, Never>?
    @ObservationIgnored var newestFailures = 0
    @ObservationIgnored var olderFailed = false
    @ObservationIgnored var rowAliases: [String: String] = [:]
    @ObservationIgnored private var nextJumpID = 0
    @ObservationIgnored let pacer = StreamingPacer()
    @ObservationIgnored var newestRetryPause: (Int) -> Duration = { .seconds(min(30, 1 << min($0, 5))) }

    static let revealWait: Duration = .milliseconds(1200)

    init(
        target: SessionTarget, requests: ChatRequests, workspace: WorkspaceRequests? = nil, drafts: DraftStore,
        firstPrompt: ComposerDraft? = nil,
        attach: @escaping (SessionRef) throws -> SessionView
    ) {
        machineId = target.machineId
        session = target.session
        self.requests = requests
        self.drafts = drafts
        self.attach = attach
        self.firstPrompt = firstPrompt
        draft = drafts[target]
        let ws = workspace ?? WorkspaceRequests(send: requests.send)
        var current: () -> SessionRef = { target.session }
        let store = ChatImageStore(requests: requests, workspace: ws, session: { current() })
        self.imageStore = store
        current = { [weak self] in self?.session ?? target.session }
        pacer.onTick = { [weak self] in self?.rebuildLive(arriving: true) }
    }

    var target: SessionTarget { SessionTarget(machineId: machineId, session: session) }
    var snapshot: SessionSnapshot { state.snapshot }
    var isRunning: Bool { state.isRunning }
    var interactions: [Interaction] { snapshot.interactions }
    var canControl: Bool { state.capabilities?.controllable ?? false }
    var canAnswer: Bool { state.capabilities?.answer ?? false }
    var viewEnd: ViewEnd? { state.ended }
    var isLive: Bool { state.isLive }

    func start() {
        guard pull == nil else { return }
        if firstPrompt == nil { firstPrompt = drafts.takeFirstPrompt(for: target) }
        let view: SessionView
        do {
            view = try attach(session)
        } catch {
            notify(ChatNotice(ChatProblem(error)))
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
        newestRetry?.cancel()
    }

    func stopStreamingPacer() {
        pacer.stop()
    }

    func reattach() {
        pull?.cancel()
        pull = nil
        pacer.reset()
        livePrefixCache = nil
        state = SessionState()
        start()
    }

    func apply(_ update: SessionUpdate) {
        let before = state.snapshot.lastOutcome
        let previous = session
        let wasAttached = state.session != nil
        for moment in state.apply(update) {
            handle(moment)
        }
        if case .changes = update, state.snapshot.lastOutcome != before, let outcome = state.snapshot.lastOutcome,
            let notice = ChatNotice(outcome: outcome)
        {
            notify(notice)
        }
        if let replaced = state.session, replaced != previous {
            session = replaced
            history = TranscriptHistory()
            historyRows = []
            rowAliases = [:]
            pacer.reset()
            Task { await loadNewest() }
        } else if case .reset = update, wasAttached {
            pacer.flush()
            Task { await loadNewest() }
        }
        retireDelivered(state.snapshot.run?.items.deliveredRequests ?? [])
        bindConfirmedImages(in: state.snapshot.run?.items ?? [])
        if case .changes = update { rebuildLive(arriving: true) } else { rebuildLive(arriving: false) }
        if case .ended = update { isRevealed = true }
        settlePendingChoice()
        revealIfReady()
        sendFirstPromptIfReady()
    }

    private func handle(_ moment: SessionMoment) {
        switch moment {
        case .notice(let notice): notify(ChatNotice(notice, transcribed: true))
        case .activity(let item): settling.append(.activity(item))
        case .error(let error): notify(ChatNotice(error))
        case .rateLimit(let update): if let notice = ChatNotice(rateLimit: update) { notify(notice) }
        case .inputReturned(let texts): draft.prepend(returned: texts)
        case .runEnded(let items):
            pacer.flush()
            notices.removeAll { $0.tone == .info && $0.isTranscribed }
            settling += items
            Task { await loadNewest() }
        }
    }

    func dismiss(_ notice: ChatNotice) {
        notices.removeAll { $0.id == notice.id }
    }

    func report(_ problem: ChatProblem) {
        notify(ChatNotice(problem))
        play(.failed)
    }

    private func notify(_ notice: ChatNotice) {
        notices.show(notice)
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

    /// Assigns only when the value actually changed, preventing feedback loops when scroll events
    /// report back into `@Observable` state during layout.
    func updateFollow(_ change: (inout FollowState) -> Void) {
        var next = follow
        change(&next)
        if next != follow { follow = next }
    }

    // MARK: Sending & Jumps

    func send(_ action: SendAction) async {
        guard let mode = action.mode, draft.hasContent else { return }
        let sent = draft
        draft = ComposerDraft()
        await deliver(sent, mode: mode)
    }

    func requestJump() {
        updateFollow { $0.jumped() }
        nextJumpID += 1
        jumpRequest = TranscriptJump(id: nextJumpID, kind: .end)
    }

    func requestPromptAnchor(_ rowID: String) {
        updateFollow { $0.jumped() }
        nextJumpID += 1
        jumpRequest = TranscriptJump(id: nextJumpID, kind: .anchorPrompt(rowID))
    }

    private func deliver(_ sent: ComposerDraft, mode: PromptMode) async {
        let input = sent.input(mode: mode)
        imageStore.rememberOutgoing(requestId: input.clientRequestId, images: sent.images)
        if mode == .start { pending.append(PendingPrompt(id: input.clientRequestId, draft: sent)) }
        rebuildLive(arriving: true)
        if mode == .start {
            let promptRowID = ChatTimeline.userRowID(input.clientRequestId, clientRequestId: input.clientRequestId)
            requestPromptAnchor(promptRowID)
        } else {
            requestJump()
        }
        feedback = ChatFeedback(.sent)
        do throws(ChatProblem) {
            let accepted = try await requests.prompt(session, input)
            if accepted.disposition == .queued || accepted.disposition == .handled {
                retire(input.clientRequestId)
            }
        } catch {
            retire(input.clientRequestId)
            draft = sent.merged(before: draft)
            notify(ChatNotice(error))
            feedback = ChatFeedback(.failed)
            Logger.core.error("a prompt was refused: \(error.message, privacy: .public)")
        }
    }

    private func sendFirstPromptIfReady() {
        guard let firstPrompt, state.session != nil else { return }
        self.firstPrompt = nil
        Task { await deliver(firstPrompt, mode: .start) }
    }

    func stop() async {
        feedback = ChatFeedback(.stopped)
        do throws(ChatProblem) {
            try await requests.abort(session)
        } catch {
            notify(ChatNotice(error))
        }
    }

    func cancelQueued(_ item: QueueItem) async {
        do throws(ChatProblem) {
            try await requests.cancelQueued(session, id: item.id)
            feedback = ChatFeedback(.destructive)
        } catch {
            notify(ChatNotice(error))
        }
    }

    // MARK: Answers

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
