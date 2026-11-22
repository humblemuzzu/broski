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
            .modifier(Arrival(isFresh: isFresh, fadesOnly: row.isText))
            .padding(.top, row.gap)
    }

    @ViewBuilder
    private var content: some View {
        switch row.content {
        case .user(let turn):
            UserBubble(id: turn.id, text: turn.text, images: turn.attachments.imageTargets)
        case .pending(let prompt):
            UserBubble(
                id: prompt.id,
                text: [prompt.draft.command.map { "/\($0.name)" }, prompt.draft.text].compactMap(\.self)
                    .filter { !$0.isEmpty }.joined(separator: " "),
                images: prompt.draft.images.map { .local(id: $0.id.uuidString, name: $0.content.name) }, isPending: true)
        case .work(let fold):
            WorkFoldView(fold: fold)
        case .text(let piece):
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if piece.kind == .plan && piece.isFirst {
                    Label("Plan", systemImage: "list.bullet.clipboard")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                FormatBlockView(block: piece.block, next: piece.next, streaming: piece.isStreaming).equatable()
            }
            .answerMenu(rowId: row.id, block: piece.block)
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

/// A new row rises in; a new block of the agent's text only fades in, briefly; with Reduce Motion
/// text just appears.
private struct Arrival: ViewModifier {
    let isFresh: Bool
    let fadesOnly: Bool
    @State private var arrived = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let hidden = isFresh && !arrived && !(fadesOnly && reduceMotion)
        content
            .opacity(hidden ? 0 : 1)
            .offset(y: hidden && !fadesOnly && !reduceMotion ? 8 : 0)
            .onAppear {
                guard isFresh, !arrived else { return }
                withAnimation(.easeOut(duration: fadesOnly ? FormatTokens.arrival : 0.22)) { arrived = true }
            }
    }
}

nonisolated extension ChatRow {
    var isText: Bool {
        if case .text = content { true } else { false }
    }
}

extension [AttachmentRef] {
    var imageTargets: [ImageTarget] {
        compactMap { attachment in
            switch attachment {
            case .imageRef(let ref):
                .attachment(ref)
            case .file(let file):
                if file.mimeType?.hasPrefix("image/") == true || isImagePath(path: file.uri) {
                    .file(path: file.uri, name: file.name)
                } else {
                    nil
                }
            }
        }
    }
}
