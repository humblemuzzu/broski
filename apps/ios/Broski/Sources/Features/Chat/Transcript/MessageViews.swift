import BroskiCore
import SwiftUI
import UIKit

/// The person's message: the transcript's only container, trailing and sized to its text, images
/// above it, its time and a copy button beneath. A prompt still on its way shows dimmed.
struct UserBubble: View {
    let text: String
    var images: [ImageSource] = []
    var at: Int64?
    var isPending = false
    @State private var copied = 0

    enum ImageSource: Hashable {
        case local(UIImage)
        case remote(ImageRef)
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: Spacing.xs) {
            if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: Spacing.s) {
                        ForEach(images, id: \.self) { AttachmentThumbnail(source: $0) }
                    }
                }
                .scrollIndicators(.hidden)
                .defaultScrollAnchor(.trailing)
            }
            if !text.isEmpty {
                Text(text)
                    .font(.body)
                    .textSelection(.enabled)
                    .padding(.horizontal, Spacing.l - 2)
                    .padding(.vertical, Spacing.m - 2)
                    .background(Color(uiColor: .secondarySystemFill), in: .rect(cornerRadius: Radius.card, style: .continuous))
            }
            footer
        }
        .padding(.leading, Spacing.xxxl)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .opacity(isPending ? 0.55 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isPending ? "You, sending: \(text)" : "You: \(text)")
        .haptic(.confirmed, trigger: copied)
    }

    private var footer: some View {
        HStack(spacing: Spacing.s) {
            if isPending {
                Text("Sending…")
            } else if let at {
                Text(Date(unixMilliseconds: at), format: .dateTime.hour().minute())
            }
            if !isPending && !text.isEmpty {
                CopyButton(text: text, copied: $copied)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.trailing, Spacing.xs)
    }
}

/// An image the person sent: drawn from the phone's copy, or read back from the Mac by reference.
private struct AttachmentThumbnail: View {
    let source: UserBubble.ImageSource
    @Environment(\.loadAttachment) private var load
    @State private var loaded: UIImage?
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 96

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary).overlay { ProgressView() }
            }
        }
        .frame(width: side, height: side)
        .clipShape(.rect(cornerRadius: Radius.small + 4, style: .continuous))
        .accessibilityLabel("Image")
        .task {
            guard case .remote(let ref) = source, loaded == nil else { return }
            loaded = await load(ref)
        }
    }

    private var image: UIImage? {
        if case .local(let image) = source { return image }
        return loaded
    }
}

struct CopyButton: View {
    let text: String
    @Binding var copied: Int

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied += 1
        } label: {
            Image(systemName: copied > 0 ? "checkmark" : "doc.on.doc")
                .contentTransition(.symbolEffect(.replace))
                .frame(minWidth: 28, minHeight: 28)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Copy")
    }
}

/// Under a finished answer: a quiet copy button and its time.
struct AnswerEndView: View {
    let end: AnswerEnd
    @State private var copied = 0

    var body: some View {
        HStack(spacing: Spacing.s) {
            CopyButton(text: end.text, copied: $copied)
            if let at = end.at {
                Text(Date(unixMilliseconds: at), format: .dateTime.hour().minute())
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .haptic(.confirmed, trigger: copied)
    }
}

/// Something the agent said that is not a turn, kept in the transcript as a quiet line.
struct NoticeLine: View {
    let notice: NoticeItem

    var body: some View {
        Label {
            Text(notice.text).textSelection(.enabled)
        } icon: {
            Image(systemName: notice.level.symbol).foregroundStyle(notice.level.tint)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

/// A compaction, a model change, or how a run ended, as a centred caption between turns.
struct MarkerLine: View {
    let marker: Marker

    var body: some View {
        HStack(spacing: Spacing.s) {
            line
            Text(words).fixedSize()
            line
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }

    private var line: some View {
        Rectangle().fill(.quaternary).frame(height: 1)
    }

    private var words: String {
        switch marker {
        case .compaction(let compaction):
            if let before = compaction.tokensBefore, let after = compaction.tokensAfter {
                return "Context compacted · \(before.formatted(.number.notation(.compactName))) → \(after.formatted(.number.notation(.compactName))) tokens"
            }
            return "Context compacted"
        case .model(let change):
            return "Switched to \(change.modelId ?? "the default model")" + (change.thinking.map { " · \($0)" } ?? "")
        case .outcome(let outcome):
            return outcome.marker
        }
    }
}

extension NoticeLevel {
    var symbol: String {
        switch self {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }

    var tint: Color {
        switch self {
        case .info: .secondary
        case .warning: Palette.caution
        case .error: Palette.failed
        }
    }
}

extension RunOutcome {
    var marker: String {
        switch self {
        case .completed: "Done"
        case .aborted: "Stopped"
        case .error(let failed): "Failed · \(failed.error.code.sentence)"
        case .limit(let limited): limited.limit.sentence
        case .deferred: "Paused"
        }
    }
}

/// Reads back an image a message names (`attachment.read`); the chat provides it.
struct AttachmentLoader {
    let load: @MainActor (ImageRef) async -> UIImage?

    func callAsFunction(_ ref: ImageRef) async -> UIImage? {
        await load(ref)
    }
}

extension EnvironmentValues {
    @Entry var loadAttachment = AttachmentLoader { _ in nil }
}
