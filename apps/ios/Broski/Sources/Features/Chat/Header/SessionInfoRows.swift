import SwiftUI
import UIKit

/// The top row of Session Info, level with its close button: the agent's mark, the session's title,
/// and the agent and Mac it runs on.
struct SessionInfoHeader: View {
    let title: String
    let brand: AgentBrand
    let machineName: String
    let close: () -> Void
    @ScaledMetric(relativeTo: .headline) private var markSide: CGFloat = 40
    @ScaledMetric(relativeTo: .headline) private var closeSide: CGFloat = 44

    var body: some View {
        HStack(spacing: Spacing.m) {
            HStack(spacing: Spacing.m) {
                AgentLogo(brand: brand, side: min(markSide, 56))
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(title)
                        .font(.headline)
                        .lineLimit(2)
                    Text("\(brand.name) · \(machineName)")
                        .font(.subheadline)
                        .foregroundStyle(sessionInfoTone)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .contextMenu {
                Button("Copy Title", systemImage: "doc.on.doc") { UIPasteboard.general.string = title }
            }
            Spacer(minLength: Spacing.s)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: min(closeSide, 56), height: min(closeSide, 56))
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")
        }
    }
}

/// A section's name in Session Info, in the plain white the inbox's headers use.
struct SessionInfoSectionTitle: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(sessionInfoTone)
            .textCase(nil)
    }
}

let sessionInfoTone = Color.primary.opacity(0.8)

/// A row like every other, label left and value right on one line, that copies `value` on a tap and
/// says "Copied" in its place for a moment.
struct CopyRow: View {
    let label: String
    let value: String
    var shown: String?
    @State private var copies = 0
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = value
            copied = true
            copies += 1
        } label: {
            HStack(spacing: Spacing.m) {
                Text(label).foregroundStyle(.primary)
                Spacer(minLength: Spacing.s)
                Text(copied ? "Copied" : shown ?? value)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .contentTransition(.opacity)
            }
            .animation(.snappy(duration: 0.2), value: copied)
        }
        .accessibilityLabel(label)
        .accessibilityValue(copied ? "Copied" : value)
        .accessibilityHint("Copies it")
        .haptic(.confirmed, trigger: copies)
        .task(id: copies) {
            guard copies > 0 else { return }
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
