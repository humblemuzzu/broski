import BroskiCore
import SwiftUI
import UIKit

/// Session Info, from the chat's overflow: the session and where it runs, its model and settings,
/// its folder and id to copy, how full its context is with what it used, and its prompt cache
/// counting down. Every row is a label and a value on one line.
struct SessionInfoSheet: View {
    let chat: ChatModel
    let machine: MachineModel
    let title: String
    let cwd: String?
    let catalog: ComposerCatalog
    @State private var nowMs = Date.now.unixMilliseconds
    @State private var home: String?
    @Environment(\.dismiss) private var dismiss

    private var snapshot: SessionSnapshot { chat.snapshot }
    private var brand: AgentBrand { machine.brand(for: chat.session.backend) }
    private var modelId: String? { snapshot.modelId ?? chat.summary?.modelId }

    var body: some View {
        Form {
            if let usage = snapshot.usage {
                UsageSection(usage: usage)
            }
            if modelId != nil || snapshot.thinking != nil || !snapshot.modes.isEmpty {
                settingsSection
            }
            detailsSection
            if let cache = snapshot.usage?.cache {
                CacheSection(cache: cache, nowMs: nowMs)
            }
        }
        .contentMargins(.top, Spacing.xs, for: .scrollContent)
        .safeAreaBar(edge: .top) {
            SessionInfoHeader(title: title, brand: brand, machineName: machine.name) { dismiss() }
                .padding(.horizontal, Spacing.l)
                .padding(.top, Spacing.l)
                .padding(.bottom, Spacing.s)
        }
        .task(id: snapshot.usage?.cache) { await countDown(snapshot.usage?.cache) }
        .task { home = try? await WorkspaceRequests(machine: machine.machine).info().roots.first }
        .presentationDetents([.medium, .large])
    }

    private var detailsSection: some View {
        Section {
            if let cwd {
                CopyRow(label: "Folder", value: cwd, shown: cwd.abbreviatingHome(home))
            }
            CopyRow(label: "Session ID", value: chat.session.sessionId)
        } header: {
            SessionInfoSectionTitle("Details")
        }
    }

    private var settingsSection: some View {
        Section {
            if let modelId {
                let model = catalog.model(modelId)
                LabeledContent("Model", value: model?.displayName ?? modelId)
                if let provider = model?.provider {
                    LabeledContent("Provider", value: provider)
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
        } header: {
            SessionInfoSectionTitle("Model")
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
        Section {
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
        } header: {
            SessionInfoSectionTitle("Context & Usage")
        }
    }
}

/// The prompt cache's window as of `nowMs`, counting down to its expiry, then its numbers.
private struct CacheSection: View {
    let cache: CacheWindow
    let nowMs: Int64

    var body: some View {
        Section {
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
        } header: {
            SessionInfoSectionTitle("Prompt Cache")
        }
    }
}
