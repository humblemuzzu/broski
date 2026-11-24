import CoreGraphics
import Foundation

/// The model wheel seen as a drum from the front: a row `d` rows from the band is turned `d`·`step`
/// degrees away, so it shows nearer the band and squashed, and is gone edge-on at 90°. Distances are
/// in rows, fractional while the wheel turns.
nonisolated enum Drum {
    static let step: Double = 28
    private static let radians = step * .pi / 180

    static func angle(_ d: Double) -> Double { min(max(d * step, -90), 90) }

    /// Where row `d` shows, in rows from the band.
    static func shown(_ d: Double) -> Double { sin(angle(d) * .pi / 180) / radians }

    /// Full in the band, half a row away already faint, gone past two and a half.
    static func alpha(_ d: Double) -> Double {
        let away = abs(d)
        return away <= 1 ? 1 - 0.55 * away : max(0.45 - 0.3 * (away - 1), 0)
    }

    /// What only the band's row shows (its level) fades out within a quarter row.
    static func detailAlpha(_ d: Double) -> Double { min(max(1 - abs(d) * 4, 0), 1) }

    /// How many rows tall the wheel is for `count` models: enough to show the turned rows, no more.
    static func rows(_ count: Int) -> Double {
        switch count {
        case ...1: 1
        case 2: 3
        default: 4.4
        }
    }
}

/// Where each thinking level sits on a track `width` wide, lowest first: evenly from `lead` in to
/// `trail` from the end. The fill runs from the track's start to `trail` past the handle, so the lowest
/// level is still a short pill and the highest fills the track.
nonisolated struct LevelTrack {
    let count: Int
    let width: CGFloat
    let lead: CGFloat
    let trail: CGFloat

    private var step: CGFloat { count > 1 ? (width - lead - trail) / CGFloat(count - 1) : 0 }

    func x(_ index: Int) -> CGFloat { lead + CGFloat(min(max(index, 0), max(count - 1, 0))) * step }

    func clamp(_ x: CGFloat) -> CGFloat { min(max(x, self.x(0)), self.x(count - 1)) }

    func nearest(_ x: CGFloat) -> Int {
        guard step > 0 else { return 0 }
        return min(max(Int(((clamp(x) - lead) / step).rounded()), 0), count - 1)
    }
}
