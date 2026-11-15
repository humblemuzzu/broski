import SwiftUI

@main
struct BroskiApp: App {
    @State private var model: AppModel
    @AppStorage(Preference.appearance) private var appearance: Appearance = .system
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        model.start()
        _model = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(appearance.colorScheme)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }
}
