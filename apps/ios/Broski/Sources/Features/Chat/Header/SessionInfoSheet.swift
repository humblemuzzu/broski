import BroskiCore
import SwiftUI
import UIKit

/// Session Info, from the chat's overflow: the session and where it runs, its model and settings,
/// how full its context is with what it used, and its prompt cache counting down.
struct SessionInfoSheet: View {
    let chat: ChatModel
    let machine: MachineModel
    let title: String
    let cwd: String?
    let catalog: ComposerCatalog
    @State private var nowMs = Date.now.unixMilliseconds
    @Environment(\.dismiss) private var dismiss

    private var snapshot: SessionSnapshot { chat.snapshot }
    private var brand: AgentBrand { machine.brand(for: chat.session.backend) }
    private var modelId: String? { snapshot.modelId ?? chat.summary?.modelId }

    var body: some View {
        NavigationStack {
            Form {
                sessionSection
                if modelId != nil || snapshot.thinking != nil || !snapshot.modes.isEmpty {
                    settingsSection
                }
                if let usage = snapshot.usage {
                    UsageSection(usage: usage)
                }
                if let cache = snapshot.usage?.cache {
                    CacheSection(cache: cache, nowMs: nowMs)
                }
            }
            .task(id: snapshot.usage?.cache) { await countDown(snapshot.usage?.cache) }
            .navigationTitle("Session Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var sessionSection: some View {
        Section("Session") {
            LabeledContent("Title", value: title)
            LabeledContent("Agent") {
                HStack(spacing: Spacing.s) {
                    AgentLogo(brand: brand, side: 20)
                    Text(brand.name)
                }
            }
            LabeledContent("Machine", value: machine.name)
            CopyableRow(label: "Session ID", value: chat.session.sessionId)
            if let cwd {
                CopyableRow(label: "Folder", value: cwd)
            }
        }
    }

    private var settingsSection: some View {
        Section("Model & Settings") {
            if let modelId {
                let name = catalog.model(modelId)?.displayName ?? modelId
                LabeledContent("Model") {
                    VStack(alignment: .trailing, spacing: Spacing.xxs) {
                        Text(name)
                        if name != modelId {
                            Text(modelId).font(.caption.monospaced())
                        }
                    }
                }
            }
            if let thinking = snapshot.thinking {
                LabeledContent("Thinking", value: thinkingTitle(thinking))
            }
            ForEach(snapshot.modes, id: \.axis) { setting in
                let axis = catalog.modes.first { $0.id == setting.axis }
                let value = axis?.options.first { $0.value == setting.value }?.label ?? setting.value
                LabeledContent(axis?.label ?? setting.axis, value: value)
            }
        }
    }

    /// Wakes at each moment the cache's shown time changes, up to its expiry. The clock lives here
    /// rather than in a `TimelineView` around the rows, which would draw them as one Form cell.
    private func countDown(_ cache: CacheWindow?) async {
        guard let cache else { return }
        for entry in CacheCountdown(cache).entries(from: .now, mode: .normal) {
            try? await Task.sleep(for: .seconds(max(0, entry.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            nowMs = Date.now.unixMilliseconds
        }
    }

    private func thinkingTitle(_ value: String) -> String {
        modelId.flatMap { catalog.model($0) }?.thinking.options.first { $0.value == value }?.title ?? value.capitalized
    }
}

/// How full the context window is, the token counts the backend reported, and the cost.
private struct UsageSection: View {
    let usage: Usage

    var body: some View {
        Section("Context & Usage") {
            if let context = usage.contextLine {
                let fraction = usage.contextFraction(window: nil)
                VStack(alignment: .leading, spacing: Spacing.s) {
                    LabeledContent("Context") {
                        Text(fraction.map { "\(context) · \(Int(($0 * 100).rounded()))%" } ?? context)
                            .monospacedDigit()
                    }
                    if let fraction {
                        ProgressView(value: min(1, max(0, fraction)))
                            .tint(fraction > 0.85 ? Palette.caution : Palette.accent)
                    }
                }
            }
            ForEach(usage.tokenLines(), id: \.self) { line in
                LabeledContent(line.label) { Text(line.value).monospacedDigit() }
            }
            if let cost = usage.costLine() {
                LabeledContent("Cost") { Text(cost).monospacedDigit() }
            }
        }
    }
}

/// The prompt cache's window as of `nowMs`, counting down to its expiry, then its numbers.
private struct CacheSection: View {
    let cache: CacheWindow
    let nowMs: Int64

    var body: some View {
        Section("Prompt Cache") {
            if let remaining = cache.remainingLine(nowMs: nowMs) {
                LabeledContent("Warm") {
                    Text(remaining)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .foregroundStyle((CacheStatus(cache, nowMs: nowMs)?.tone ?? .quiet).style)
                }
            }
            ForEach(cache.infoLines(nowMs: nowMs), id: \.self) { line in
                LabeledContent(line.label) { Text(line.value).monospacedDigit() }
            }
        }
    }
}

/// A value to copy in one tap, which says "Copied" for a moment after.
private struct CopyableRow: View {
    let label: String
    let value: String
    @State private var copies = 0
    @State private var copied = false

    var body: some View {
        HStack(spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(label).font(.subheadline).foregroundStyle(.secondary)
                Text(value).font(.callout.monospaced()).textSelection(.enabled)
            }
            Spacer(minLength: 0)
            Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                UIPasteboard.general.string = value
                copied = true
                copies += 1
            }
            .labelStyle(.titleAndIcon)
            .font(.footnote.weight(.medium))
            .buttonStyle(.glass)
            .contentTransition(.symbolEffect(.replace))
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
        .haptic(.confirmed, trigger: copies)
        .task(id: copies) {
            guard copies > 0 else { return }
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
