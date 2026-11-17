import BroskiCore
import SwiftUI
import UIKit

extension View {
    /// Long-press for the whole text: Copy (its markdown), Copy as plain text, Select Text (a sheet
    /// with all of it selectable at once) and Share. Code blocks and tables inside keep their own.
    @ViewBuilder
    func answerMenu(_ text: String?) -> some View {
        if let text, !text.isEmpty {
            contextMenu { AnswerMenuItems { text } }
        } else {
            self
        }
    }

    /// The same menu on one block of an answer in the transcript, for the whole answer the row is
    /// part of, read when an item is chosen (`AnswerSource`); the block's own links come first.
    func answerMenu(rowId: String, block: FormatBlock) -> some View {
        modifier(RowAnswerMenu(rowId: rowId, links: block.menuLinks))
    }
}

nonisolated extension FormatBlock {
    /// The block's links a long-press offers by name, since a `Text` cannot say which link a press
    /// landed on: web pages, addresses and files, each once, at most `FormatTokens.menuLinks`.
    var menuLinks: [FormatLink] {
        let spans: [FormatSpan] = switch content {
        case .paragraph(let spans), .heading(_, let spans): spans
        case .table(let table): (table.header + table.rows.flatMap { $0 }).flatMap(\.spans)
        default: []
        }
        var seen = Set<String>()
        return spans.compactMap(\.link)
            .filter { FormatLinkTarget($0) != nil && seen.insert($0.target).inserted }
            .prefix(FormatTokens.menuLinks)
            .map { $0 }
    }
}

/// Finds the whole answer a transcript row belongs to; the chat provides it.
struct AnswerSource {
    let text: @MainActor (_ rowId: String) -> String?
}

extension EnvironmentValues {
    @Entry var answerSource = AnswerSource { _ in nil }
}

private struct RowAnswerMenu: ViewModifier {
    let rowId: String
    let links: [FormatLink]
    @Environment(\.answerSource) private var source

    func body(content: Content) -> some View {
        content.contextMenu {
            if !links.isEmpty {
                Section { ForEach(links, id: \.target) { LinkMenu(link: $0) } }
            }
            AnswerMenuItems { source.text(rowId) }
        }
    }
}

/// One link of a long-pressed block: Open, Copy Link, Share.
private struct LinkMenu: View {
    let link: FormatLink
    @Environment(\.formatContext) private var context
    @Environment(AppModel.self) private var app: AppModel?

    var body: some View {
        if let target = FormatLinkTarget(link) {
            Menu {
                Button("Open", systemImage: symbol(target)) { FormatLinkOpener.open(target, context: context, app: app) }
                Button("Copy Link", systemImage: "link") { UIPasteboard.general.string = copied(target) }
                ShareLink(item: copied(target))
            } label: {
                Label(link.target, systemImage: symbol(target))
            }
        }
    }

    private func symbol(_ target: FormatLinkTarget) -> String {
        switch target {
        case .web: "safari"
        case .mail: "envelope"
        case .file: "doc.text"
        }
    }

    private func copied(_ target: FormatLinkTarget) -> String {
        switch target {
        case .web(let url), .mail(let url): url.absoluteString
        case .file(let path, let line): line.map { "\(path):\($0)" } ?? path
        }
    }
}

struct AnswerMenuItems: View {
    let text: @MainActor () -> String?

    var body: some View {
        Button("Copy", systemImage: "doc.on.doc") {
            if let text = text() { UIPasteboard.general.string = text }
        }
        Button("Copy as Plain Text", systemImage: "text.alignleft") {
            if let text = text() { UIPasteboard.general.string = formatPlainText(text: text) }
        }
        Button("Select Text", systemImage: "selection.pin.in.out") {
            guard let text = text() else { return }
            FormatPresenter.present(UIHostingController(rootView: SelectTextSheet(text: formatPlainText(text: text))))
        }
        Button("Share", systemImage: "square.and.arrow.up") {
            guard let text = text() else { return }
            FormatPresenter.present(UIActivityViewController(activityItems: [text], applicationActivities: nil))
        }
    }
}

/// The whole text in one selectable view, as the system's own text selection handles it.
struct SelectTextSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SelectableText(text: text)
                .ignoresSafeArea(.container, edges: .bottom)
                .navigationTitle("Select Text")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

private struct SelectableText: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.adjustsFontForContentSizeCategory = true
        view.font = .preferredFont(forTextStyle: .body)
        view.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 32, right: 16)
        view.dataDetectorTypes = [.link]
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}

/// Presents a screen over whatever is showing, sheet or not, so a row that scrolls away cannot take
/// it down with it.
enum FormatPresenter {
    static func present(_ controller: UIViewController) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        top?.present(controller, animated: true)
    }
}
