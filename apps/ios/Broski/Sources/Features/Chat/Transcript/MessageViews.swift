import BroskiCore
import SwiftUI
import ThinkingOrbsKit
import UIKit

/// The person's message: the transcript's only container, trailing and sized to its text, images
/// above it, its time and a copy button beneath. A prompt still on its way shows dimmed.
struct UserBubble: View {
    let text: String
    var images: [ImageTarget] = []
    var at: Int64?
    var isPending = false
    @State private var copied = 0

    var body: some View {
        VStack(alignment: .trailing, spacing: Spacing.xs + 2) {
            if !images.isEmpty {
                PromptImageGallery(images: images)
            }
            if !text.isEmpty {
                FormattedMessage(text: text)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.l - 2)
                    .padding(.vertical, Spacing.m - 2)
                    .background(Color(uiColor: .secondarySystemFill), in: .rect(cornerRadius: Radius.card, style: .continuous))
            }
            footer
        }
        .padding(.leading, Spacing.xxxl)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .opacity(isPending ? 0.55 : 1)
        .accessibilityElement(children: .contain)
        .haptic(.confirmed, trigger: copied)
        .contextMenu {
            if !text.isEmpty { AnswerMenuItems { text } }
        }
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

/// Adaptive prompt image layout: single image keeps its natural aspect ratio, 2–3 sit side-by-side,
/// 4+ form a 2×2 grid with a `+N` badge on the fourth tile. Tapping any tile opens the full viewer.
private struct PromptImageGallery: View {
    let images: [ImageTarget]
    @Environment(\.chatImages) private var store
    @ScaledMetric(relativeTo: .body) private var tileSide: CGFloat = 104

    var body: some View {
        if images.count == 1, let only = images.first {
            SinglePromptImage(target: only) { open(at: 0) }
        } else if images.count <= 3 {
            HStack(spacing: Spacing.xs + 2) {
                ForEach(Array(images.enumerated()), id: \.element.id) { index, target in
                    AttachmentTile(target: target, size: CGSize(width: tileSide, height: tileSide), cornerRadius: 14) {
                        open(at: index)
                    }
                }
            }
        } else {
            let shown = Array(images.prefix(4))
            let extra = images.count - 4
            Grid(horizontalSpacing: Spacing.xs + 2, verticalSpacing: Spacing.xs + 2) {
                GridRow {
                    tile(shown[0], index: 0, extra: 0)
                    tile(shown[1], index: 1, extra: 0)
                }
                GridRow {
                    tile(shown[2], index: 2, extra: 0)
                    tile(shown[3], index: 3, extra: extra)
                }
            }
        }
    }

    private func tile(_ target: ImageTarget, index: Int, extra: Int) -> some View {
        AttachmentTile(target: target, size: CGSize(width: tileSide, height: tileSide), cornerRadius: 14) {
            open(at: index)
        }
        .overlay {
            if extra > 0 {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.black.opacity(0.48))
                    .overlay {
                        Text("+\(extra)")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                    .allowsHitTesting(false)
            }
        }
    }

    private func open(at index: Int) {
        guard let store else { return }
        ImageViewer.present(items: images, initialIndex: index, store: store)
    }
}

private struct SinglePromptImage: View {
    let target: ImageTarget
    let onTap: () -> Void
    @Environment(\.chatImages) private var store

    var body: some View {
        let _ = store?.revision
        let image = store?.cachedThumbnail(for: target)
        let size = fittedSize(for: image)
        AttachmentTile(target: target, size: size, cornerRadius: 16, onTap: onTap)
    }

    private func fittedSize(for image: UIImage?) -> CGSize {
        guard let image, image.size.width > 0, image.size.height > 0 else {
            return CGSize(width: 176, height: 132)
        }
        let ratio = image.size.width / image.size.height
        let maxW: CGFloat = 240
        let maxH: CGFloat = 210
        let minSide: CGFloat = 104
        if ratio >= 1 {
            let width = min(maxW, max(minSide, maxH * ratio))
            let height = max(minSide * 0.75, min(maxH, width / ratio))
            return CGSize(width: width.rounded(), height: height.rounded())
        } else {
            let height = min(maxH, max(minSide, maxW / ratio))
            let width = max(minSide * 0.75, min(maxW, height * ratio))
            return CGSize(width: width.rounded(), height: height.rounded())
        }
    }
}

/// Reusable thumbnail tile for prompt attachments and tool results: loads lazily, shows retry on
/// failure instead of spinning forever, and opens the full-screen image viewer on tap.
struct AttachmentTile: View {
    let target: ImageTarget
    let size: CGSize
    var cornerRadius: CGFloat = 14
    let onTap: () -> Void
    @Environment(\.chatImages) private var store

    var body: some View {
        let _ = store?.revision
        let state = store?.thumbnailState(for: target) ?? .idle
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        Button {
            if case .failed = state {
                Task { await store?.loadThumbnail(for: target, force: true) }
            } else {
                onTap()
            }
        } label: {
            Group {
                switch state {
                case .loaded(let image):
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                case .failed:
                    VStack(spacing: Spacing.xs) {
                        Image(systemName: "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                        Text("Retry")
                            .font(.caption2.weight(.medium))
                    }
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .secondarySystemFill))
                case .idle, .loading:
                    Rectangle()
                        .fill(Color(uiColor: .secondarySystemFill))
                        .overlay { LoadingOrb(state: .shaping, side: 16) }
                }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(target.displayName)
        .accessibilityHint(state.hint)
        .task(id: target.id) {
            await store?.loadThumbnail(for: target)
        }
    }
}

private extension ThumbnailState {
    var hint: String {
        switch self {
        case .failed: "Double-tap to retry loading"
        default: "Double-tap to view full screen"
        }
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

/// Under a finished answer: the pages its searches found, then a quiet copy button and its time.
struct AnswerEndView: View {
    let end: AnswerEnd
    @State private var copied = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if !end.sources.isEmpty {
                SourcesList(sources: end.sources).padding(.top, Spacing.s)
            }
            HStack(spacing: Spacing.s) {
                CopyButton(text: end.text, copied: $copied)
                if let at = end.at {
                    Text(Date(unixMilliseconds: at), format: .dateTime.hour().minute())
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .haptic(.confirmed, trigger: copied)
    }
}

/// Something the agent said that is not a turn, kept in the transcript as a quiet line, its inline
/// markdown read: about three lines until it is tapped open.
struct NoticeLine: View {
    let notice: NoticeItem
    @State private var open = false
    @ScaledMetric(relativeTo: .footnote) private var threeLines: CGFloat = 3 * 18

    var body: some View {
        Label {
            FormattedMessage(text: notice.text, role: .quiet)
                .frame(maxHeight: open ? nil : threeLines, alignment: .top)
                .clipped()
        } icon: {
            Image(systemName: notice.level.symbol).foregroundStyle(notice.level.tint)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .contentShape(.rect)
        .onTapGesture { open.toggle() }
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
