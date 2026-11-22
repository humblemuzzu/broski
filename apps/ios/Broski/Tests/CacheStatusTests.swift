import BroskiCore
import Foundation
import SwiftUI
import Testing

@testable import Broski

/// The prompt cache's clock as the phone counts it from the window the bridge sent.
@Suite
struct CacheStatusTests {
    private let touched: Int64 = 1_000_000

    private func window(
        ttl: Int64? = 300_000, confidence: CacheConfidence? = .exact, cached: Int64? = 142_318, prompt: Int64? = 151_000
    ) -> CacheWindow {
        CacheWindow(lastTouchAt: touched, ttlMs: ttl, confidence: confidence, cachedTokens: cached, promptTokens: prompt)
    }

    @Test func theHitRateIsTheCachedShareOfThePromptRoundedAndBounded() {
        #expect(window().hitPercent == 94)
        #expect(window(cached: 1, prompt: 3).hitPercent == 33)
        #expect(window(cached: 2, prompt: 3).hitPercent == 67)
        #expect(window(cached: 1, prompt: 8).hitPercent == 13, "a half rounds up")
        #expect(window(cached: 300, prompt: 100).hitPercent == 100)
        #expect(window(cached: -5, prompt: 100).hitPercent == 0)
        #expect(window(cached: 10, prompt: 0).hitPercent == nil)
        #expect(window(cached: nil).hitPercent == nil)
        #expect(window(prompt: nil).hitPercent == nil)
    }

    @Test func itIsWarmUntilTheLastMillisecondThenOnlyTheHitRateIsLeft() {
        #expect(CacheStatus(window(), nowMs: touched + 299_999) == .warm(remainingMs: 1, estimated: false, hitPercent: 94))
        #expect(CacheStatus(window(), nowMs: touched + 300_000) == .hitOnly(hitPercent: 94))
        #expect(CacheStatus(window(), nowMs: touched + 900_000) == .hitOnly(hitPercent: 94))
        #expect(CacheStatus(window(cached: 0), nowMs: touched + 300_000) == nil, "nothing was ever read from it")
        #expect(window().expiresAtMs == touched + 300_000)
        #expect(window().remainingMs(at: touched - 60_000) == 300_000, "a phone clock behind the Mac's does not stretch it")
    }

    @Test func noLifetimeIsNeverATimer() {
        #expect(CacheStatus(window(ttl: nil), nowMs: touched) == .hitOnly(hitPercent: 94))
        #expect(CacheStatus(window(ttl: nil, cached: 0), nowMs: touched) == nil)
        #expect(CacheStatus(window(ttl: nil, prompt: nil), nowMs: touched) == nil)
        #expect(CacheStatus(window(ttl: 0), nowMs: touched) == .hitOnly(hitPercent: 94))
        #expect(CacheStatus(nil, nowMs: touched) == nil)
        #expect(window(ttl: nil).expiresAtMs == nil && window(ttl: nil).remainingMs(at: touched) == nil)
    }

    @Test func aWarmWindowCarriesItsConfidenceAndAHitRateOnlyWhenKnown() {
        #expect(CacheStatus(window(confidence: .estimated), nowMs: touched) == .warm(remainingMs: 300_000, estimated: true, hitPercent: 94))
        #expect(CacheStatus(window(confidence: nil), nowMs: touched) == .warm(remainingMs: 300_000, estimated: false, hitPercent: 94))
        #expect(CacheStatus(window(cached: 0), nowMs: touched) == .warm(remainingMs: 300_000, estimated: false, hitPercent: 0))
        #expect(CacheStatus(window(prompt: nil), nowMs: touched) == .warm(remainingMs: 300_000, estimated: false, hitPercent: nil))
    }

    @Test func itTurnsAmberInItsLastMinute() {
        #expect(CacheStatus.warm(remainingMs: 60_001, estimated: false, hitPercent: nil).tone == .calm)
        #expect(CacheStatus.warm(remainingMs: 60_000, estimated: false, hitPercent: nil).tone == .expiring)
        #expect(CacheStatus.hitOnly(hitPercent: 91).tone == .quiet)
    }

