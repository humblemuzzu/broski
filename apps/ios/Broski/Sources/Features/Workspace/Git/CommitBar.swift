import BroskiCore
import SwiftUI

/// The commit message in a floating capsule with Commit beside it, the screen's one primary action.
/// At the accessibility sizes Commit goes under the field, the whole width.
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
                    commit { WideLabel(title: "Commit") }
                }
            }
        } else {
            GlassCapsuleBar {
                field
            } accessory: {
                commit { Text("Commit") }
            }
        }
    }

    private var field: some View {
        TextField("Commit message", text: $model.message, axis: .vertical)
            .lineLimit(1...4)
            .focused($focused)
            .submitLabel(.done)
    }

    private func commit(@ViewBuilder label: () -> some View) -> some View {
        Button {
            focused = false
            Task { await model.commit() }
        } label: {
            if model.isChanging {
                ProgressView()
            } else {
                label()
            }
        }
        .primaryActionStyle()
        .disabled(!reachable || !model.canCommit)
        .accessibilityHint(model.status?.staged.isEmpty ?? true ? "Stage a file first" : "Commits the staged files")
    }
}
