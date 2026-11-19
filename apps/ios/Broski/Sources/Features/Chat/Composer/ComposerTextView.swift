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
    /// Hardware keyboard ⌘Return shortcut.
    var onSubmit: (() -> Void)? = nil

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
        view.onSubmit = onSubmit
        view.placeholder.text = placeholder
        if view.markedTextRange == nil, view.text != text {
            view.text = text
            view.showPlaceholder()
        }
        view.wantsEditable = context.environment.isEnabled
        view.wantsFocus = isFocused
        view.follow()
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
    var onSubmit: (() -> Void)?
    var wantsFocus = false
    var wantsEditable = true
    let placeholder = UILabel()
    private var followPending = false

    override var keyCommands: [UIKeyCommand]? {
        var commands = super.keyCommands ?? []
        if onSubmit != nil {
            let send = UIKeyCommand(input: "\r", modifierFlags: .command, action: #selector(handleSubmitKey))
            send.wantsPriorityOverSystemBehavior = true
            commands.append(send)
        }
        return commands
    }

    @objc private func handleSubmitKey() {
        flushMarkedText()
        onSubmit?()
    }

    /// Commits any pending inline autocorrection or IME composition before Send reads the draft.
    func flushMarkedText() {
        guard markedTextRange != nil else { return }
        unmarkText()
        delegate?.textViewDidChange?(self)
    }

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

    /// Takes up `wantsEditable` and `wantsFocus` on the next turn of the main queue, never inside
    /// SwiftUI's update: a first responder changed there (by focus, or by an editable field becoming
    /// read-only, which gives the keyboard up) makes the hosting view's focus bridge update the view
    /// graph again from within that update, and the main thread never comes back.
    func follow() {
        let settled = isEditable == wantsEditable && (wantsFocus == isFirstResponder || window == nil)
        guard !settled, !followPending else { return }
        followPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            followPending = false
            if isEditable != wantsEditable { isEditable = wantsEditable }
            if wantsFocus, window != nil, !isFirstResponder {
                becomeFirstResponder()
            } else if !wantsFocus, isFirstResponder {
                resignFirstResponder()
            }
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        follow()
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
