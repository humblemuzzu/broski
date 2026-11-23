import BroskiCore
import SwiftUI

/// Every sample the core's corpus holds (`formatSamples`), so the formatting is judged on the phone:
/// at every width and text size, in both appearances, upright and sideways.
struct FormattingGalleryScreen: View {
    private let samples = formatSamples()

    var body: some View {
        List(samples, id: \.title) { sample in
            NavigationLink(sample.title) {
                FormattingSampleScreen(sample: sample)
            }
        }
        .navigationTitle("Formatting")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One sample, formatted as the transcript or a quiet row draws it, or as its source; Replay streams
/// it in a few characters a batch, the way an answer arrives.
private struct FormattingSampleScreen: View {
    let sample: FormatSample
    @Environment(\.reading) private var reading
    @State private var role = Role.page
    @State private var showsSource = false
    @State private var streamed: String?
    @State private var replays = 0

    private enum Role: String, CaseIterable, Identifiable {
        case page = "Answer"
        case quiet = "Quiet"

        var id: String { rawValue }

        var format: FormatRole {
            switch self {
            case .page: .page
            case .quiet: .quiet
            }
        }
    }

    /// Characters per batch and batches per second while replaying: the core streams at most 30.
    private static let step = 12
    private static let batch: Duration = .milliseconds(33)

    var body: some View {
        ScrollView {
            Group {
                if showsSource {
                    Text(sample.text)
                        .font(.codeSmall)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    FormattedText(text: streamed ?? sample.text, role: role.format, streaming: streamed != nil || sample.arriving)
                        .accessibilityIdentifier("formatted-sample")
                }
            }
            .padding(.horizontal, TranscriptView.sideMargin)
            .padding(.vertical, Spacing.m)
        }
        .background(Palette.canvas(for: reading.darkCanvas).ignoresSafeArea())
        .environment(\.formatBleed, TranscriptView.sideMargin)
        .accessibilityIdentifier("gallery-sample-scroll")
        .navigationTitle(sample.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Style", selection: $role) {
                        ForEach(Role.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Toggle("Source", isOn: $showsSource)
                    Button("Replay", systemImage: "play") { replay() }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
        .task(id: replays) {
            guard replays > 0 else { return }
            var shown = 0
            while shown < sample.text.count {
                shown += Self.step
                streamed = String(sample.text.prefix(shown))
                try? await Task.sleep(for: Self.batch)
                if Task.isCancelled { return }
            }
            streamed = nil
        }
    }

    private func replay() {
        showsSource = false
        replays += 1
    }
}
