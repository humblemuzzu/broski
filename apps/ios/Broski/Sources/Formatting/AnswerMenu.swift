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
    /// part of, read when an item is chosen (`AnswerSource`).
    func answerMenu(rowId: String) -> some View {
        modifier(RowAnswerMenu(rowId: rowId))
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
    @Environment(\.answerSource) private var source

    func body(content: Content) -> some View {
        content.contextMenu { AnswerMenuItems { source.text(rowId) } }
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
