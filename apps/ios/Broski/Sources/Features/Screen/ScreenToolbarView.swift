import BroskiCore
import SwiftUI

struct ScreenToolbarView: View {
    let model: ScreenModel
    let onPasswordTap: () -> Void
    let onTypeTextTap: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            actionRow
            keyRow
        }
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var actionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                modeToggle
                toolbarButton("Password", systemImage: "key.fill", action: onPasswordTap)
                toolbarButton("Type", systemImage: "keyboard", action: onTypeTextTap)
                toolbarButton("Right Click", systemImage: "cursorarrow.click.2") { model.click(button: 4) }
                toolbarButton("Space ←", systemImage: "chevron.left.2") { model.sendShortcut(.spaceLeft) }
                toolbarButton("Space →", systemImage: "chevron.right.2") { model.sendShortcut(.spaceRight) }
                toolbarButton("Mission", systemImage: "rectangle.3.group") { model.sendShortcut(.missionControl) }
                toolbarButton("Paste", systemImage: "doc.on.clipboard") { model.pastePhoneClipboard() }
            }
            .padding(.horizontal, 12)
        }
    }

    private var keyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                modifierKey("⌘", .command)
                modifierKey("⌥", .option)
                modifierKey("⌃", .control)
                modifierKey("⇧", .shift)
                keyButton("Esc", 0xff1b)
                keyButton("Tab", 0xff09)
                keyButton("⌫", 0xff08)
                keyButton("⏎", 0xff0d)
                keyButton("←", 0xff51)
                keyButton("↑", 0xff52)
                keyButton("↓", 0xff54)
                keyButton("→", 0xff53)
                toolbarButton("Scroll ↑", systemImage: "arrow.up") { model.scroll(deltaX: 0, deltaY: 3) }
                toolbarButton("Scroll ↓", systemImage: "arrow.down") { model.scroll(deltaX: 0, deltaY: -3) }
            }
            .padding(.horizontal, 12)
        }
    }

    private var modeToggle: some View {
        Button {
            model.pointerMode = model.pointerMode == .trackpad ? .directTouch : .trackpad
        } label: {
            Label(
                model.pointerMode == .trackpad ? "Trackpad" : "Touch",
                systemImage: model.pointerMode == .trackpad ? "hand.draw" : "hand.tap"
            )
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.accentColor.opacity(0.18), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func toolbarButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.quaternary, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func modifierKey(_ label: String, _ mod: ModifierKeys) -> some View {
        let on = model.activeModifiers.contains(mod)
        return Button {
            model.toggleModifier(mod)
        } label: {
            Text(label)
                .font(.footnote.weight(.semibold))
                .frame(minWidth: 34, minHeight: 30)
                .background(on ? Color.accentColor : Color.secondary.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(on ? .white : .primary)
        }
        .buttonStyle(.plain)
    }

    private func keyButton(_ label: String, _ keysym: UInt32) -> some View {
        Button {
            model.tapKey(keysym)
        } label: {
            Text(label)
                .font(.footnote.weight(.medium))
                .frame(minWidth: 34, minHeight: 30)
                .padding(.horizontal, 4)
                .background(Color.secondary.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