    @Test func exactTimesCountSecondsAndEstimatesDropThem() {
        #expect(CacheFormat.duration(ms: 3_722_000, estimated: false) == "1h 02m")
        #expect(CacheFormat.duration(ms: 3_600_000, estimated: false) == "1h 00m")
        #expect(CacheFormat.duration(ms: 222_000, estimated: false) == "3m 42s")
        #expect(CacheFormat.duration(ms: 221_001, estimated: false) == "3m 42s", "whole seconds count up")
        #expect(CacheFormat.duration(ms: 65_000, estimated: false) == "1m 05s")
        #expect(CacheFormat.duration(ms: 60_000, estimated: false) == "1m 00s")
        #expect(CacheFormat.duration(ms: 59_999, estimated: false) == "1m 00s")
        #expect(CacheFormat.duration(ms: 42_000, estimated: false) == "42s")
        #expect(CacheFormat.duration(ms: 1, estimated: false) == "1s")
        #expect(CacheFormat.duration(ms: 222_000, estimated: true) == "~3m")
        #expect(CacheFormat.duration(ms: 3_722_000, estimated: true) == "~1h 02m")
        #expect(CacheFormat.duration(ms: 42_000, estimated: true) == "~42s")
    }

    @Test func theHeaderSaysTheWindowInFewWords() {
        #expect(CacheStatus.warm(remainingMs: 222_000, estimated: false, hitPercent: 94).compact == "Cache 3m 42s · 94%")
        #expect(CacheStatus.warm(remainingMs: 222_000, estimated: true, hitPercent: nil).compact == "Cache ~3m")
        #expect(CacheStatus.hitOnly(hitPercent: 91).compact == "91% cached")
        #expect(CacheStatus.warm(remainingMs: 222_000, estimated: true, hitPercent: 94).spoken == "Prompt cache warm, about 3m left, 94% cached")
    }

    @Test func switchingModelsWarnsOnlyWhileAtLeast20kTokensAreWarm() {
        let now = touched + 300_000 - 222_000
        #expect(window().switchWarning(at: now) == "Cache warm (142k tokens, 3m 42s left) — switching models will re-cache")
        #expect(window(confidence: .estimated).switchWarning(at: now) == "Cache warm (142k tokens, ~3m left) — switching models will re-cache")
        #expect(window(cached: 20_000).shouldWarnOnModelSwitch(at: now))
        #expect(!window(cached: 19_999).shouldWarnOnModelSwitch(at: now))
        #expect(!window(cached: nil).shouldWarnOnModelSwitch(at: now))
        #expect(!window().shouldWarnOnModelSwitch(at: touched + 300_000))
        #expect(!window(ttl: nil).shouldWarnOnModelSwitch(at: now) && window(ttl: nil).switchWarning(at: now) == nil)
        #expect(!window(ttl: nil).warnsOnModelSwitch && window().warnsOnModelSwitch)
    }

    @Test func tokenCountsAreShort() {
        #expect(CacheFormat.tokens(842) == "842")
        #expect(CacheFormat.tokens(142_318) == "142k")
        #expect(CacheFormat.tokens(999_999) == "999k")
        #expect(CacheFormat.tokens(1_240_000) == "1.2M")
    }

    @Test func theOverflowGivesTheNumbersAndATimeOfDay() {
        let clock: (Int64) -> String = { "T\($0)" }
        #expect(window().breakdown(clock: clock) == ["142k of 151k prompt tokens cached (94%)", "Expires T1300000"])
        #expect(window(confidence: .estimated, prompt: nil).breakdown(clock: clock) == ["Expires about T1300000"])
        #expect(window(ttl: nil).breakdown(clock: clock) == ["142k of 151k prompt tokens cached (94%)"])
        #expect(window(ttl: nil, cached: 0).breakdown(clock: clock).isEmpty)
    }

    @Test func theCountdownWakesAsEachSecondFallsThenStops() {
        let start = Date(unixMilliseconds: touched + 300_000 - 2_500)
        let ticks = Array(CacheCountdown(window()).entries(from: start, mode: .normal)).map(\.unixMilliseconds)
        #expect(ticks == [touched + 297_500, touched + 298_000, touched + 299_000, touched + 300_000])
        #expect(Array(CacheCountdown(window(ttl: nil)).entries(from: start, mode: .normal)).count == 1)
        #expect(Array(CacheCountdown(window()).entries(from: Date(unixMilliseconds: touched + 400_000), mode: .normal)).count == 1)
        #expect([3_000, 2_500, 1_001, 1, 0].map { CacheFormat.nextTickMs(remainingMs: $0) } == [1_000, 500, 1, 1, 1])
    }
}
