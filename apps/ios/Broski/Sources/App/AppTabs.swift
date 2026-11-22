import BroskiCore
import SwiftUI
import ThinkingOrbsKit

enum AppTab: Hashable {
    case inbox
    case settings
    /// The round button at the bar's trailing end. It is never selected: it opens New Session on
    /// the inbox.
    case newSession
}

/// The tab shell: a Liquid Glass tab bar that minimises as the content scrolls down, with New
/// Session as the round button beside it, and, while any agent works, an accessory above it that
/// opens the inbox filtered to working.
struct AppTabs: View {
    @Environment(AppModel.self) private var model
    @State private var tab: AppTab = .inbox

    var body: some View {
        TabView(selection: selection) {
            Tab("Inbox", systemImage: "tray.full", value: .inbox) {
                InboxScreen()
            }
            .badge(model.inbox.rows.count { $0.state == .needsYou })

            Tab("Settings", systemImage: "gearshape", value: .settings) {
                SettingsScreen()
            }

            Tab("New Session", systemImage: "square.and.pencil", value: .newSession, role: .search) {
                Color.clear
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: model.sessionToOpen) { _, target in
            if target != nil { tab = .inbox }
        }
        .onChange(of: model.startsNewSession) { _, starts in
            if starts { tab = .inbox }
        }
        .modifier(WorkingAccessory(count: model.visibleSession == nil ? model.inbox.workingCount : 0) {
            tab = .inbox
            model.inbox.filter = .working
        })
    }

    private var selection: Binding<AppTab> {
        Binding {
            tab
        } set: { picked in
            if picked == .newSession {
                model.startsNewSession = true
            } else {
                tab = picked
            }
        }
    }
}

/// "n agents working" in the tab view's bottom accessory, left out while a chat (which hides the
/// tab bar for its composer) is on screen. Showing and hiding it in place needs
/// `tabViewBottomAccessory(isEnabled:)` (iOS 26.1); on 26.0 the accessory is left out.
private struct WorkingAccessory: ViewModifier {
    let count: Int
    let open: () -> Void

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: count > 0) {
                WorkingAccessoryLabel(count: count, open: open)
            }
        } else {
            content
        }
    }
}

private struct WorkingAccessoryLabel: View {
    let count: Int
    let open: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        Button(action: open) {
            HStack(spacing: Spacing.s) {
                Orb(.working, side: 18, relativeTo: .footnote)
                Text("^[\(count) agent](inflect: true) working")
                    .font(placement == .inline ? .footnote.weight(.semibold) : .subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
                if placement != .inline {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, Spacing.l)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows the sessions that are working")
    }
}
