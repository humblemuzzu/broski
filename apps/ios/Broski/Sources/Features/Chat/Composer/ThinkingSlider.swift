import BroskiCore
import SwiftUI

/// A thinking level on a thick track, lowest at the start. The fill runs to the handle, a short bar
/// inside the fill's end; a touch anywhere takes the handle there, a drag carries it, and on release
/// it springs onto the nearest level. Each level the handle crosses ticks and is set on `index` as it
/// is crossed, so the title above can follow; `commit` gets the level it comes to rest on. With
/// `index` nil no level is set yet, and the track shows no fill until one is touched.
struct ThinkingSlider: View {
    let count: Int
    @Binding var index: Int?
    let value: String
    let commit: (Int) -> Void
    /// Where the finger holds the handle; nil when it rests on a level.
    @State private var held: CGFloat?

    private static let height: CGFloat = 56
    private static let lead: CGFloat = 44
    private static let trail: CGFloat = 22

    var body: some View {
        GeometryReader { proxy in
            let track = LevelTrack(count: count, width: proxy.size.width, lead: Self.lead, trail: Self.trail)
            let x = held ?? index.map(track.x)
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.card)
                if let x {
                    Capsule()
                        .fill(.primary)
                        .frame(width: min(max(x + Self.trail, Self.height), proxy.size.width))
                }
                ForEach(0..<count, id: \.self) { level in
                    let at = track.x(level)
                    Circle()
                        .fill(x.map { at < $0 } == true ? AnyShapeStyle(Palette.card.opacity(0.6)) : AnyShapeStyle(.secondary.opacity(0.7)))
                        .frame(width: 5, height: 5)
                        .opacity(x.map { abs(at - $0) < 8 } == true ? 0 : 1)
                        .position(x: at, y: Self.height / 2)
                }
                if let x {
                    Capsule()
                        .fill(Palette.card)
                        .frame(width: held == nil ? 3 : 2, height: held == nil ? 22 : 30)
                        .position(x: x, y: Self.height / 2)
                }
            }
            .contentShape(.capsule)
            .gesture(drag(track))
        }
        .frame(height: Self.height)
        .sensoryFeedback(.selection, trigger: index) { old, new in old != nil || new != nil }
        .accessibilityElement()
        .accessibilityLabel("Thinking")
        .accessibilityValue(value)
        .accessibilityAdjustableAction(adjust)
    }

    private func drag(_ track: LevelTrack) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { touch in
                let x = track.clamp(touch.location.x)
                withAnimation(held == nil ? .spring(duration: 0.22, bounce: 0) : .interactiveSpring(duration: 0.12)) { held = x }
                let level = track.nearest(x)
                if level != index { index = level }
            }
            .onEnded { touch in
                let level = track.nearest(touch.location.x)
                if level != index { index = level }
                withAnimation(.spring(duration: 0.38, bounce: 0.22)) { held = nil }
                commit(level)
            }
    }

    private func adjust(_ direction: AccessibilityAdjustmentDirection) {
        let now = index ?? -1
        let next = direction == .increment ? min(now + 1, count - 1) : max(now - 1, 0)
        guard next != index else { return }
        index = next
        commit(next)
    }
}

/// The model's thinking level on a slider: the level's name above it, rolling as it changes, and
/// under it what the level means. A level is chosen when the slider comes to rest on it; the page
/// stays, so the person can try another.
struct ThinkingPage: View {
    let model: ModelSummary
    let chosen: String?
    let choose: (String) -> Void
    @State private var shown: Int?
    @State private var rising = true

    init(model: ModelSummary, chosen: String?, choose: @escaping (String) -> Void) {
        self.model = model
        self.chosen = chosen
        self.choose = choose
        _shown = State(initialValue: model.thinking.options.firstIndex { $0.value == (chosen ?? model.thinking.defaultValue) })
    }

    private var options: [ThinkingOption] { model.thinking.options }
    private var title: String { shown.map { options[$0].title } ?? "Default" }
    private var about: String {
        shown.flatMap { options[$0].description }.flatMap { $0.isEmpty ? nil : $0 }
            ?? "Higher levels think longer for more thorough answers, but take more time and use more of your limits."
    }

    private var level: Binding<Int?> {
        Binding {
            shown
        } set: { next in
            rising = (next ?? -1) > (shown ?? -1)
            withAnimation(.snappy(duration: 0.3)) { shown = next }
        }
    }

    var body: some View {
        List {
            VStack(spacing: 0) {
                Text(title)
                    .font(.title2.weight(.semibold))
                    .contentTransition(.numericText(countsDown: !rising))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 28)
                ThinkingSlider(count: options.count, index: level, value: title) { index in
                    let value = options[index].value
                    if value != (chosen ?? model.thinking.defaultValue) { choose(value) }
                }
                .padding(.top, 18)
                Text(about)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
                    .padding(.top, 36)
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
        .scrollDisabled(true)
        .navigationTitle("Thinking")
        .navigationBarTitleDisplayMode(.inline)
    }
}
