import BroskiCore
import SwiftUI

enum TranscriptEntry: Equatable {
    case older(problem: String?)
    case row(ChatRow)
    case lane(LaneStatus?, startedAt: Int64?)

    static let olderID = "transcript-older"
    static let laneID = "transcript-lane"
}

struct TranscriptCellContext {
    let app: AppModel
    let disclosure: Disclosure
    let images: ChatImageStore?
    let formatContext: FormatContext?
    let machineId: String?
    let openRoute: OpenRouteAction
    let answerSource: AnswerSource
    let modelNames: ModelNames
    let retryHistory: () -> Void
}

struct TranscriptCell: View {
    let entry: TranscriptEntry
    let isFresh: Bool
    let context: TranscriptCellContext
    let contentWidth: CGFloat?
    let resized: (CGFloat) -> Void

    var body: some View {
        content
            .padding(.horizontal, TranscriptView.sideMargin)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { resized($0) }
            .environment(context.app)
            .environment(context.disclosure)
            .environment(\.chatImages, context.images)
            .environment(\.formatContext, context.formatContext)
            .environment(\.chatMachineId, context.machineId)
            .environment(\.routeOpener, context.openRoute)
            .environment(\.answerSource, context.answerSource)
            .environment(\.modelNames, context.modelNames)
            .environment(\.formatBleed, TranscriptView.sideMargin)
            .environment(\.formatWidthHint, contentWidth)
            .readingSettings()
    }

    @ViewBuilder
    private var content: some View {
        switch entry {
        case .older(let problem):
            OlderPagesRow(problem: problem, retry: context.retryHistory)
        case .row(let row):
            ChatRowView(row: row, isFresh: isFresh).equatable()
        case .lane(let status, let startedAt):
            StatusLaneView(status: status, startedAt: startedAt)
                .padding(.top, Spacing.s)
        }
    }
}

private struct OlderPagesRow: View {
    let problem: String?
    let retry: () -> Void

    var body: some View {
        if let problem {
            Banner(style: .warning, message: "Couldn't read this conversation's history. \(problem)") {
                Button("Try Again", action: retry)
            }
            .padding(.bottom, Spacing.l)
        } else {
            LoadingOrb(label: "Loading earlier messages")
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.l)
        }
    }
}
