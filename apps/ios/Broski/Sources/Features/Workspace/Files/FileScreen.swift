import SwiftUI
import UIKit

/// One file: its text with line numbers, an image, or what it is; copy its path, copy or share
/// what it holds.
struct FileScreen: View {
    @State private var model: FileModel
    @State private var copied = 0

    init(path: String, requests: WorkspaceRequests) {
        _model = State(initialValue: FileModel(path: path, requests: requests))
    }

    var body: some View {
        content
            .navigationTitle(model.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .task { await model.load() }
            .haptic(.confirmed, trigger: copied)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .loaded(.text(let file)):
            FileTextView(file: file)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if file.truncated { TruncationNote(file: file) }
                }
        case .loaded(.image(let image, let size)):
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: image.size.width)
                    .accessibilityLabel("Image, \(size.formatted(.byteCount(style: .file)))")
            }
        case .loaded(.binary(let size)):
            ContentUnavailableView(
                "Binary file · \(size.formatted(.byteCount(style: .file)))", systemImage: "doc.zipper",
                description: Text("Broski shows text files and images."))
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("Copy Path", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = model.path
                    copied += 1
                }
                if case .loaded(.text(let file)) = model.phase {
                    Button("Copy Text", systemImage: "text.page") {
                        UIPasteboard.general.string = file.text
                        copied += 1
                    }
                    ShareLink(item: file.text, preview: SharePreview(model.name))
                } else if case .loaded(.image(let image, _)) = model.phase {
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(model.name, image: Image(uiImage: image)))
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
        }
    }
}

private struct TruncationNote: View {
    let file: TextFile

    var body: some View {
        Text("Showing the first \(file.shown.formatted(.byteCount(style: .file))) of \(file.size.formatted(.byteCount(style: .file))).")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.s)
            .background(.bar)
    }
}
