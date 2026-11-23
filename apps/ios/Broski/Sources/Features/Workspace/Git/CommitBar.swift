import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// The commit message in one floating glass capsule with Commit inside it, built like the chat's
/// composer: a 36 pt ink pill 8 pt in from the edge, so the field and the button can never differ in
/// height. At the accessibility sizes Commit goes under the field, the whole width.
struct CommitBar: View {
    @Bindable var model: GitModel
    @Environment(\.workspaceReachable) private var reachable
    @Environment(\.dynamicTypeSize) private var typeSize
    @FocusState private var focused: Bool

    var body: some View {
        if typeSize.isAccessibilitySize {
            GlassEffectContainer(spacing: Spacing.s) {
                VStack(spacing: Spacing.s) {
                    field
                        .padding(Spacing.m)
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: Radius.card, style: .continuous))
                    Button(action: commit) { WideLabel(title: "Commit") }
                        .primaryActionStyle()
                        .disabled(!canCommit)
                }
            }
        } else {
            HStack(alignment: .bottom, spacing: Spacing.s) {
                field
                    .padding(.leading, Spacing.s)
                    .frame(minHeight: ComposerMetrics.control)
                CommitPill(isActive: canCommit, isCommitting: model.isChanging, commit: commit)
            }
            .padding(ComposerMetrics.inset)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: ComposerMetrics.radius, style: .continuous))
        }
    }

    private var canCommit: Bool { reachable && model.canCommit }

    private var field: some View {
        TextField("Commit message", text: $model.message, axis: .vertical)
            .lineLimit(1...4)
            .focused($focused)
            .submitLabel(.done)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHint(model.status?.staged.isEmpty ?? true ? "Stage a file first" : "")
    }

    private func commit() {
        focused = false
        Task { await model.commit() }
    }
}

/// Commit as the composer draws send: ink while there is something to commit, a soft fill while
/// there is not, the orb in its place while it commits.
private struct CommitPill: View {
    let isActive: Bool
    let isCommitting: Bool
    let commit: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: commit) {
            Text("Commit")
                .font(.subheadline.weight(.semibold))
                .opacity(isCommitting ? 0 : 1)
                .overlay {
                    if isCommitting {
                        LoadingOrb(state: .working, theme: colorScheme == .dark ? .light : .dark, label: "Committing")
                    }
                }
                .foregroundStyle(isActive ? AnyShapeStyle(Palette.onAccent) : AnyShapeStyle(.tertiary))
                .padding(.horizontal, Spacing.l)
                .frame(height: ComposerMetrics.control)
                .background(isActive || isCommitting ? Palette.accent : .composerFill, in: .capsule)
                .contentShape(.capsule)
                .animation(.snappy(duration: 0.2), value: isActive)
        }
        .buttonStyle(.plain)
        .disabled(!isActive)
        .accessibilityHint(isActive ? "Commits the staged files" : "Stage a file first")
    }
}
