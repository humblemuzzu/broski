import BroskiCore
import SwiftUI

/// One transcript row, by what it holds. New rows of a live run rise in; a row the lazy stack
/// rebuilds as the person scrolls back (older than ~3 s) just appears, so history never flickers.
struct ChatRowView: View, Equatable {
    let row: ChatRow
    let isFresh: Bool

    nonisolated static func == (lhs: ChatRowView, rhs: ChatRowView) -> Bool {
        lhs.row == rhs.row && lhs.isFresh == rhs.isFresh
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(Arrival(isFresh: isFresh))
            .padding(.top, row.gap)
    }

    @ViewBuilder
    private var content: some View {
        switch row.content {
        case .user(let turn):
            UserBubble(text: turn.text, images: turn.attachments.images, at: turn.at)
        case .pending(let prompt):
            UserBubble(
                text: [prompt.draft.command.map { "/\($0.name)" }, prompt.draft.text].compactMap(\.self)
                    .filter { !$0.isEmpty }.joined(separator: " "),
                images: prompt.draft.images.map { .local($0.thumbnail) }, isPending: true)
        case .work(let fold):
            WorkFoldView(fold: fold)
        case .text(let piece):
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if piece.kind == .plan && piece.isFirst {
                    Label("Plan", systemImage: "list.bullet.clipboard")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                FormatBlockView(block: piece.block).equatable()
            }
        case .answerEnd(let end):
            AnswerEndView(end: end)
        case .notice(let notice):
            NoticeLine(notice: notice)
        case .activity(let entry):
            ActivityRowView(entry: entry)
        case .marker(let marker):
            MarkerLine(marker: marker)
        }
    }
}

private struct Arrival: ViewModifier {
    let isFresh: Bool
    @State private var arrived = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(isFresh && !arrived ? 0 : 1)
            .offset(y: isFresh && !arrived && !reduceMotion ? 8 : 0)
            .onAppear {
                guard isFresh, !arrived else { return }
                withAnimation(.easeOut(duration: 0.22)) { arrived = true }
            }
    }
}

extension [AttachmentRef] {
    var images: [UserBubble.ImageSource] {
        compactMap { if case .imageRef(let ref) = $0 { .remote(ref) } else { nil } }
    }
}
