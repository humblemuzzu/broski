import BroskiCore
import PhotosUI
import SwiftUI
import UIKit

/// The composer's `+`: photo library, camera (on a device that has one) and paste. Paste is always
/// offered and reads the clipboard when tapped: a menu built earlier cannot know what was copied
/// since.
struct AttachmentMenu: View {
    @Binding var draft: ComposerDraft
    let refuse: (String) -> Void
    @State private var picking = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var shooting = false

    var body: some View {
        Menu {
            Button("Photo Library", systemImage: "photo.on.rectangle") { picking = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Camera", systemImage: "camera") { shooting = true }
            }
            Button("Paste Image", systemImage: "doc.on.clipboard") {
                if let images = UIPasteboard.general.images, !images.isEmpty {
                    add(images)
                } else {
                    refuse("There's no image on the clipboard. Copy one, then paste it.")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.body.weight(.medium))
                .frame(width: 32, height: 32)
                .contentShape(.rect)
        }
        .foregroundStyle(.secondary)
        .accessibilityLabel("Attach")
        .photosPicker(isPresented: $picking, selection: $photos, maxSelectionCount: 4, matching: .images)
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task { add(await Self.images(items)) }
        }
        .fullScreenCover(isPresented: $shooting) {
            CameraPicker { add([$0]) }.ignoresSafeArea()
        }
    }

    private static func images(_ items: [PhotosPickerItem]) async -> [UIImage] {
        var images: [UIImage] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                images.append(image)
            }
        }
        return images
    }

    private func add(_ images: [UIImage]) {
        attach(images, to: $draft, refuse: refuse)
    }
}

/// Adds `images` to the draft, each fitted into what is left of the prompt's 4 MiB off the main
/// actor; one that cannot fit is said so.
func attach(_ images: [UIImage], to draft: Binding<ComposerDraft>, refuse: @escaping (String) -> Void) {
    Task {
        for image in images {
            let left = ImageFitter.promptBudget - draft.wrappedValue.imageCost
            let fitted = await Task.detached(priority: .userInitiated) { ImageFitter.fit(image, within: left) }.value
            if let fitted {
                draft.wrappedValue.images.append(fitted)
            } else {
                refuse("That image doesn't fit in one message. Send it on its own, or send fewer images.")
            }
        }
    }
}

/// The attached images as a strip of thumbnails, each tappable to preview and with a remove button.
struct AttachmentStrip: View {
    @Binding var draft: ComposerDraft
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 56

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.s) {
                ForEach(Array(draft.images.enumerated()), id: \.element.id) { index, image in
                    Button {
                        preview(at: index)
                    } label: {
                        Image(uiImage: image.thumbnail)
                            .resizable()
                            .scaledToFill()
                            .frame(width: side, height: side)
                            .clipShape(.rect(cornerRadius: Radius.small + 2, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .topTrailing) {
                        Button {
                            withAnimation(.snappy(duration: 0.22)) { draft.images.removeAll { $0.id == image.id } }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.6))
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .offset(x: 6, y: -6)
                        .accessibilityLabel("Remove image")
                    }
                }
            }
            .padding(.top, Spacing.s)
            .padding(.trailing, Spacing.s)
        }
        .scrollIndicators(.hidden)
    }

    private func preview(at index: Int) {
        let snapshot = draft.images
        let targets = snapshot.map { ImageTarget.local(id: $0.id.uuidString, name: $0.content.name) }
        let byId = Dictionary(uniqueKeysWithValues: snapshot.map { ($0.id.uuidString, $0) })
        let host = UIHostingController(
            rootView: ImageViewer(
                items: targets,
                initialIndex: index,
                loadThumbnail: { target in
                    if case .local(let id, _) = target { return byId[id]?.thumbnail }
                    return nil
                },
                loadFull: { target async throws(ImageLoadError) in
                    guard case .local(let id, _) = target, let item = byId[id] else {
                        throw ImageLoadError(message: "Image removed.")
                    }
                    return try await ChatImageStore.decodeFullImage(
                        base64: item.content.data, mimeType: item.content.mimeType, width: nil, height: nil, byteCount: nil)
                },
                onRemove: { target in
                    guard case .local(let id, _) = target else { return }
                    draft.images.removeAll { $0.id.uuidString == id }
                }))
        host.modalPresentationStyle = .overFullScreen
        host.modalTransitionStyle = .crossDissolve
        host.view.backgroundColor = .clear
        FormatPresenter.present(host)
    }
}

/// The system camera, for one photo.
private struct CameraPicker: UIViewControllerRepresentable {
    let took: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerController(
            _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { parent.took(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
