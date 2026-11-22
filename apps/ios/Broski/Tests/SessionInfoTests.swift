import BroskiCore
import Foundation
import Testing

@testable import Broski

/// Session Info's words for a session's usage and its prompt cache.
@Suite
struct SessionInfoTests {
    private let locale = Locale(identifier: "en_US")
    private let touched: Int64 = 1_000_000
    private let clock: (Int64) -> String = { "T\($0)" }

    private func usage(
        input: Int64? = nil, output: Int64? = nil, cacheRead: Int64? = nil, cacheWrite: Int64? = nil,
        reasoning: Int64? = nil, cost: Double? = nil, context: Int64? = nil, window: Int64? = nil
    ) -> Usage {
        Usage(
            inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
            reasoningTokens: reasoning, costUsd: cost, contextTokens: context, contextWindow: window, cache: nil)
    }

    private func window(ttl: Int64? = 300_000, confidence: CacheConfidence? = .exact, prompt: Int64? = 151_000) -> CacheWindow {
        CacheWindow(lastTouchAt: touched, ttlMs: ttl, confidence: confidence, cachedTokens: 142_318, promptTokens: prompt)
    }

    @Test func theContextReadsUsedOfTheWindow() {
        #expect(usage(context: 64_000, window: 200_000).contextLine == "64k / 200k")
        #expect(usage(context: 64_000, window: 200_000).contextFraction(window: nil) == 0.32)
        #expect(usage(context: 1_240_000).contextLine == "1.2M", "no window reported")
        #expect(usage(window: 200_000).contextLine == nil)
    }

    @Test func onlyTheTokenCountsReportedAreListedInFull() {
        let lines = usage(input: 12_345, output: 678, reasoning: 0).tokenLines(locale: locale)
        #expect(lines == [
            InfoLine(label: "Input", value: "12,345"), InfoLine(label: "Output", value: "678"),
            InfoLine(label: "Reasoning", value: "0"),
        ])
        #expect(usage(cacheRead: 1, cacheWrite: 2).tokenLines(locale: locale).map(\.label) == ["Cache read", "Cache write"])
        #expect(usage().tokenLines(locale: locale).isEmpty)
    }

    @Test func theCostIsInDollarsAndACentFractionIsNotRoundedAway() {
        #expect(usage(cost: 0.42).costLine(locale: locale) == "$0.42")
        #expect(usage(cost: 12.5).costLine(locale: locale) == "$12.50")
        #expect(usage(cost: 0.00042).costLine(locale: locale) == "$0.0004")
        #expect(usage().costLine(locale: locale) == nil)
    }

    @Test func theCacheCountsDownWhileWarmThenSaysWhenItExpired() {
        #expect(window().remainingLine(nowMs: touched + 78_000) == "3m 42s left")
        #expect(window(confidence: .estimated).remainingLine(nowMs: touched + 78_000) == "~4m left")
        #expect(window().remainingLine(nowMs: touched + 300_000) == nil)
        #expect(window(ttl: nil).remainingLine(nowMs: touched) == nil)

        #expect(window().infoLines(nowMs: touched + 78_000, clock: clock) == [
            InfoLine(label: "Hit ratio", value: "94%"), InfoLine(label: "Cached", value: "142k of 151k prompt tokens"),
            InfoLine(label: "Expires", value: "T1300000"),
        ])
        #expect(window(confidence: .estimated).infoLines(nowMs: touched, clock: clock).last == InfoLine(label: "Expires", value: "about T1300000"))
        #expect(window(confidence: .estimated).infoLines(nowMs: touched + 300_000, clock: clock).last == InfoLine(label: "Expired", value: "T1300000"))
    }

    @Test func aCacheWithoutAPromptOrALifetimeSaysOnlyWhatItKnows() {
        #expect(window(ttl: nil, prompt: nil).infoLines(nowMs: touched, clock: clock) == [InfoLine(label: "Cached", value: "142k tokens")])
    }
}
