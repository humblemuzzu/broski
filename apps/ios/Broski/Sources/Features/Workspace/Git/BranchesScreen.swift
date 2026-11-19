import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// Every branch, the current one checked; tapping another asks before switching to it.
struct BranchesScreen: View {
    @State private var model: BranchesModel
    @State private var confirming: GitBranch?
    @Environment(\.workspaceReachable) private var reachable

    init(cwd: String, requests: WorkspaceRequests) {
        _model = State(initialValue: BranchesModel(cwd: cwd, requests: requests))
    }

    var body: some View {
        content
            .navigationTitle("Branches")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: reachable) {
                guard reachable else { return }
                await model.load()
            }
            .haptic(.confirmed, trigger: model.switchCount)
            .haptic(.failed, trigger: model.problem) { $1 != nil }
            .confirmationDialog(
                "Switch to \(confirming?.checkoutName ?? "")?", isPresented: isConfirming, titleVisibility: .visible,
                presenting: confirming
            ) { branch in
                Button("Switch Branch") { Task { await model.checkout(branch) } }
            } message: { _ in
                Text("Git keeps your local changes, or refuses if switching would overwrite them.")
            }
    }

    private var isConfirming: Binding<Bool> {
        Binding { confirming != nil } set: { if !$0 { confirming = nil } }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            LoadingOrb(side: 64).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .loaded:
            List {
                if let problem = model.problem {
                    Banner(problem: problem)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                branchSection("Local", model.local)
                branchSection("Remote", model.remote)
                if model.truncated {
                    Text("This repository has more branches than Broski lists.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
    }

    @ViewBuilder
    private func branchSection(_ title: String, _ branches: [GitBranch]) -> some View {
        if !branches.isEmpty {
            Section(title) {
                ForEach(branches, id: \.name) { branch in
                    if branch.current {
                        BranchLabel(branch: branch, switching: false)
                    } else {
                        Button {
                            confirming = branch
                        } label: {
                            BranchLabel(branch: branch, switching: model.switching == branch.name)
                        }
                        .tint(.primary)
                        .disabled(!reachable || model.switching != nil)
                    }
                }
            }
        }
    }
}

private struct BranchLabel: View {
    let branch: GitBranch
    let switching: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(branch.name).foregroundStyle(.primary)
                if let upstream = branch.upstream {
                    Text(upstream.summary).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if switching {
                LoadingOrb(state: .working, label: "Switching")
            } else if branch.current {
                Image(systemName: "checkmark").foregroundStyle(Palette.accent)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(branch.current ? .isSelected : [])
        .accessibilityHint(branch.current ? "" : "Switches to this branch")
    }
}
