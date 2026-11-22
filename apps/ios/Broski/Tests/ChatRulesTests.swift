import BroskiCore
import Foundation
import Testing
import ThinkingOrbsKit
import UIKit

@testable import Broski

/// The chat's small rules, each the one place its behaviour lives: the send button's face, the
/// follow-or-detach state, what the status lane says, what a picked image becomes.
@Suite
struct ChatRulesTests {
    @Test func theSendButtonsFaceComesFromRunningContentAndTheBackendsModes() {
        let all: [PromptMode] = [.start, .steer, .queue]
        #expect(SendAction.resolve(running: false, hasContent: true, modes: all) == .send)
        #expect(SendAction.resolve(running: false, hasContent: false, modes: all) == .send)
        #expect(SendAction.resolve(running: true, hasContent: false, modes: all) == .stop)
        #expect(SendAction.resolve(running: true, hasContent: true, modes: all) == .queue, "queue is the default")
        #expect(SendAction.resolve(running: true, hasContent: true, modes: [.start, .steer]) == .steer)
        #expect(SendAction.resolve(running: true, hasContent: true, modes: [.start]) == .wait)
        #expect(SendAction.alternative(to: .queue, modes: all) == .steer)
        #expect(SendAction.alternative(to: .steer, modes: all) == .queue)
        #expect(SendAction.alternative(to: .queue, modes: [.start, .queue]) == nil)
        #expect(SendAction.alternative(to: .send, modes: all) == nil)
        #expect([SendAction.send, .queue, .steer, .stop, .wait].map(\.mode) == [.start, .queue, .steer, nil, nil])
        #expect(SendAction.queue.explanation == "Run after the current turn")
        #expect(SendAction.steer.explanation == "Interrupt what the agent is doing")
    }

    @Test func followingEndsOnlyWhenAFingerMovesAwayAndResumesNearTheEndOrOnAJump() {
        var follow = FollowState()
        follow.dragged(travelled: 0, distanceFromEnd: 300)
        #expect(follow.isFollowing, "content growing under a resting finger does not detach")
        follow.dragged(travelled: 10, distanceFromEnd: 300)
        #expect(follow.isFollowing, "a nudge is not leaving")
        follow.appended(messages: 2)
        #expect(follow.unseen == 0, "a follower has nothing unseen")

        follow.dragged(travelled: 40, distanceFromEnd: 40)
        #expect(!follow.isFollowing, "a drag toward older messages detaches")
        follow.appended(messages: 2)
        follow.appended(messages: 0)
        #expect(follow.unseen == 2, "new messages below a reader are counted, not scrolled to")
        follow.settled(distanceFromEnd: 600)
        #expect(!follow.isFollowing, "resting far from the end stays detached")

        follow.jumped()
        #expect(follow.isFollowing && follow.unseen == 0)
        follow.dragged(travelled: 200, distanceFromEnd: 200)
        follow.settled(distanceFromEnd: 30)
        #expect(follow.isFollowing, "coming to rest near the end follows again")
    }

    @Test func theLaneSaysWhatTheLiveRunWaitsOnAndNothingWithoutOne() {
        let run = ActiveRun(runId: "r", trigger: .prompt, startedAt: 0, items: [Item.user("u", "Go")], droppedItems: 0)
        var snapshot = SessionSnapshot.empty
        #expect(LaneStatus(snapshot) == nil)
        snapshot.run = run
        #expect(LaneStatus(snapshot) == .starting, "a run that has shown nothing says so")
        #expect(LaneStatus.starting.title(at: .now) == "Starting")
        snapshot.run?.items.append(Item.text("b", "Hi"))
        #expect(LaneStatus(snapshot) == .working)
        snapshot.blocks = [OpenBlock(blockId: "t", messageId: "m", kind: .thinking, parentToolCallId: nil, text: "Hmm")]
        #expect(LaneStatus(snapshot) == .thinking, "reasoning streaming last says so")
        #expect(LaneStatus.thinking.title(at: .now) == "Thinking")
        snapshot.blocks.append(OpenBlock(blockId: "a", messageId: "m", kind: .text, parentToolCallId: nil, text: "So"))
        #expect(LaneStatus(snapshot) == .working, "text after the reasoning is work")
        #expect(LaneStatus.waitingForApproval.orb == nil && LaneStatus.thinking.orb == .breathing)
        snapshot.retry = RetryState(attempt: 1, maxAttempts: 3, retryAt: 10_000, message: "overloaded")
        #expect(LaneStatus(snapshot)?.title(at: Date(unixMilliseconds: 2_000)) == "Retrying in 8 s")
        snapshot.compaction = CompactionState(trigger: .auto, startedAt: 0)
        #expect(LaneStatus(snapshot) == .compacting)
        snapshot.interactions = [ask(.choice(ChoiceRequest(options: [])))]
        #expect(LaneStatus(snapshot) == .waitingForAnswer, "an ask that blocks the run comes first")
        snapshot.interactions = [ask(.toolPermission(ToolPermissionRequest(
            input: nil, inputEditable: false, reason: nil, previews: [], options: [], grants: [], defaultOptionId: nil, deliberate: false)))]
        #expect(LaneStatus(snapshot) == .waitingForApproval)
    }

