import BroskiCore
import SwiftUI
import Testing
import UIKit
@testable import Broski

/// A table is drawn at fixed column widths; if those widths set the page's minimum width, a page
/// of tables grows wider than its window and every paragraph on it is cut at the left edge. The
/// page is laid out as the transcript lays it out, its tables and code reaching across the margin.
struct TableWidthTests {
    @Test func aPageOfTablesStaysAsWideAsItsWindow() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for sample in formatSamples() where sample.text.contains("|---") || sample.text.contains("```") {
            let screen = ScrollView { FormattedText(text: sample.text).padding(.horizontal, TranscriptView.sideMargin) }
                .environment(\.formatBleed, TranscriptView.sideMargin)
            let host = UIHostingController(rootView: screen)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            window.rootViewController = host
            window.isHidden = false
            for _ in 0..<10 {
                RunLoop.main.run(until: Date().addingTimeInterval(0.05))
                host.view.layoutIfNeeded()
            }
            let page = try #require(scrollView(in: host.view))
            #expect(page.convert(page.bounds, to: host.view) == host.view.bounds, "\(sample.title)")
            window.isHidden = true
        }
    }

    private func scrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView { return scroll }
        return view.subviews.lazy.compactMap { scrollView(in: $0) }.first
    }
}
