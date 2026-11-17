import SwiftUI

@main
struct BroskiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
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
                .readingSettings()
                .preferredColorScheme(appearance.colorScheme)
                .onAppear { appDelegate.push = model.push }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }
}