    @Test func aPhotoIsFittedWithinWhatThePromptHasLeftOrRefused() throws {
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 4_000, height: 3_000), format: .init(for: .init(displayScale: 1)))
            .image { context in
                for row in 0..<30 {
                    UIColor(hue: CGFloat(row) / 30, saturation: 0.8, brightness: 0.9, alpha: 1).setFill()
                    context.fill(CGRect(x: 0, y: row * 100, width: 4_000, height: 100))
                }
            }
        let fitted = try #require(ImageFitter.fit(photo, within: ImageFitter.promptBudget))
        let decoded = try #require(Data(base64Encoded: fitted.content.data).flatMap(UIImage.init(data:)))
        #expect(max(decoded.size.width, decoded.size.height) == 2_048, "drawn at most 2048 px on its longer side")
        #expect(fitted.content.mimeType == "image/jpeg")
        #expect(fitted.cost <= ImageFitter.promptBudget)
        #expect(max(fitted.thumbnail.size.width, fitted.thumbnail.size.height) == ImageFitter.thumbnailSide)

        let tight = fitted.cost / 3
        let smaller = try #require(ImageFitter.fit(photo, within: tight), "it steps down to fit what is left")
        #expect(smaller.cost <= tight)
        #expect(ImageFitter.fit(photo, within: 200) == nil, "past the smallest step it gives up")

        let small = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200), format: .init(for: .init(displayScale: 1)))
            .image { $0.fill(CGRect(x: 0, y: 0, width: 300, height: 200)) }
        let kept = try #require(ImageFitter.fit(small, within: ImageFitter.promptBudget))
        #expect(Data(base64Encoded: kept.content.data).flatMap(UIImage.init(data:))?.size == CGSize(width: 300, height: 200), "never enlarged")
    }

    @Test func returnedInputGoesInFrontOfWhatIsTypedAndARefusedDraftComesBack() {
        var draft = ComposerDraft(text: "and then")
        draft.prepend(returned: ["first", "second"])
        #expect(draft.text == "first\n\nsecond\n\nand then")
        var empty = ComposerDraft()
        empty.prepend(returned: ["only"])
        #expect(empty.text == "only")

        let refused = ComposerDraft(text: "Run it")
        #expect(refused.merged(before: ComposerDraft(text: "also")).text == "Run it\n\nalso")
        #expect(refused.input(mode: .queue).mode == .queue)
        #expect(refused.input(mode: .start).clientRequestId != refused.input(mode: .start).clientRequestId, "every prompt has its own id")
    }

    @Test func aSlashAtTheStartOpensTheCommandsAndPickingOneLeavesTheArguments() {
        var draft = ComposerDraft(text: "/rev")
        #expect(draft.commandQuery == "rev")
        #expect(ComposerDraft(text: "/review now").commandQuery == nil, "the list closes once arguments start")
        #expect(ComposerDraft(text: "say /x").commandQuery == nil)
        let review = CommandSummary(id: "/review", name: "review", kind: .command, description: nil, argumentHint: "[path]")
        draft.pick(review)
        #expect(draft.command == review && draft.text.isEmpty && draft.commandQuery == nil)
        #expect(draft.input(mode: .start).command == "/review")
    }

    private func ask(_ request: InteractionRequest) -> Interaction {
        Interaction(id: "i", runId: "r", createdAt: 0, expiresAt: nil, title: "Ask", body: nil, blocksRun: true, origin: nil, request: request)
    }
}
