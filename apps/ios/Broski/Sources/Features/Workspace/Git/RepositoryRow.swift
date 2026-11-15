import BroskiCore
import SwiftUI

/// The repository a folder is in, as its folder screen shows it: the branch and what changed.
struct RepositoryRow: View {
    let status: GitStatusRead

    private var changes: Int { status.staged.count + status.unstaged.count + status.untracked.count }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(status.branch ?? "Detached HEAD").font(.body.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "arrow.triangle.branch").foregroundStyle(Palette.accent)
        }
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        let changed = changes == 0 ? "No changes" : changes == 1 ? "1 change" : "\(changes) changes"
        let upstream = status.upstream.map { " · \($0.summary)" } ?? ""
        return "Git · \(changed)\(upstream)"
    }
}
