import BroskiCore
import SafariServices
import SwiftUI
import UIKit

/// The machine and folder agent text belongs to, so a path in it opens that machine's file.
struct FormatContext: Hashable {
    let machineId: String
    let cwd: String?

    /// `path` as the workspace names it: relative paths are in the session's folder.
    func resolve(_ path: String) -> String {
        if path.hasPrefix("/") || path.hasPrefix("~") || cwd == nil { return path }
        let base = cwd ?? ""
        let trimmed = path.hasPrefix("./") ? String(path.dropFirst(2)) : path
        return base.hasSuffix("/") ? base + trimmed : base + "/" + trimmed
    }
}

extension EnvironmentValues {
    @Entry var formatContext: FormatContext?
}

extension View {
    /// Opens the formatter's links: pages in an in-app browser, addresses in Mail, paths as the
    /// file at its line on the machine `context` names.
    func formatLinkHandling() -> some View {
        modifier(FormatLinkHandling())
    }
}

private struct FormatLinkHandling: ViewModifier {
    @Environment(\.formatContext) private var context
    @Environment(AppModel.self) private var app: AppModel?

    func body(content: Content) -> some View {
        content.environment(\.openURL, OpenURLAction { url in
            guard let target = FormatLinkTarget(url: url) else { return .discarded }
            FormatLinkOpener.open(target, context: context, app: app)
            return .handled
        })
    }
}

/// Presents what a link opens over whatever is on screen, sheet or not.
enum FormatLinkOpener {
    static func open(_ target: FormatLinkTarget, context: FormatContext?, app: AppModel?) {
        switch target {
        case .web(let url):
            FormatPresenter.present(SFSafariViewController(url: url))
        case .mail(let url):
            UIApplication.shared.open(url)
        case .file(let path, let line):
            guard let context, let app else {
                UIPasteboard.general.string = path
                return
            }
            let place = WorkspacePlace.file(context.resolve(path), line: line)
            let sheet = UIHostingController(rootView: FileSheet(machineId: context.machineId, place: place).environment(app))
            FormatPresenter.present(sheet)
        }
    }
}

/// A file a link names, over the screen it was tapped on, with Done to go back.
private struct FileSheet: View {
    let machineId: String
    let place: WorkspacePlace
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WorkspaceDestination(machineId: machineId, place: place)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .routeDestinations()
        }
    }
}
