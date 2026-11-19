import Photos
import SwiftUI
import UIKit

/// Full-screen image gallery lightbox with Liquid Glass chrome, pinch/double-tap zoom, horizontal
/// paging, interactive swipe-down dismissal, progressive full-resolution loading, Save to Photos,
/// Copy Image, Copy Path, and Share.
struct ImageViewer: View {
    let items: [ImageTarget]
    let initialIndex: Int
    let loadThumbnail: (ImageTarget) -> UIImage?
    let loadFull: (ImageTarget) async throws -> FullImagePayload
    var onRemove: ((ImageTarget) -> Void)?

    @State private var index: Int
    @State private var payloads: [String: FullImagePayload] = [:]
    @State private var errors: [String: String] = [:]
    @State private var loading: Set<String> = []
    @State private var showsChrome = true
    @State private var isZoomed = false
    @State private var dismissDrag: CGFloat = 0
    @State private var toast: String?
    @State private var haptic = 0
    @State private var shareFile: ShareableImageFile?
    @Environment(\.dismiss) private var dismiss

    init(
        items: [ImageTarget],
        initialIndex: Int = 0,
        loadThumbnail: @escaping (ImageTarget) -> UIImage?,
        loadFull: @escaping (ImageTarget) async throws -> FullImagePayload,
        onRemove: ((ImageTarget) -> Void)? = nil
    ) {
        self.items = items
        self.initialIndex = max(0, min(initialIndex, max(0, items.count - 1)))
        self.loadThumbnail = loadThumbnail
        self.loadFull = loadFull
        self.onRemove = onRemove
        _index = State(initialValue: self.initialIndex)
    }

    static func present(
        items: [ImageTarget],
        initialIndex: Int = 0,
        store: ChatImageStore,
        onRemove: ((ImageTarget) -> Void)? = nil
    ) {
        present(
            items: items,
            initialIndex: initialIndex,
            loadThumbnail: { store.cachedThumbnail(for: $0) },
            loadFull: { try await store.loadFull(for: $0) },
            onRemove: onRemove)
    }

    static func presentFile(path: String, workspace: WorkspaceRequests) {
        let target = ImageTarget.file(path: path, name: (path as NSString).lastPathComponent)
        present(
            items: [target],
            initialIndex: 0,
            loadThumbnail: { _ in nil },
            loadFull: { _ in try await ChatImageStore.fetchWorkspaceImage(path: path, workspace: workspace) })
    }

    private static func present(
        items: [ImageTarget],
        initialIndex: Int,
        loadThumbnail: @escaping (ImageTarget) -> UIImage?,
        loadFull: @escaping (ImageTarget) async throws -> FullImagePayload,
        onRemove: ((ImageTarget) -> Void)? = nil
    ) {
        guard !items.isEmpty else { return }
        let viewer = ImageViewer(
            items: items, initialIndex: initialIndex, loadThumbnail: loadThumbnail, loadFull: loadFull, onRemove: onRemove)
        let host = UIHostingController(rootView: viewer)
        host.modalPresentationStyle = .overFullScreen
        host.modalTransitionStyle = .crossDissolve
        host.view.backgroundColor = .clear
        FormatPresenter.present(host)
    }

    private var current: ImageTarget? {
        items.indices.contains(index) ? items[index] : items.first
    }

    private var currentPayload: FullImagePayload? {
        current.flatMap { payloads[$0.id] }
    }

