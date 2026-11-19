import Photos
import SwiftUI
import UIKit

/// One file: its text with line numbers, a zoomable image, or what it is; copy its path, copy or
/// share what it holds.
struct FileScreen: View {
    @State private var model: FileModel
    @State private var copied = 0
    @State private var toast: String?
    private let line: Int?

    init(path: String, line: Int? = nil, requests: WorkspaceRequests) {
        _model = State(initialValue: FileModel(path: path, requests: requests))
        self.line = line
    }

    var body: some View {
        ZStack(alignment: .top) {
            content
            if let toast {
                Text(toast)
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.s)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.top, Spacing.m)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.22), value: toast)
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
            LoadingOrb(side: 64)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .loaded(.text(let file)):
            FileTextView(file: file, path: model.path, line: line)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if file.truncated { TruncationNote(file: file) }
                }
        case .loaded(.image(let payload)):
            ZoomableImageView(image: payload.image, hasAlpha: payload.hasAlpha)
                .ignoresSafeArea(edges: .bottom)
                .safeAreaInset(edge: .bottom) {
                    Text("\(payload.pixelWidth) × \(payload.pixelHeight) · \(payload.byteCount.formatted(.byteCount(style: .file)))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Spacing.m)
                        .padding(.vertical, Spacing.xs + 2)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.bottom, Spacing.s)
                }
                .accessibilityLabel("Image, \(payload.pixelWidth) by \(payload.pixelHeight), \(payload.byteCount.formatted(.byteCount(style: .file)))")
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
                    notify("Path copied")
                }
                if case .loaded(.text(let file)) = model.phase {
                    Button("Copy Text", systemImage: "text.page") {
                        UIPasteboard.general.string = file.text
                        notify("Text copied")
                    }
                    ShareLink(item: file.text, preview: SharePreview(model.name))
                } else if case .loaded(.image(let payload)) = model.phase {
                    Button("Save to Photos", systemImage: "square.and.arrow.down") {
                        saveToPhotos(payload)
                    }
                    Button("Copy Image", systemImage: "photo.on.rectangle") {
                        UIPasteboard.general.image = payload.image
                        notify("Image copied")
                    }
                    ShareLink(
                        item: Image(uiImage: payload.image),
                        preview: SharePreview(model.name, image: Image(uiImage: payload.image)))
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
        }
    }

    private func saveToPhotos(_ payload: FullImagePayload) {
        let data = payload.data
        Task {
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else {
                notify("Allow Photos access in Settings")
                return
            }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                }
                notify("Saved to Photos")
            } catch {
                notify("Couldn't save to Photos")
            }
        }
    }

    private func notify(_ message: String) {
        copied += 1
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            if toast == message { toast = nil }
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
