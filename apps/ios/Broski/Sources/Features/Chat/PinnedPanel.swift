import BroskiCore
import SwiftUI

/// What sits pinned above the composer, never in the scroll: what runs in the background, the
/// notices, the queued messages and the first ask, each as one quiet card that springs in.
struct PinnedPanel: View {
    let chat: ChatModel
    let agent: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hasCards: Bool {
        !chat.snapshot.backgroundTasks.isEmpty
            || chat.viewEnd != nil
            || !chat.notices.isEmpty
            || !chat.snapshot.queue.isEmpty
            || !chat.interactions.isEmpty
    }

    var body: some View {
        if hasCards {
            ScrollView {
                cards
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var cards: some View {
        VStack(spacing: Spacing.s) {
            if !chat.snapshot.backgroundTasks.isEmpty {
                BackgroundTasksCard(tasks: chat.snapshot.backgroundTasks)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if let end = chat.viewEnd {
                ViewEndCard(end: end) { chat.reattach() }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            ForEach(chat.notices) { notice in
                NoticeCard(notice: notice) { chat.dismiss(notice) }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if !chat.snapshot.queue.isEmpty {
                QueueCard(items: chat.snapshot.queue, canCancel: chat.state.capabilities?.cancelQueued ?? false) { item in
                    Task { await chat.cancelQueued(item) }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if let interaction = chat.interactions.first {
                InteractionPanel(chat: chat, interaction: interaction, agent: agent)
                    .id(interaction.id)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .spring(duration: 0.22, bounce: 0.1), value: chat.interactions.first?.id)
        .animation(.easeOut(duration: 0.2), value: chat.snapshot.queue)
        .animation(.easeOut(duration: 0.2), value: chat.snapshot.backgroundTasks.isEmpty)
        .animation(.easeOut(duration: 0.2), value: chat.notices)
        .animation(.easeOut(duration: 0.2), value: chat.viewEnd)
    }
}

/// Why nothing live reaches the chat any more, and a way back when the Mac only refused.
private struct ViewEndCard: View {
    let end: ViewEnd
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Image(systemName: "bolt.horizontal.circle").foregroundStyle(Palette.caution).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(message).font(.footnote).lineLimit(4)
                if case .refused(let detail) = end, !detail.isEmpty {
                    Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(3).textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            if case .refused = end {
                Button("Try Again", action: retry).font(.footnote.weight(.semibold)).buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s + 2)
        .panelCard()
        .accessibilityElement(children: .combine)
    }

    private var message: String {
        switch end {
        case .removed: "This session was deleted on your Mac."
        case .refused: "Your Mac couldn't open this session live."
        case .closed: "This Mac isn't paired anymore."
        case .revoked: "This phone was removed from your Mac. Pair again to follow this session."
        }
    }
}

/// One notice or failure: a plain sentence, the detail tucked beneath, and a way to put it away.
private struct NoticeCard: View {
    let notice: ChatNotice
    let dismiss: () -> Void
    static let messageHeight: CGFloat = 84

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                FormattedMessage(text: notice.message, role: .quiet)
                    .frame(maxHeight: Self.messageHeight, alignment: .top)
                    .clipped()
                if let detail = notice.detail {
                    Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(3).textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s + 2)
        .panelCard()
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch notice.tone {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }

    private var tint: Color {
        switch notice.tone {
        case .info: .secondary
        case .warning: Palette.caution
        case .error: Palette.failed
        }
    }
}

/// Messages waiting for the run: each as a quiet row, cancellable where the backend allows it.
private struct QueueCard: View {
    let items: [QueueItem]
    let canCancel: Bool
    let cancel: (QueueItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(items, id: \.id) { item in
                HStack(spacing: Spacing.s) {
                    Image(systemName: item.delivery == .steer ? "arrow.turn.left.up" : "clock")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(item.delivery == .steer ? "Steering" : "Queued").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(item.preview).font(.footnote).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    if canCancel {
                        Button { cancel(item) } label: {
                            Image(systemName: "xmark.circle.fill").font(.body).foregroundStyle(.tertiary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Cancel queued message")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s + 2)
        .panelCard()
    }
}