    private var backdropOpacity: Double {
        let progress = min(abs(dismissDrag) / 260.0, 1.0)
        return max(0.15, 1.0 - progress * 0.85)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(backdropOpacity).ignoresSafeArea()
            gallery
                .offset(y: dismissDrag)
                .scaleEffect(1.0 - min(abs(dismissDrag) / 1400.0, 0.14))
                .simultaneousGesture(dismissGesture)
            if showsChrome {
                chrome
                    .opacity(max(0, 1.0 - Double(abs(dismissDrag)) / 120.0))
                    .transition(.opacity)
            }
            if let toast {
                toastPill(toast)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(!showsChrome)
        .animation(.easeOut(duration: 0.2), value: showsChrome)
        .animation(.snappy(duration: 0.22), value: toast)
        .haptic(.confirmed, trigger: haptic)
        .task(id: index) { await ensureLoaded(around: index) }
        .sheet(item: $shareFile) { file in
            ActivityShareSheet(url: file.url)
        }
    }

    private var gallery: some View {
        TabView(selection: $index) {
            ForEach(Array(items.enumerated()), id: \.element.id) { position, item in
                page(for: item)
                    .tag(position)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func page(for item: ImageTarget) -> some View {
        let full = payloads[item.id]
        let thumb = loadThumbnail(item)
        if let full {
            ZoomableImageView(
                image: full.image,
                hasAlpha: full.hasAlpha,
                onSingleTap: { showsChrome.toggle() },
                onZoomChanged: { isZoomed = $0 })
        } else if let error = errors[item.id] {
            errorView(message: error, item: item)
        } else if let thumb {
            ZStack {
                ZoomableImageView(
                    image: thumb,
                    hasAlpha: ChatImageStore.hasAlpha(thumb),
                    onSingleTap: { showsChrome.toggle() },
                    onZoomChanged: { isZoomed = $0 })
                ProgressView()
                    .padding(Spacing.m)
                    .glassEffect(.regular, in: .circle)
            }
        } else {
            ProgressView()
                .controlSize(.large)
                .tint(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
                .onTapGesture { showsChrome.toggle() }
        }
    }

    private func errorView(message: String, item: ImageTarget) -> some View {
        ContentUnavailableView {
            Label("Couldn't open image", systemImage: "photo.badge.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again") {
                errors.removeValue(forKey: item.id)
                Task { await fetch(item) }
            }
            .buttonStyle(.glass)
        }
        .foregroundStyle(.white)
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer()
            bottomBar
        }
        .padding(.horizontal, Spacing.l)
        .padding(.vertical, Spacing.m)
    }

    private var topBar: some View {
        HStack(spacing: Spacing.m) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel("Close")

            Spacer(minLength: 0)

            if let current {
                VStack(spacing: 1) {
                    Text(current.displayName)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let subtitle = subtitle(for: current) {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.xs + 2)
                .glassEffect(.regular, in: .capsule)
            }

            Spacer(minLength: 0)

            if items.count > 1 {
                Text("\(index + 1) / \(items.count)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, Spacing.m)
                    .frame(height: 36)
                    .glassEffect(.regular, in: .capsule)
            } else {
                Color.clear.frame(width: 36, height: 36)
            }
        }
    }

    @ViewBuilder
    private var bottomBar: some View {
        if let current {
            HStack(spacing: Spacing.s) {
                if let payload = currentPayload {
                    actionButton("Save", symbol: "square.and.arrow.down") { saveToPhotos(payload) }
                    actionButton("Copy", symbol: "doc.on.doc") { copyImage(payload) }
                    actionButton("Share", symbol: "square.and.arrow.up") { prepareShare(payload, target: current) }
                }
                if let path = current.filePath {
                    actionButton("Path", symbol: "link") {
                        UIPasteboard.general.string = path
                        showToast("Path copied")
                    }
                }
                if let onRemove {
                    actionButton("Remove", symbol: "trash", role: .destructive) {
                        onRemove(current)
                        dismiss()
                    }
                }
            }
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .glassEffect(.regular, in: .capsule)
        }
    }

    private func actionButton(_ label: String, symbol: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Label(label, systemImage: symbol)
                .labelStyle(.iconOnly)
                .font(.body.weight(.medium))
                .frame(width: 40, height: 36)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(role == .destructive ? Palette.failed : .white)
        .accessibilityLabel(label)
    }

    private func subtitle(for target: ImageTarget) -> String? {
        var parts: [String] = []
        if let payload = payloads[target.id] {
            parts.append("\(payload.pixelWidth) × \(payload.pixelHeight)")
            parts.append(payload.byteCount.formatted(.byteCount(style: .file)))
        } else if let path = target.filePath {
            parts.append(path)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func toastPill(_ message: String) -> some View {
        VStack {
            Text(message)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, Spacing.l)
                .padding(.vertical, Spacing.s)
                .glassEffect(.regular, in: .capsule)
                .padding(.top, 64)
            Spacer()
        }
        .allowsHitTesting(false)
    }

    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { value in
                guard !isZoomed else { return }
                let vertical = value.translation.height
                let horizontal = abs(value.translation.width)
                guard abs(vertical) > horizontal else { return }
                dismissDrag = vertical
            }
            .onEnded { value in
                guard !isZoomed else { dismissDrag = 0; return }
                let shouldClose = abs(dismissDrag) > 110 || abs(value.predictedEndTranslation.height) > 260
                if shouldClose {
                    dismiss()
                } else {
                    withAnimation(.spring(duration: 0.25, bounce: 0.2)) { dismissDrag = 0 }
                }
            }
    }

    private func ensureLoaded(around center: Int) async {
        // Keep only the current page and immediate neighbors in full-res RAM.
        let keepIndices = Set([center - 1, center, center + 1].filter { items.indices.contains($0) })
        let keepIds = Set(keepIndices.map { items[$0].id })
        for key in payloads.keys where !keepIds.contains(key) { payloads.removeValue(forKey: key) }

        if items.indices.contains(center) { await fetch(items[center]) }
        for neighbor in [center + 1, center - 1] where items.indices.contains(neighbor) {
            await fetch(items[neighbor])
        }
    }

    private func fetch(_ item: ImageTarget) async {
        guard payloads[item.id] == nil, !loading.contains(item.id) else { return }
        loading.insert(item.id)
        defer { loading.remove(item.id) }
        do {
            payloads[item.id] = try await loadFull(item)
            errors.removeValue(forKey: item.id)
        } catch let error as ImageLoadError {
            errors[item.id] = error.message
        } catch {
            errors[item.id] = error.localizedDescription
        }
    }

    private func saveToPhotos(_ payload: FullImagePayload) {
        let data = payload.data
        Task {
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else {
                showToast("Allow Photos access in Settings")
                return
            }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                }
                showToast("Saved to Photos")
            } catch {
                showToast("Couldn't save to Photos")
            }
        }
    }

    private func copyImage(_ payload: FullImagePayload) {
        UIPasteboard.general.image = payload.image
        showToast("Image copied")
    }

    private func prepareShare(_ payload: FullImagePayload, target: ImageTarget) {
        let ext = Self.fileExtension(for: payload.mimeType, fallbackName: target.displayName)
        let base = (target.displayName as NSString).deletingPathExtension
        let safeName = (base.isEmpty ? "image" : base) + "." + ext
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("broski-share-\(UUID().uuidString)-\(safeName)")
        do {
            try payload.data.write(to: url, options: .atomic)
            shareFile = ShareableImageFile(url: url)
        } catch {
            showToast("Couldn't prepare file")
        }
    }

    private func showToast(_ message: String) {
        haptic += 1
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            if toast == message { toast = nil }
        }
    }

    private static func fileExtension(for mimeType: String, fallbackName: String) -> String {
        switch mimeType {
        case "image/png": return "png"
        case "image/jpeg": return "jpg"
        case "image/webp": return "webp"
        case "image/gif": return "gif"
        default:
            let ext = (fallbackName as NSString).pathExtension
            return ext.isEmpty ? "jpg" : ext
        }
    }
}

private struct ShareableImageFile: Identifiable {
    let id = UUID()
    let url: URL
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: url)
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
