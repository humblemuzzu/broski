import SwiftUI

/// The inbox's search while it is open, in place of the bar: a glass field, and a round close
/// button beside it that clears the search and puts the bar back. The inbox owns this rather than
/// `searchable`: the system's minimized search in a top bar draws a close button that never
/// dismisses it (iOS 26 and 27).
struct InboxSearchField: View {
    @Binding var query: String
    let close: () -> Void
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 44

    var body: some View {
        GlassEffectContainer(spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    TextField("Search sessions", text: $query)
                        .focused($focused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !query.isEmpty {
                        Button {
                            query = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear text")
                    }
                }
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: side)
                .glassEffect(.regular.interactive(), in: .capsule)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: side, height: side)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Close Search")
            }
        }
        .onAppear { focused = true }
    }
}
