import SwiftUI
import UIKit

/// The composer's field: one line, growing to `maxLines`, then scrolling. A `TextField` pastes
/// text only; this one's Paste also takes the images on the clipboard (a screenshot, a photo
/// copied from another app) and hands them to `pasteImages`, as a chat app's prompt does.
struct ComposerTextView: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String
    @Binding var isFocused: Bool
    let maxLines: Int
    /// Nil where the session takes no images: Paste is then text only.
    let pasteImages: (([UIImage]) -> Void)?

    func makeUIView(context: Context) -> PastingTextView {
        let view = PastingTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityLabel = "Message"
        view.accessibilityIdentifier = "composer"
        view.placeholder.text = placeholder
        return view
    }

    func updateUIView(_ view: PastingTextView, context: Context) {
        context.coordinator.parent = self
        view.pasteImages = pasteImages
        view.placeholder.text = placeholder
        if view.markedTextRange == nil, view.text != text {
            view.text = text
            view.showPlaceholder()
        }
        view.isEditable = context.environment.isEnabled
        view.wantsFocus = isFocused
        if isFocused, !view.isFirstResponder {
            view.focusWhenShown()
        } else if !isFocused, view.isFirstResponder {
            view.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView view: PastingTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? view.bounds.width
        guard width > 0, let font = view.font else { return nil }
        let content = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let cap = ceil(font.lineHeight * CGFloat(maxLines))
        view.isScrollEnabled = content > cap
        return CGSize(width: width, height: min(max(content, ceil(font.lineHeight)), cap))
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ view: UITextView) {
            if parent.text != view.text { parent.text = view.text }
            (view as? PastingTextView)?.showPlaceholder()
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ view: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }
    }
}

/// A text view whose Paste is offered for images too, and which takes focus once it is on screen.
final class PastingTextView: UITextView {
    var pasteImages: (([UIImage]) -> Void)?
    var wantsFocus = false
    let placeholder = UILabel()

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholder.font = .preferredFont(forTextStyle: .body)
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.isAccessibilityElement = false
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: leadingAnchor),
            placeholder.topAnchor.constraint(equalTo: topAnchor),
            placeholder.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func showPlaceholder() {
        placeholder.isHidden = !text.isEmpty
    }

    func focusWhenShown() {
        if window != nil { becomeFirstResponder() }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if wantsFocus, window != nil, !isFirstResponder { becomeFirstResponder() }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), pasteImages != nil, UIPasteboard.general.hasImages { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    /// Images first: a copied screenshot often carries no text, and a copied photo's text is its
    /// file name, which nobody means to send.
    override func paste(_ sender: Any?) {
        if let pasteImages, UIPasteboard.general.hasImages, let images = UIPasteboard.general.images, !images.isEmpty {
            pasteImages(images)
            return
        }
        super.paste(sender)
    }
}
