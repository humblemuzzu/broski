import BroskiCore
import Foundation
import Testing

@testable import Broski

/// Picking a model from the composer: the pins and the level remembered on each model, what the
/// pill names, and which modes show beside it.
@Suite
struct ModelPickingTests {
    private func defaults() -> UserDefaults {
        let name = "ModelPickingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func pinsKeepTheirOrderPerAgentUpToTheLimitAndOutliveTheApp() {
        let store = defaults()
        let preferences = ModelPreferences(defaults: store)
        preferences.setPinned(true, "anthropic/claude-opus-5-5", backend: "pi")
        preferences.setPinned(true, "deepseek/deepseek-flash", backend: "pi")
        preferences.setPinned(true, "anthropic/claude-opus-5-5", backend: "pi")
        preferences.setPinned(true, "opus", backend: "claude-code")
        #expect(preferences.pinned(backend: "pi") == ["anthropic/claude-opus-5-5", "deepseek/deepseek-flash"])
        #expect(preferences.pinned(backend: "claude-code") == ["opus"])

        for index in 0..<20 { preferences.setPinned(true, "openrouter/m\(index)", backend: "pi") }
        #expect(preferences.pinned(backend: "pi").count == ModelPreferences.pinLimit)
        #expect(!preferences.canPin(backend: "pi"))

        preferences.setPinned(false, "anthropic/claude-opus-5-5", backend: "pi")
        let reopened = ModelPreferences(defaults: store)
        #expect(reopened.pinned(backend: "pi").first == "deepseek/deepseek-flash")
        #expect(reopened.pinned(backend: "pi").count == ModelPreferences.pinLimit - 1)
    }

    @Test func eachModelRemembersTheLevelLastChosenOnIt() {
        let store = defaults()
        let preferences = ModelPreferences(defaults: store)
        preferences.remember(level: "high", of: "agy/gemini-4-neon", backend: "pi")
        preferences.remember(level: "xhigh", of: "agy/gemini-4-neon", backend: "pi")
        #expect(ModelPreferences(defaults: store).level(of: "agy/gemini-4-neon", backend: "pi") == "xhigh")
        #expect(preferences.level(of: "agy/gemini-4-neon", backend: "claude-code") == nil)
    }

    @Test func thePillNamesTheModelWithoutWhatTheAgentAddsInBrackets() {
        #expect(model("Default (recommended)").pillName == "Default")
        #expect(model("Claude Opus 5.5").pillName == "Claude Opus 5.5")
        #expect(model("(beta)").pillName == "(beta)")
    }

    @Test func theLevelIsNamedInWordsWithTheModelsDefaultStandingInForNone() {
        let spec = ThinkingSpec(
            options: [ThinkingOption(value: "medium", label: nil, description: nil), ThinkingOption(value: "xhigh", label: "Extra high", description: nil)],
            defaultValue: "medium")
        #expect(spec.title(of: "xhigh") == "Extra high")
        #expect(spec.title(of: nil) == "Medium")
        #expect(spec.title(of: "max") == nil)
        #expect(ThinkingSpec(options: [], defaultValue: nil).title(of: nil) == nil)
    }

    @Test func aModeShowsBesideThePillOnlyOffItsUsualValue() {
        let permissions = axis(default: "default")
        #expect(permissions.changedOption("default") == nil)
        #expect(permissions.changedOption(nil) == nil)
        #expect(permissions.changedOption("plan")?.label == "Plan")
        let noDefault = axis(default: nil)
        #expect(noDefault.changedOption("default") == nil, "without a default the first option is the usual one")
        #expect(noDefault.title(of: nil) == "Ask first")
    }

    @Test func whatThePersonPickedShowsUntilTheSessionReportsIt() {
        let pending = ComposerChoices(modelId: "fake-small").merged(with: ComposerChoices(thinking: "low", modes: ["permissions": "plan"]))
        var snapshot = SessionSnapshot.empty
        snapshot.modelId = "fake-large"
        snapshot.thinking = "high"
        let shown = ComposerChoices(snapshot, pending: pending)
        #expect(shown.modelId == "fake-small")
        #expect(shown.thinking == "low")
        #expect(shown.modes["permissions"] == "plan")
        #expect(pending.merged(with: ComposerChoices(modelId: "fake-other")).thinking == nil)
    }

    @Test func theWheelKeepsTheModelItOpenedOnAheadOfThePinsAndPinnedOnesInTheirPlace() {
        let models = ["a", "b", "c", "d"].map { model($0, id: $0) }
        #expect(ModelSheet.wheel(models, pinned: ["a", "b", "gone"], openedOn: "c", listsAll: false).map(\.id) == ["c", "a", "b"])
        #expect(ModelSheet.wheel(models, pinned: ["a", "b"], openedOn: "b", listsAll: false).map(\.id) == ["a", "b"])
        #expect(ModelSheet.wheel(models, pinned: [], openedOn: "c", listsAll: true).map(\.id) == ["a", "b", "c", "d"])
    }

    @Test func theDrumTurnsRowsAwayAndTheTrackSnapsToTheNearestLevel() {
        #expect(abs(Drum.shown(1) - 0.96) < 0.01)
        #expect(abs(Drum.shown(2) - 1.70) < 0.01)
        #expect(Drum.alpha(0) == 1 && Drum.alpha(3) == 0 && Drum.detailAlpha(0.5) == 0)
        let track = LevelTrack(count: 5, width: 366, lead: 44, trail: 22)
        #expect(track.x(0) == 44 && track.x(4) == 344 && track.x(1) == 119)
        #expect(track.nearest(-50) == 0 && track.nearest(150) == 1 && track.nearest(160) == 2 && track.nearest(1000) == 4)
        #expect(LevelTrack(count: 1, width: 300, lead: 44, trail: 22).nearest(200) == 0)
    }

    private func model(_ name: String, id: String = "m") -> ModelSummary {
        ModelSummary(
            id: id, displayName: name, description: nil, providerId: nil, providerName: nil, contextWindow: nil,
            inputModalities: nil, thinking: ThinkingSpec(options: [], defaultValue: nil), isDefault: false, unavailableReason: nil)
    }

    private func axis(default value: String?) -> ModeAxis {
        ModeAxis(
            id: "permissions", label: "Permissions", description: nil,
            options: [
                ContractOption(value: "default", label: "Ask first", description: nil),
                ContractOption(value: "plan", label: "Plan", description: nil),
            ],
            defaultValue: value)
    }
}
