import BroskiCore
import SwiftUI

/// The pages an answer's searches found, under it: one row each with its title and its site, the
/// way a reader checks where a claim came from. Each opens in the in-app browser.
struct SourcesList: View {
    let sources: [LinkItem]
    @State private var showsAll = false

    /// Rows shown before "Show N more".
    static let shown = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(visible.enumerated()), id: \.element.url) { index, item in
                if index > 0 { Divider().padding(.leading, 28) }
                SourceRow(item: item)
            }
            if sources.count > Self.shown && !showsAll {
                Button("Show ^[\(sources.count - Self.shown) more source](inflect: true)") {
                    withAnimation(.easeOut(duration: 0.2)) { showsAll = true }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.top, Spacing.xs)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sources")
    }

    private var visible: [LinkItem] {
        showsAll ? sources : Array(sources.prefix(Self.shown))
    }
}

private struct SourceRow: View {
    let item: LinkItem

    var body: some View {
        if let url = URL(string: item.url) {
            Button {
                FormatLinkOpener.open(.web(url), context: nil, app: nil)
            } label: {
                HStack(spacing: Spacing.s + Spacing.xxs) {
                    Image(systemName: "globe")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(width: 18)
                    Text(item.title.isEmpty ? item.url : agentLine(item.title))
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.s)
                    Text(site(url))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
                .frame(minHeight: 40)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Copy Link", systemImage: "link") { UIPasteboard.general.string = item.url }
                ShareLink(item: url)
            }
        }
    }

    private func site(_ url: URL) -> String {
        let host = url.host() ?? item.url
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
